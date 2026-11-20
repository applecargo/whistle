// WebPd 런타임과 패치별 wasm을 다루는 최소 계층.
// - 런타임 스크립트는 페이지당 한 번만 불러온다.
// - AudioWorklet 프로세서 등록(initialize)은 AudioContext당 한 번만 한다.
//   (두 번 하면 "webpd-node is already registered" 오류)
// - 패치 노드는 어디에도 연결하지 않고 돌려준다. 연결·게인·공간화는 호출하는 쪽 책임.
import type { PdMessage } from "./webpd-session.ts";

export type PdPort = { nodeId: string; portletId: string };
export type PatchEntry = {
  file: string; hash: string; bytes: number;
  inputs: Record<string, PdPort>; outputs: Record<string, PdPort>;
};
export type PatchManifest = { webpd: string; patches: Record<string, PatchEntry> };
export type PdNode = AudioWorkletNode & { destroy(): void };
type Runtime = {
  initialize(context: AudioContext): Promise<void>;
  run(context: AudioContext, patch: ArrayBuffer, settings: {
    messageHandler(node: PdNode, event: MessageEvent): void;
  }): Promise<PdNode>;
};

const runtime = () => (window as unknown as { WebPdRuntime: Runtime }).WebPdRuntime;

let scriptLoading: Promise<void> | undefined;
function loadScript(url: string) {
  return scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      scriptLoading = undefined;
      reject(new Error("WebPd 런타임을 불러오지 못했습니다."));
    };
    document.head.append(script);
  });
}

const initialized = new WeakMap<AudioContext, Promise<void>>();
/** 이 AudioContext에서 WebPd를 쓸 수 있게 준비한다. 여러 번 불러도 실제 초기화는 한 번. */
export function prepareContext(context: AudioContext, baseUrl: string) {
  let ready = initialized.get(context);
  if (!ready) {
    ready = loadScript(`${baseUrl}webpd-runtime.js`).then(() => runtime().initialize(context));
    ready.catch(() => initialized.delete(context));
    initialized.set(context, ready);
  }
  return ready;
}

let manifestLoading: Promise<PatchManifest> | undefined;
export function loadManifest(baseUrl: string) {
  manifestLoading ??= fetch(`${baseUrl}patches/manifest.json`).then(async (response) => {
    if (!response.ok) throw new Error("패치 목록(manifest.json)을 불러오지 못했습니다.");
    return response.json() as Promise<PatchManifest>;
  });
  manifestLoading.catch(() => { manifestLoading = undefined; });
  return manifestLoading;
}

const bytes = new Map<string, Promise<ArrayBuffer>>();
function loadBytes(url: string) {
  let loading = bytes.get(url);
  if (!loading) {
    loading = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`패치를 불러오지 못했습니다: ${url}`);
      return response.arrayBuffer();
    });
    loading.catch(() => bytes.delete(url));
    bytes.set(url, loading);
  }
  return loading;
}

/** 패치 인스턴스 하나를 만든다. 반환된 node는 연결되지 않은 상태다. */
export async function startPatch(
  context: AudioContext,
  baseUrl: string,
  name: string,
  receive: (bus: string, message: PdMessage) => void = () => {},
) {
  const manifest = await loadManifest(baseUrl);
  const entry = manifest.patches[name];
  if (!entry) throw new Error(`빌드 목록에 없는 패치입니다: ${name}`);
  const [patch] = await Promise.all([
    loadBytes(`${baseUrl}patches/${entry.file}`),
    prepareContext(context, baseUrl),
  ]);
  // 같은 바이트를 여러 인스턴스가 공유하므로 사본을 넘긴다.
  const node = await runtime().run(context, patch.slice(0), {
    messageHandler(_node, event) {
      if (event.data.type !== "io:messageSender") return;
      const { nodeId, portletId, message } = event.data.payload;
      const bus = Object.keys(entry.outputs).find((key) =>
        entry.outputs[key].nodeId === nodeId && entry.outputs[key].portletId === portletId);
      if (bus) receive(bus, message);
    },
  });
  let closed = false;
  return {
    name,
    node,
    send(bus: string, message: PdMessage) {
      if (closed) return;
      const port = entry.inputs[bus];
      if (!port) throw new Error(`${name}: Pd 수신 버스가 없습니다: ${bus}`);
      node.port.postMessage({ type: "io:messageReceiver", payload: { ...port, message } });
    },
    destroy() {
      if (closed) return;
      closed = true;
      node.destroy();
      node.disconnect();
      node.port.close();
    },
  };
}

export type PatchInstance = Awaited<ReturnType<typeof startPatch>>;
