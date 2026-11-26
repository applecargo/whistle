// 키오스크 → 플레이어 PC들: 맵(통째)과 전시장 매핑. UWB 수신기(scripts/uwb/bridge.ts)의 WORLD_PATH로 오간다.
//   키오스크가 맵이 바뀔 때마다 { type: "world", world, mapping }을 보내고, 수신기는 마지막 것을 들고 있다가
//   다른 접속(플레이어)에 그대로 돌린다. 늦게 붙은 플레이어도 접속하자마자 마지막 맵을 받는다.
// 위치(태그 0~3)는 지금처럼 수신기의 기본 주소("/")로 간다. 두 길이 섞이지 않아 기존 UWB 페이지는 그대로 돈다.
import type { RoomMapping } from "../uwb-position.ts";

export const WORLD_PATH = "/world";
/** 맵 메시지 최대 크기(업로드한 소리는 이 모드에서 쓰지 않는다. 그림 재료가 많아도 넉넉하게) */
export const MAX_WORLD_BYTES = 16_000_000;
export type WorldLinkMessage = { type: "world"; world: unknown; mapping: RoomMapping };

const mappingKeys = ["originX", "originZ", "width", "depth", "rotation"] as const;
export function validMapping(value: unknown): value is RoomMapping {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return mappingKeys.every((key) => typeof m[key] === "number" && Number.isFinite(m[key]))
    && (m.width as number) > 0 && (m.depth as number) > 0;
}

/** 맵 메시지를 읽는다. world는 받는 쪽이 validateWorld로 다시 검사한다 */
export function parseWorldLink(text: string): WorldLinkMessage {
  if (text.length > MAX_WORLD_BYTES) throw new Error("맵이 너무 큽니다.");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("맵 메시지 형식 오류");
  const message = value as Record<string, unknown>;
  if (message.type !== "world" || !message.world || typeof message.world !== "object" || !validMapping(message.mapping))
    throw new Error("맵 메시지 형식 오류");
  return message as WorldLinkMessage;
}
