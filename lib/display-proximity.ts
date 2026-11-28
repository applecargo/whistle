import { TRACKING_TIMEOUT_MS } from "./uwb/protocol.ts";
import type { Monitor } from "./observation.ts";
import type { Sector } from "./exhibition.ts";
import type { Position2D } from "./uwb-position.ts";

export type DisplayMount = Position2D & { facing: number };
export type VisitorPose = { room: Position2D; at: number };

const monitorLocations: Record<Monitor, [number, number]> = {
  M1: [1, .8], M2: [4.8, .8], M3: [3, 3], M4: [4.8, 4.8],
};

export function exampleMount(sector: Sector | Monitor): DisplayMount {
  if (sector in monitorLocations) {
    const [x, z] = monitorLocations[sector as Monitor];
    return { x, z, facing: 0 };
  }
  return { x: 1 + 2 * "ABC".indexOf(sector[0]), z: (Number(sector[1]) - 1) * 2, facing: 0 };
}

export function readMount(sector: Sector | Monitor, query: URLSearchParams): DisplayMount {
  const values = ["mx", "mz", "face"].map(key => {
    const value = query.get(key)?.trim();
    return value ? Number(value) : NaN;
  });
  return values.every(Number.isFinite) ? { x: values[0], z: values[1], facing: values[2] } : exampleMount(sector);
}

const reactionRadius = 2;

export function selectMonitorTag(mount: DisplayMount, poses: ReadonlyMap<string, VisitorPose>, current: string | undefined, now: number) {
  const angle = mount.facing * Math.PI / 180;
  let nearest: string | undefined, best = Infinity;
  for (const [tag, pose] of poses) {
    if (now - pose.at > TRACKING_TIMEOUT_MS) continue;
    const dx = pose.room.x - mount.x, dz = pose.room.z - mount.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= reactionRadius || dx * Math.sin(angle) + dz * Math.cos(angle) <= 0) continue;
    const score = distance - (tag === current ? .2 : 0);
    if (score < best) { best = score; nearest = tag; }
  }
  return nearest;
}

const smooth = (fraction: number) => {
  const t = Math.min(1, Math.max(0, fraction));
  return t * t * (3 - 2 * t);
};

export function nearestGrassVisitor(mount: DisplayMount, poses: Iterable<VisitorPose>, now: number) {
  let nearest: VisitorPose | null = null;
  let distance = reactionRadius;
  for (const pose of poses) {
    if (now - pose.at > TRACKING_TIMEOUT_MS) continue;
    const d = Math.hypot(pose.room.x - mount.x, pose.room.z - mount.z);
    if (d < distance) { nearest = pose; distance = d; }
  }
  return nearest;
}

export function grassSwaySpeed(mount: DisplayMount, visitor: VisitorPose | null, now: number) {
  if (!visitor || now - visitor.at > TRACKING_TIMEOUT_MS) return 1;
  const distance = Math.hypot(visitor.room.x - mount.x, visitor.room.z - mount.z);
  return 1 + .35 * smooth((reactionRadius - distance) / (reactionRadius - .4));
}

// 0° faces room +Z, 90° faces +X. In front of a 0° screen the viewer's right is +X.
export function cameraOffset(mount: DisplayMount, visitor: VisitorPose | null, now: number) {
  if (!visitor || now - visitor.at > 1500) return { yaw: 0, tilt: 0 };
  const angle = mount.facing * Math.PI / 180;
  const dx = visitor.room.x - mount.x, dz = visitor.room.z - mount.z;
  const forward = dx * Math.sin(angle) + dz * Math.cos(angle);
  const side = dx * Math.cos(angle) - dz * Math.sin(angle);
  const near = smooth((reactionRadius - Math.hypot(dx, dz)) / (reactionRadius - .4)) * smooth(forward / .25);
  if (near === 0) return { yaw: 0, tilt: 0 };
  return {
    yaw: near * Math.sign(side) * smooth((Math.abs(side) - .10) / .65) * 12 * Math.PI / 180,
    tilt: near * 3 * Math.PI / 180,
  };
}
