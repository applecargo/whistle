// pd4web 엔진 하나에 패치를 "슬롯"으로 동적 생성하는 최소 계층.
// - 엔진(pd4web.js/wasm, Pd 0.56)은 페이지당 하나. AudioContext도 엔진이 만든다(openEngine이 돌려준다).
// - 패치 .pd 파일은 실행 중에 sendFile로 엔진 파일시스템에 넣는다(빌드 없음).
// - 패치 하나 = 슬롯 하나: host의 [pd slotN] 안에 [<패치> slotN] → [dac~ 2N+1 2N+2]를 만들고 loadbang을 보낸다.
//   패치는 최상위 [outlet~] 두 개(L, R)로 내보낸다. 엔진 출력(슬롯 수×2 채널)을 슬롯별 스테레오 노드로 나눠 돌려준다.
// - 노드는 어디에도 연결하지 않고 돌려준다. 연결·게인·공간화는 호출하는 쪽 책임.
// - 같은 패치를 여러 슬롯에 띄우면 Pd 안에서 이름이 겹친다. 슬롯마다 따로 받을 버스는 패치에서 [r $1-<버스>]로 받고
//   start(..., { scoped: true })로 연다(send("whistle-region")이 "slotN-whistle-region"으로 간다).

export type PdMessage = (string | number)[];
export type PatchEntry = { hash: string; files: string[] };
export type PatchManifest = {
  engine: { pd4web: string; files: Record<string, string> };
  patches: Record<string, PatchEntry>;
};

/** 동시에 띄울 수 있는 패치 수. 슬롯마다 2채널이고 Web Audio 노드 출력은 최대 32채널. */
export const SLOTS = 16;
const HOST = "pd-index.pd";

type Pd4Web = {
  openPatch(file: string, options: Record<string, unknown>): void;
  init(): void;
  sendList(name: string, list: PdMessage): boolean;
  sendMessage(name: string, selector: string, list: PdMessage): boolean;
  sendFile(data: ArrayBuffer, name: string): boolean;
};
type Pd4WebGlobals = {
  Pd4WebModule(options: { locateFile(path: string): string }): Promise<{ Pd4Web: new () => Pd4Web }>;
  Pd4Web: Pd4Web | null;
  Pd4WebAudioContext?: AudioContext;
  Pd4WebAudioWorkletNode?: AudioWorkletNode;
};
const globals = () => window as unknown as Pd4WebGlobals & typeof globalThis;

export type StartOptions = {
  /** 슬롯별 버스: send(bus)를 `slotN-<bus>`로 보낸다(패치는 [r $1-<bus>]). 사운드스케이프처럼 같은 패치를 여러 개 띄울 때. */
  scoped?: boolean;
};

export type PatchInstance = {
  name: string;
  /** 슬롯 이름(slot0…). Pd 안에서 패치의 $1 */
  slot: string;
  node: AudioNode;
  send(bus: string, message: PdMessage): void;
  destroy(): void;
};

export type PdEngine = {
  context: AudioContext;
  recordingInput: AudioNode;
  manifest: PatchManifest;
  start(name: string, options?: StartOptions): Promise<PatchInstance>;
  /** 지금 쓰는 슬롯 수 */
  slotsInUse(): number;
};

const loadScript = (url: string) => new Promise<void>((resolve, reject) => {
  const script = document.createElement("script");
  script.src = url;
  script.onload = () => resolve();
  script.onerror = () => { script.remove(); reject(new Error("pd4web 엔진을 불러오지 못했습니다.")); };
  document.head.append(script);
});

async function fetchOk(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`불러오지 못했습니다: ${url} (${response.status})`);
  return response;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createEngine(baseUrl: string, latencyHint: AudioContextLatencyCategory, timeout: number): Promise<PdEngine> {
  if (!globalThis.crossOriginIsolated) {
    throw new Error("pd4web 엔진에는 교차 출처 격리(COOP/COEP)가 필요합니다. 페이지를 새로고침하세요.");
  }
  const manifest = await (await fetchOk(`${baseUrl}patches/manifest.json`)).json() as PatchManifest;
  const files = manifest.engine.files;
  const engineUrl = (file: string) => `${baseUrl}pd4web/${file}?v=${files[file] ?? manifest.engine.pd4web}`;
  const g = globals();
  if (!g.Pd4WebModule) await loadScript(engineUrl("pd4web.js"));
  const module = await g.Pd4WebModule({ locateFile: (path) => engineUrl(path) });
  const pd = new module.Pd4Web();
  // pd4web의 GUI·콜백 코드는 전역 Pd4Web을 찾는다.
  g.Pd4Web = pd;
  // pd4web는 소리 켜기 버튼 id가 없으면 콘솔 오류를 낸다. 누를 일 없는 숨은 요소를 준다(시작은 init()으로).
  const toggle = document.createElement("span");
  toggle.id = "whistle-pd4web-toggle";
  toggle.hidden = true;
  document.body.append(toggle);
  pd.openPatch("index.pd", { channelCountIn: 2, channelCountOut: SLOTS * 2, renderGui: false, soundToggleId: toggle.id });

  // pd4web는 latencyHint를 "interactive"로 고정해 AudioContext를 만든다. 만드는 순간에만 생성자를 감싸 지연 설정을 넘긴다.
  const Original = g.AudioContext;
  g.AudioContext = class extends Original {
    constructor(options?: AudioContextOptions) { super({ ...options, latencyHint }); }
  };
  try { pd.init(); } finally { g.AudioContext = Original; }

  // pd4web publishes the worklet asynchronously. Whistle connects its input and slot outputs below.
  const until = performance.now() + timeout;
  while (!g.Pd4WebAudioWorkletNode || !g.Pd4WebAudioContext) {
    if (performance.now() > until) throw new Error("pd4web 오디오 워클릿이 시작되지 않았습니다.");
    await delay(20);
  }
  const context = g.Pd4WebAudioContext;
  const worklet = g.Pd4WebAudioWorkletNode;
  worklet.channelCount = 2;
  worklet.channelCountMode = "explicit";
  const recordingInput = context.createGain();
  recordingInput.channelCount = 2;
  recordingInput.channelCountMode = "explicit";
  const silence = context.createConstantSource();
  silence.offset.value = 0;
  silence.connect(recordingInput);
  silence.start();
  recordingInput.connect(worklet);
  const splitter = context.createChannelSplitter(SLOTS * 2);
  worklet.connect(splitter);

  // Pd → JS 메시지(onBangReceived 등)는 쓰지 않는다: 이 구성(pd4web 3.4.1, GUI 없음)에서는 콜백이 오지 않았다
  // (JS가 보낸 bang·list를 같은 이름으로 받아도 오지 않음, print만 옴). 시작 확인은 동기 생성으로 충분하다.

  // --- 패치 파일: 패치 해시가 바뀐 경우에만 다시 보낸다 ---
  const sent = new Map<string, Promise<void>>();
  const sendFiles = (entry: PatchEntry) => Promise.all(entry.files.map((file) => {
    const key = `${file}@${entry.hash}`;
    let sending = sent.get(key);
    if (!sending) {
      sending = fetchOk(`${baseUrl}patches/${file}?v=${entry.hash}`).then((r) => r.arrayBuffer()).then((data) => {
        if (!pd.sendFile(data, `/${file}`)) throw new Error(`패치 파일을 엔진에 넣지 못했습니다: ${file}`);
      });
      sending.catch(() => sent.delete(key));
      sent.set(key, sending);
    }
    return sending;
  }));

  // --- 슬롯 ---
  const used = new Set<number>();
  const made = new Set<number>();
  const message = (target: string, selector: string, args: PdMessage) => {
    if (!pd.sendMessage(target, selector, args)) throw new Error(`Pd 메시지 실패: ${target} ${selector} ${args.join(" ")}`);
  };

  const start = async (name: string, options: StartOptions = {}): Promise<PatchInstance> => {
    const entry = manifest.patches[name];
    if (!entry) throw new Error(`패치 목록에 없는 패치입니다: ${name}`);
    await sendFiles(entry);
    let index = 0;
    while (used.has(index)) index++;
    if (index >= SLOTS) throw new Error(`Pd 슬롯 ${SLOTS}개를 모두 쓰고 있습니다: ${name}`);
    used.add(index);
    const slot = `slot${index}`;
    const canvas = `pd-${slot}`;
    const merger = context.createChannelMerger(2);
    let closed = false;
    const destroy = () => {
      if (closed) return;
      closed = true;
      try { message(canvas, "clear", []); } catch { /* 엔진이 이미 멈춤 */ }
      splitter.disconnect(merger);
      merger.disconnect();
      used.delete(index);
    };
    try {
      if (!made.has(index)) {
        message(HOST, "obj", [20, 40 + 30 * index, "pd", slot]);
        made.add(index);
      }
      message(canvas, "clear", []);
      message(canvas, "obj", [20, 20, name, slot]);
      message(canvas, "obj", [20, 80, "dac~", 2 * index + 1, 2 * index + 2]);
      message(canvas, "connect", [0, 0, 1, 0]);
      message(canvas, "connect", [0, 1, 1, 1]);
      splitter.connect(merger, 2 * index, 0);
      splitter.connect(merger, 2 * index + 1, 1);
      // 동적으로 만든 패치에는 loadbang이 저절로 오지 않는다.
      message(canvas, "loadbang", []);
    } catch (error) {
      destroy();
      throw error;
    }
    return {
      name,
      slot,
      node: merger,
      send(bus: string, values: PdMessage) {
        if (closed) throw new Error(`${name}: 종료된 패치입니다.`);
        const target = options.scoped ? `${slot}-${bus}` : bus;
        // 받는 객체가 없는 버스로 보내도 Pd는 조용히 버린다(pd4web도 true를 돌려준다). 비용이 작아 따로 거르지 않는다.
        if (!pd.sendList(target, values)) throw new Error(`${name}: Pd 메시지 실패: ${target}`);
      },
      destroy,
    };
  };

  return { context, recordingInput, manifest, start, slotsInUse: () => used.size };
}

let engine: Promise<PdEngine> | undefined;
/**
 * 페이지의 pd4web 엔진을 연다(처음 한 번만 실제로 만든다. 이후에는 같은 엔진).
 * latencyHint는 처음 열 때만 적용된다. 사용자 조작(클릭·키) 뒤에 부르는 것이 좋다(AudioContext 자동재생 정책).
 */
export function openEngine(baseUrl: string, options: { latencyHint?: AudioContextLatencyCategory; timeout?: number } = {}) {
  engine ??= createEngine(baseUrl, options.latencyHint ?? "interactive", options.timeout ?? 30_000);
  engine.catch(() => { engine = undefined; });
  return engine;
}

/** 패치 목록만 필요할 때(엔진을 열지 않음) */
export async function loadManifest(baseUrl: string) {
  return (await fetchOk(`${baseUrl}patches/manifest.json`)).json() as Promise<PatchManifest>;
}
