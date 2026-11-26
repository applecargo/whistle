import { useEffect, useRef } from "react";
import { uid } from "../lib/world";
import { LIVE_WORLD_CHANNEL } from "../lib/live-world";
import type { Position2D, RoomMapping } from "../lib/uwb-position";
import { TRACKING_TIMEOUT_MS } from "../lib/uwb/protocol";

// Room position may still be valid beside a monitor outside the walkable grid.
export function useVisitorPublisher(target: string | null, room: Position2D | null, grid: Position2D | null,
  tag: string, receivedAt: number | undefined, mapping: RoomMapping) {
  const latest = useRef({ room, grid, receivedAt });
  latest.current = { room, grid, receivedAt };
  const send = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!target || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(LIVE_WORLD_CHANNEL);
    const stream = uid();
    channel.postMessage({ type: "display-mapping", target, mapping });
    const post = (position: Position2D | null, point: Position2D | null) =>
      channel.postMessage({ type: "visitor-input", target, stream, room: position,
        grid: point && { x: point.x, z: point.z }, at: Date.now() });
    send.current = () => {
      const sample = latest.current;
      const valid = sample.room && (sample.receivedAt === undefined || Date.now() - sample.receivedAt <= TRACKING_TIMEOUT_MS);
      post(valid ? sample.room : null, valid ? sample.grid : null);
    };
    const timer = window.setInterval(() => send.current?.(), 500);
    const clear = () => post(null, null);
    window.addEventListener("pagehide", clear);
    return () => {
      clearInterval(timer); window.removeEventListener("pagehide", clear);
      clear(); channel.close(); send.current = null;
    };
  }, [target, tag, mapping]);
  useEffect(() => { send.current?.(); }, [room, grid, receivedAt, target, tag, mapping]);
}
