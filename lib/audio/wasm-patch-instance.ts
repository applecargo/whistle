import { loadRuntime, type PdMessage } from "./webpd-session";

type Port = { nodeId: string; portletId: string };
type Manifest = { inputs: Record<string, Port>; outputs: Record<string, Port> };
type PdNode = AudioWorkletNode & { destroy(): void };

export interface WasmPatchInstance {
  readonly id: string;
  readonly patchName: string;
  readonly isSpatial: boolean;

  /** On/Off 스위치: 노드를 활성화하고 믹서로 페이드 인 연결 */
  enable(): Promise<void>;
  /** On/Off 스위치: 페이드 아웃 후 믹서 연결을 해제하여 DSP 연산(CPU) 0% 절감 */
  disable(): void;
  /** 현재 활성화(On) 여부 */
  isEnabled(): boolean;

  /** 3D 공간화 좌표 갱신 (isSpatial일 때 적용) */
  setPosition(x: number, y: number, z: number): void;
  /** 볼륨 조절 (0.0 ~ 1.0) */
  setGain(volume: number): void;
  /** Pd 버스로 메시지 전송 */
  send(bus: string, message: PdMessage): void;
  /** 인스턴스 완전 폐기 */
  destroy(): void;
}

export type CreateWasmPatchOptions = {
  id: string;
  patchName: string;
  baseUrl: string;
  context: AudioContext;
  destination: AudioNode;
  spatial?: { x: number; y: number; z: number };
  initialGain?: number;
  receive?: (bus: string, message: PdMessage) => void;
};

export async function createWasmPatchInstance({
  id,
  patchName,
  baseUrl,
  context,
  destination,
  spatial,
  initialGain = 1.0,
  receive,
}: CreateWasmPatchOptions): Promise<WasmPatchInstance> {
  let node: PdNode | undefined;
  let manifest: Manifest = { inputs: {}, outputs: {} };
  let enabled = false;
  let loadingPromise: Promise<void> | undefined;
  let destroyed = false;
  let targetGain = Math.max(0, Math.min(1.0, initialGain));

  const isSpatial = !!spatial;
  const gainNode = context.createGain();
  gainNode.gain.setValueAtTime(0, context.currentTime);

  let pannerNode: PannerNode | undefined;
  if (isSpatial) {
    pannerNode = context.createPanner();
    pannerNode.panningModel = "HRTF";
    pannerNode.distanceModel = "inverse";
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 50;
    pannerNode.rolloffFactor = 1.4;
    pannerNode.positionX.setValueAtTime(spatial.x, context.currentTime);
    pannerNode.positionY.setValueAtTime(spatial.y, context.currentTime);
    pannerNode.positionZ.setValueAtTime(spatial.z, context.currentTime);

    gainNode.connect(pannerNode);
    pannerNode.connect(destination);
  } else {
    gainNode.connect(destination);
  }

  // WASM 모듈 및 런타임 비동기 초기화
  async function ensureInitialized() {
    if (node) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      const [patchResponse, ioResponse] = await Promise.all([
        fetch(`${baseUrl}${patchName}.wasm`),
        fetch(`${baseUrl}${patchName}.io.json`),
      ]);
      if (!patchResponse.ok || !ioResponse.ok) {
        throw new Error(`Pd 패치(${patchName}) 로드 실패`);
      }
      const [patch, ioJson]: [ArrayBuffer, Manifest] = await Promise.all([
        patchResponse.arrayBuffer(),
        ioResponse.json(),
      ]);
      manifest = ioJson;

      await loadRuntime(`${baseUrl}webpd-runtime.js`);
      await window.WebPdRuntime.initialize(context);

      node = await window.WebPdRuntime.run(context, patch, {
        messageHandler(_node, event) {
          if (event.data.type !== "io:messageSender") return;
          const { nodeId, portletId, message } = event.data.payload;
          const bus = Object.keys(manifest.outputs).find((name) => {
            const port = manifest.outputs[name];
            return port.nodeId === nodeId && port.portletId === portletId;
          });
          if (bus && receive) receive(bus, message);
        },
      });

      node.onprocessorerror = () => {
        console.error(`[WasmPatch:${id}] 오디오 프로세서 오류 발생`);
      };

      node.connect(gainNode);
    })();

    await loadingPromise;
    loadingPromise = undefined;
  }

  const instance: WasmPatchInstance = {
    id,
    patchName,
    isSpatial,

    async enable() {
      if (destroyed || enabled) return;
      await ensureInitialized();
      if (destroyed) return;

      enabled = true;
      const now = context.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      // 15ms 부드러운 페이드인으로 클릭 팝 노이즈 방지
      gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.015);
    },

    disable() {
      if (destroyed || !enabled) return;
      enabled = false;
      const now = context.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      // 15ms 부드러운 페이드아웃
      gainNode.gain.linearRampToValueAtTime(0, now + 0.015);
    },

    isEnabled() {
      return enabled;
    },

    setPosition(x: number, y: number, z: number) {
      if (!pannerNode || destroyed) return;
      const now = context.currentTime;
      pannerNode.positionX.setValueAtTime(x, now);
      pannerNode.positionY.setValueAtTime(y, now);
      pannerNode.positionZ.setValueAtTime(z, now);
    },

    setGain(volume: number) {
      targetGain = Math.max(0, Math.min(1.0, volume));
      if (enabled && !destroyed) {
        const now = context.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.015);
      }
    },

    send(bus: string, message: PdMessage) {
      if (destroyed || !node) return;
      const port = manifest.inputs[bus];
      if (!port) return;
      node.port.postMessage({ type: "io:messageReceiver", payload: { ...port, message } });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      enabled = false;
      instance.disable();
      try {
        node?.destroy();
        node?.disconnect();
        gainNode.disconnect();
        pannerNode?.disconnect();
      } catch (e) {
        // Safe cleanup
      }
      node = undefined;
    },
  };

  return instance;
}
