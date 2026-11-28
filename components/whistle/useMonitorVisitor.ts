import { useEffect, useRef } from "react";
import { nearestGrassVisitor, selectMonitorTag, type DisplayMount, type VisitorPose } from "@/lib/display-proximity";
import { parseBridgeMessage } from "@/lib/uwb/protocol";
import { useSocket } from "./useSocket";

export function useMonitorVisitor(address: URL | null, mount: DisplayMount, trackGrass: boolean) {
  const poses = useRef(new Map<string, VisitorPose>());
  const selected = useRef<string | undefined>(undefined);
  const visitor = useRef<VisitorPose | null>(null);
  const grassVisitor = useRef<VisitorPose | null>(null);
  const link = useSocket(address, () => {}, data => {
    if (typeof data !== "string") return;
    let message;
    try { message = parseBridgeMessage(data); } catch { return; }
    if (message.type === "ranges" || !/^[0-3]$/.test(message.tagId)) return;
    const now = Date.now();
    if (message.type === "invalid") poses.current.delete(message.tagId);
    else poses.current.set(message.tagId, { room: { x: message.x, z: message.z }, at: now });
    if (trackGrass) grassVisitor.current = nearestGrassVisitor(mount, poses.current.values(), now);
    selected.current = selectMonitorTag(mount, poses.current, selected.current, now);
    visitor.current = selected.current ? poses.current.get(selected.current)! : null;
  });
  useEffect(() => {
    if (link.state === "connected") return;
    poses.current.clear();
    grassVisitor.current = null;
    selected.current = undefined;
    visitor.current = null;
  }, [link.state]);
  return { visitor, grassVisitor };
}
