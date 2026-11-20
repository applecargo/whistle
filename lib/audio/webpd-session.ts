// 상호작용 패치(uwb-player.pd)의 버스 인터페이스.
// 에디터 편집음(whistle-edit), 3D 이동(whistle-player), 규칙 이벤트(whistle-event),
// 음소거(whistle-gate), UWB 보드 높이(whistle-board-height)를 보낸다.
// 패치는 패치별 빌드(named patch)로 로드한다: webpd-runtime의 startPatch.
import { startPatch, type PdMessage } from "./webpd-runtime.ts";

export type { PdMessage };
export const INTERACTION_PATCH = "uwb-player";

export type EditSound = {
  x: number; z: number; overlap: number;
  asset?: string; action?: string; surface?: string;
};
export type PlayerSound = {
  x: number; y: number; z: number; grass: number; rough: number;
  grounded?: boolean; falling?: boolean; yaw?: number; water?: number;
};

export function validateBoardHeight(height: number) {
  if (!Number.isFinite(height) || height < 0 || height > 10) {
    throw new Error("보드 높이는 0~10m 사이의 유한한 숫자여야 합니다.");
  }
  return height;
}

const bounded = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) throw new Error("오디오 파라미터는 유한한 숫자여야 합니다.");
  return Math.max(min, Math.min(max, value));
};

type Sender = { send(bus: string, message: PdMessage): void };

/** 상호작용 패치의 버스별 메시지를 값 검사와 함께 보낸다. */
export function interactionMessages(patch: Sender) {
  const send = patch.send.bind(patch);
  return {
    edit({ x, z, overlap, asset, action, surface }: EditSound) {
      send("whistle-edit", [bounded(x, 0, 1), bounded(z, 0, 1), bounded(overlap, 0, 1),
        ...(asset === undefined ? [] : [asset, action ?? "paint", surface ?? "plain"])]);
    },
    player({ x, y, z, grass, rough, grounded, falling, yaw, water }: PlayerSound) {
      send("whistle-player", [
        bounded(x, 0, 1), bounded(y, -1000, 1000), bounded(z, 0, 1),
        bounded(grass, 0, 1), bounded(rough, 0, 1),
        ...(grounded === undefined ? [] : [Number(grounded), Number(!!falling),
          bounded(yaw ?? 0, -1e6, 1e6), bounded(water ?? 0, 0, 1)]),
      ]);
    },
    stopPlayer() { send("whistle-player-stop", ["bang"]); },
    boardHeight(height: number) { send("whistle-board-height", [validateBoardHeight(height)]); },
    event(frequency: number, gain: number, pan: number) {
      send("whistle-event", [bounded(frequency, 20, 20000), bounded(gain, 0, 0.12), bounded(pan, -1, 1)]);
    },
    mute(muted: boolean) { send("whistle-gate", [muted ? 0 : 1]); },
  };
}

/**
 * 상호작용 패치를 시작한다. context를 주면 그 AudioContext를 공유하고(닫지 않음),
 * 주지 않으면 새로 만들고 close() 때 닫는다. output을 주면 거기로, 아니면 destination으로 연결한다.
 */
export async function createInteractionSession(
  baseUrl: string,
  receive: (bus: string, message: PdMessage) => void,
  shared?: { context: AudioContext; output?: AudioNode },
) {
  const context = shared?.context ?? new AudioContext();
  const owned = !shared;
  try {
    await context.resume();
    const patch = await startPatch(context, baseUrl, INTERACTION_PATCH, receive, { ready: "whistle-ready" });
    patch.node.connect(shared?.output ?? context.destination);
    let closed = false;
    return {
      context,
      node: patch.node,
      ...interactionMessages(patch),
      async close() {
        if (closed) return;
        closed = true;
        patch.destroy();
        if (owned) await context.close();
      },
    };
  } catch (error) {
    if (owned) await context.close();
    throw error;
  }
}

export type InteractionSession = Awaited<ReturnType<typeof createInteractionSession>>;
