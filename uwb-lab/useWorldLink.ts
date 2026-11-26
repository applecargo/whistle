import { useState } from "react";
import { validateWorld, type World } from "../lib/world";
import { upgradeTerrain } from "../lib/terrain";
import { MAX_LIBRARY_SIZE } from "../lib/content-limits";
import type { RoomMapping } from "../lib/uwb-position";
import { WORLD_PATH, parseWorldLink } from "../lib/uwb/world-link";
import { useSocket } from "../components/whistle/useSocket";

/** 플레이어 PC: 키오스크가 UWB 수신기로 보낸 맵과 전시장 매핑을 받는다(lib/uwb/world-link.ts). bridge: undefined면 끔 */
export function useWorldLink(bridge: string | undefined, receive: (world: World) => void) {
  const [mapping, setMapping] = useState<RoomMapping | null>(null);
  const [error, setError] = useState("");
  let url: URL | null | undefined;
  try { url = bridge === undefined ? undefined : new URL(WORLD_PATH, bridge); } catch { url = null; }
  const link = useSocket(url, () => {}, (data) => {
    try {
      if (typeof data !== "string") throw new Error("맵 메시지 형식 오류");
      const message = parseWorldLink(data);
      receive(upgradeTerrain(validateWorld(message.world, MAX_LIBRARY_SIZE)));
      setMapping(message.mapping);
      setError("");
    } catch (e) { setError(`키오스크 맵을 읽을 수 없습니다: ${(e as Error).message}`); }
  });
  return { state: link.state, mapping, error, received: !!mapping };
}
