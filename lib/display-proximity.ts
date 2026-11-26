import type { Monitor } from "./observation.ts";
import type { Sector } from "./exhibition.ts";
import type { Position2D } from "./uwb-position.ts";

export type DisplayMount = Position2D & { facing: number };
export type VisitorPose = { room: Position2D; at: number };

const monitorLocations: Record<Monitor, [number, number]> = {
  M1: [1, .8], M2: [4.8, .8], M3: [3, 3],
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

const smooth = (fraction: number) => {
  const t = Math.min(1, Math.max(0, fraction));
  return t * t * (3 - 2 * t);
};

// 0° faces room +Z, 90° faces +X. In front of a 0° screen the viewer's right is +X.
export function cameraOffset(mount: DisplayMount, visitor: VisitorPose | null, now: number) {
  if (!visitor || now - visitor.at > 1500) return { yaw: 0, tilt: 0 };
  const angle = mount.facing * Math.PI / 180;
  const dx = visitor.room.x - mount.x, dz = visitor.room.z - mount.z;
  const forward = dx * Math.sin(angle) + dz * Math.cos(angle);
  const side = dx * Math.cos(angle) - dz * Math.sin(angle);
  const near = smooth((1.8 - Math.hypot(dx, dz)) / 1.4) * smooth(forward / .25);
  if (near === 0) return { yaw: 0, tilt: 0 };
  return {
    yaw: near * Math.sign(side) * smooth((Math.abs(side) - .10) / .65) * 10 * Math.PI / 180,
    tilt: near * 3 * Math.PI / 180,
  };
}
