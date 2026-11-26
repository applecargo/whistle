import { useEffect, useRef } from "react";
import { defaultRoom } from "../../lib/uwb-position";
import { createTrailRecorder } from "../../lib/exhibition";
import type { VisitorPose } from "../../lib/display-proximity";
import { uid, type Actor, type World } from "../../lib/world";
import { LIVE_WORLD_CHANNEL } from "../../lib/live-world";

export function useLiveWorldPublisher(world: World, ready: boolean, actors: Actor[], playKey: number) {
  const current = useRef({ world, ready, actors });
  current.current = { world, ready, actors };
  const channel = useRef<BroadcastChannel | null>(null);
  const source = useRef("");
  const trail = useRef(createTrailRecorder());
  const offlineTrail = useRef(createTrailRecorder());
  const visitor = useRef<VisitorPose | null>(null);
  const visitorStream = useRef("");
  const roomMapping = useRef(defaultRoom);
  const snapshot = () => {
    const state = current.current;
    channel.current?.postMessage(state.ready ? { type: "world", source: source.current, world: state.world,
      actors: state.actors, mapping: roomMapping.current, visitor: visitor.current,
      trail: [...trail.current.recent(Date.now()), ...offlineTrail.current.recent(Date.now())].sort((a, b) => a.time - b.time) } : { type: "unavailable", source: source.current });
  };

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    source.current = uid();
    const connection = new BroadcastChannel(LIVE_WORLD_CHANNEL);
    channel.current = connection;
    const send = (type: string) => connection.postMessage({ type, source: source.current });
    connection.onmessage = ({ data }) => {
      if (data?.target && data.target !== source.current) return;
      if (data?.type === "display-mapping" && data.target === source.current) {
        const m = data.mapping;
        if (m && [m.originX, m.originZ, m.width, m.depth, m.rotation].every(Number.isFinite) && m.width > 0 && m.depth > 0) {
          roomMapping.current = m;
          connection.postMessage({ type: "mapping", source: source.current, mapping: m });
        }
      }
      if (data?.type === "visitor-input" && current.current.ready && data.target === source.current) {
        const now = Date.now();
        if (typeof data.stream !== "string" || !Number.isFinite(data.at) || Math.abs(now - data.at) > 1500) return;
        if (visitor.current && visitorStream.current !== data.stream && now - visitor.current.at < 1500) return;
        const hasRoom = Number.isFinite(data.room?.x) && Number.isFinite(data.room?.z);
        if (!hasRoom && data.stream !== visitorStream.current) return;
        const hasGrid = hasRoom && Number.isFinite(data.grid?.x) && Number.isFinite(data.grid?.z);
        if (visitorStream.current !== data.stream) offlineTrail.current.record(0, 0, false, now);
        visitorStream.current = data.stream;
        visitor.current = hasRoom ? { room: data.room, at: data.at } : null;
        const segment = offlineTrail.current.record(data.grid?.x ?? 0, data.grid?.z ?? 0, hasGrid, data.at);
        connection.postMessage({ type: "visitor", source: source.current, visitor: visitor.current, segment });
      }
      if (data?.type === "request") snapshot();
      if (data?.type === "ping") send(current.current.ready ? "alive" : "unavailable");
    };
    const leaving = () => send("closed");
    window.addEventListener("pagehide", leaving);
    window.addEventListener("pageshow", snapshot);
    return () => {
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("pageshow", snapshot);
      leaving();
      connection.close();
      channel.current = null;
    };
  }, []);

  useEffect(() => {
    trail.current.reset();
    offlineTrail.current.reset();
    visitor.current = null;
    snapshot();
  }, [world, ready]);

  useEffect(() => {
    trail.current.reset();
    snapshot();
  }, [playKey]);

  useEffect(() => {
    if (ready && world.rules.length)
      channel.current?.postMessage({ type: "actors", source: source.current, actors });
  }, [actors, ready, world]);

  return (x: number, z: number, grounded: boolean) => {
    const segment = trail.current.record(x, z, grounded, Date.now());
    if (segment) channel.current?.postMessage({ type: "trail", source: source.current, segment });
  };
}
