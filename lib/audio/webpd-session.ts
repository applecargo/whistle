// 상호작용 패치들의 버스 인터페이스. 패치별 빌드(named patch)로 각각 로드한다.
// - edit.pd   : whistle-edit           (에디터 편집음)
// - player.pd : whistle-player, whistle-board-height (3D 이동음, UWB 보드 높이)
// - event.pd  : whistle-event          (시뮬레이션 규칙 이벤트음)
// 켜고 끄기는 Pd 메시지(whistle-gate, whistle-player-stop) 대신 WebAudio 게인 fade로 한다.
import { startPatch, type PdMessage, type PatchInstance } from "./webpd-runtime.ts";

export type { PdMessage };
export const INTERACTION_PATCHES = { edit: "edit", player: "player", event: "event" } as const;
/** 음소거·이동음 정지 fade 길이(초) */
const FADE = 0.03;

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

type Sender = Pick<PatchInstance, "send">;

/** 버스별 메시지를 값 검사와 함께 해당 패치로 보낸다. */
export function interactionMessages(patches: { edit: Sender; player: Sender; event: Sender }) {
  return {
    edit({ x, z, overlap, asset, action, surface }: EditSound) {
      patches.edit.send("whistle-edit", [bounded(x, 0, 1), bounded(z, 0, 1), bounded(overlap, 0, 1),
        ...(asset === undefined ? [] : [asset, action ?? "paint", surface ?? "plain"])]);
    },
    player({ x, y, z, grass, rough, grounded, falling, yaw, water }: PlayerSound) {
      patches.player.send("whistle-player", [
        bounded(x, 0, 1), bounded(y, -1000, 1000), bounded(z, 0, 1),
        bounded(grass, 0, 1), bounded(rough, 0, 1),
        ...(grounded === undefined ? [] : [Number(grounded), Number(!!falling),
          bounded(yaw ?? 0, -1e6, 1e6), bounded(water ?? 0, 0, 1)]),
      ]);
    },
    boardHeight(height: number) { patches.player.send("whistle-board-height", [validateBoardHeight(height)]); },
    event(frequency: number, gain: number, pan: number) {
      patches.event.send("whistle-event", [bounded(frequency, 20, 20000), bounded(gain, 0, 0.12), bounded(pan, -1, 1)]);
    },
  };
}

function fadeTo(param: AudioParam, target: number, context: BaseAudioContext) {
  const now = context.currentTime;
  const current = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  param.linearRampToValueAtTime(target, now + FADE);
}

/**
 * 상호작용 패치 세 개를 시작한다(각각 whistle-ready를 받은 뒤).
 * context를 주면 그 AudioContext를 공유하고(닫지 않음), 주지 않으면 새로 만들고 close() 때 닫는다.
 * 출력: edit/event → 세션 출력 게인, player → 이동음 게인 → 세션 출력 게인 → output(없으면 destination).
 */
export async function createInteractionSession(
  baseUrl: string,
  receive: (bus: string, message: PdMessage) => void,
  shared?: { context: AudioContext; output?: AudioNode },
) {
  const context = shared?.context ?? new AudioContext();
  const owned = !shared;
  const started: PatchInstance[] = [];
  try {
    await context.resume();
    // 하나가 실패해도 나머지가 끝날 때까지 기다려야 늦게 시작된 패치를 정리할 수 있다.
    const results = await Promise.allSettled([INTERACTION_PATCHES.edit, INTERACTION_PATCHES.player, INTERACTION_PATCHES.event]
      .map((name) => startPatch(context, baseUrl, name, receive, { ready: "whistle-ready" })));
    for (const result of results) if (result.status === "fulfilled") started.push(result.value);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const [edit, player, event] = started;
    const output = context.createGain();
    const playerGain = context.createGain();
    output.connect(shared?.output ?? context.destination);
    edit.node.connect(output);
    event.node.connect(output);
    player.node.connect(playerGain).connect(output);
    const messages = interactionMessages({ edit, player, event });
    let playerOn = true;
    let closed = false;
    return {
      context,
      /** 세션 전체 출력(측정·연결용) */
      node: output,
      ...messages,
      player(sound: PlayerSound) {
        messages.player(sound);
        if (!playerOn) { playerOn = true; fadeTo(playerGain.gain, 1, context); }
      },
      /** 3D 이동음만 끈다. 다음 player() 때 다시 켠다. */
      stopPlayer() {
        if (!playerOn) return;
        playerOn = false;
        fadeTo(playerGain.gain, 0, context);
      },
      /** 세션 전체 음소거(편집음·이동음·이벤트음) */
      mute(muted: boolean) { fadeTo(output.gain, muted ? 0 : 1, context); },
      async close() {
        if (closed) return;
        closed = true;
        for (const patch of started) patch.destroy();
        output.disconnect();
        if (owned) await context.close();
      },
    };
  } catch (error) {
    for (const patch of started) patch.destroy();
    if (owned) await context.close();
    throw error;
  }
}

export type InteractionSession = Awaited<ReturnType<typeof createInteractionSession>>;
