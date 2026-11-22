// pd4web 엔진 하나에 패치를 "슬롯"으로 동적 생성하는 최소 계층.
// - 엔진(pd4web.js/wasm, Pd 0.56)은 페이지당 하나. AudioContext도 엔진이 만든다(openEngine이 돌려준다).
// - 패치 폴더(audio/patches/)를 엔진이 켜질 때 하위 폴더째 엔진의 가상 디스크(/)에 복사한다. abstraction은 Pd가 알아서 찾는다.
//   폴더는 tar 하나(audio/patches.tar, Vite가 묶어 줌)로 받아 푼다.
// - 패치 하나 = 슬롯 하나: host의 [pd slotN] 안에 [<패치> slotN] → [dac~ 2N+1 2N+2]를 만들고 loadbang을 보낸다.
//   패치는 최상위 [outlet~] 두 개(L, R)로 내보낸다. 엔진 출력(슬롯 수×2 채널)을 슬롯별 스테레오 노드로 나눠 돌려준다.
// - 노드는 어디에도 연결하지 않고 돌려준다. 연결·게인·공간화는 호출하는 쪽 책임.
// - 같은 패치를 여러 슬롯에 띄우면 Pd 안에서 이름이 겹친다. 슬롯마다 따로 받을 버스는 패치에서 [r $1-<버스>]로 받고
//   start(..., { scoped: true })로 연다(send("whistle-region")이 "slotN-whistle-region"으로 간다).

export type PdMessage = (string | number)[];

/** 동시에 띄울 수 있는 패치 수. 슬롯마다 2채널이고 Web Audio 노드 출력은 최대 32채널. */
export const SLOTS = 16;
const HOST = "pd-index.pd";

type Pd4Web = {
  openPatch(file: string, options: Record<string, unknown>): void;
  init(): void;
  sendList(name: string, list: PdMessage): boolean;
  sendMessage(name: string, selector: string, list: PdMessage): boolean;
};
type Pd4WebGlobals = {
  Pd4WebModule(options: { locateFile(path: string): string }): Promise<{ Pd4Web: new () => Pd4Web; FS: EmscriptenFS }>;
  Pd4Web: Pd4Web | null;
  Pd4WebAudioContext?: AudioContext;
  Pd4WebAudioWorkletNode?: AudioWorkletNode;
};
type EmscriptenFS = { mkdirTree(path: string): void; writeFile(path: string, data: Uint8Array): void };
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
  /** 엔진 가상 디스크에 복사한 패치 폴더의 파일(폴더 기준 경로) */
  files: string[];
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
  // 캐시가 있어도 서버에 바뀌었는지 묻는다(안 바뀌었으면 304).
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`불러오지 못했습니다: ${url} (${response.status})`);
  return response;
}

/** tar(ustar)를 풀어 일반 파일마다 write(경로, 내용)를 부른다. 푼 경로 목록을 돌려준다. */
function untar(bytes: Uint8Array, write: (path: string, data: Uint8Array) => void) {
  const text = new TextDecoder();
  const field = (header: Uint8Array, offset: number, length: number) =>
    text.decode(header.subarray(offset, offset + length)).split("\0")[0];
  const paths: string[] = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header[0] === 0) break; // 끝 표시(빈 블록)
    const path = [field(header, 345, 155), field(header, 0, 100)].filter(Boolean).join("/");
    const size = parseInt(field(header, 124, 12), 8);
    const type = header[156];
    offset += 512;
    if (type === 48 /* "0" */ || type === 0) {
      write(path, bytes.slice(offset, offset + size));
      paths.push(path);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return paths;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createEngine(baseUrl: string, latencyHint: AudioContextLatencyCategory, timeout: number): Promise<PdEngine> {
  if (!globalThis.crossOriginIsolated) {
    throw new Error("pd4web 엔진에는 교차 출처 격리(COOP/COEP)가 필요합니다. 페이지를 새로고침하세요.");
  }
  const g = globals();
  if (!g.Pd4WebModule) await loadScript(`${baseUrl}engine/pd4web.js`);
  const module = await g.Pd4WebModule({ locateFile: (path) => `${baseUrl}engine/${path}` });
  const pd = new module.Pd4Web();
  // pd4web의 GUI·콜백 코드는 전역 Pd4Web을 찾는다.
  g.Pd4Web = pd;
  // pd4web는 소리 켜기 버튼 id가 없으면 콘솔 오류를 낸다. 누를 일 없는 숨은 요소를 준다(시작은 init()으로).
  const toggle = document.createElement("span");
  toggle.id = "whistle-pd4web-toggle";
  toggle.hidden = true;
  document.body.append(toggle);
  pd.openPatch("index.pd", { channelCountOut: SLOTS * 2, renderGui: false, soundToggleId: toggle.id });

  // pd4web는 latencyHint를 "interactive"로 고정해 AudioContext를 만든다. 만드는 순간에만 생성자를 감싸 지연 설정을 넘긴다.
  const Original = g.AudioContext;
  g.AudioContext = class extends Original {
    constructor(options?: AudioContextOptions) { super({ ...options, latencyHint }); }
  };
  try { pd.init(); } finally { g.AudioContext = Original; }

  // 오디오 워클릿 노드는 비동기로 생긴다. pd4web가 전역에 두고 destination에 바로 연결한다.
  const until = performance.now() + timeout;
  while (!g.Pd4WebAudioWorkletNode || !g.Pd4WebAudioContext) {
    if (performance.now() > until) throw new Error("pd4web 오디오 워클릿이 시작되지 않았습니다.");
    await delay(20);
  }
  const context = g.Pd4WebAudioContext;
  const worklet = g.Pd4WebAudioWorkletNode;
  worklet.disconnect();
  const splitter = context.createChannelSplitter(SLOTS * 2);
  worklet.connect(splitter);

  // Pd → JS 메시지(onBangReceived 등)는 쓰지 않는다: 이 구성(pd4web 3.4.1, GUI 없음)에서는 콜백이 오지 않았다
  // (JS가 보낸 bang·list를 같은 이름으로 받아도 오지 않음, print만 옴). 시작 확인은 동기 생성으로 충분하다.

  // --- 패치 폴더(tar 하나)를 엔진 가상 디스크(/)에 푼다 ---
  const files = untar(new Uint8Array(await (await fetchOk(`${baseUrl}patches.tar`)).arrayBuffer()), (path, data) => {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    if (dir) module.FS.mkdirTree(`/${dir}`);
    module.FS.writeFile(`/${path}`, data);
  });

  // --- 슬롯 ---
  const used = new Set<number>();
  const made = new Set<number>();
  const message = (target: string, selector: string, args: PdMessage) => {
    if (!pd.sendMessage(target, selector, args)) throw new Error(`Pd 메시지 실패: ${target} ${selector} ${args.join(" ")}`);
  };

  const start = async (name: string, options: StartOptions = {}): Promise<PatchInstance> => {
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

  return { context, files, start, slotsInUse: () => used.size };
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
