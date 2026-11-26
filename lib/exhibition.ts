import type { Actor, World } from "./world.ts";

export const sectors = ["A1", "B1", "C1", "A2", "B2", "C2", "A3", "B3", "C3"] as const;
export type Sector = typeof sectors[number];
export const trailLifetime = 30_000;
export type TrailSegment = { x: number; z: number; endX: number; endZ: number; time: number };
export type SectorSnapshot = { world: World; actors: Actor[]; trail: TrailSegment[] };

export function sectorBounds(size: number, sector: Sector) {
  const span = size * 2 / 3;
  const x = -size + "ABC".indexOf(sector[0]) * span;
  const z = -size + (Number(sector[1]) - 1) * span;
  return { x, z, span };
}

export function createTrailRecorder() {
  let previous: { x: number; z: number; time: number } | undefined;
  let history: TrailSegment[] = [];
  const recent = (now: number) => {
    history = history.filter(s => s.time > now - trailLifetime);
    return history;
  };
  return {
    recent,
    reset() { previous = undefined; history = []; },
    record(x: number, z: number, grounded: boolean, now: number) {
      const start = previous;
      previous = grounded ? { x, z, time: now } : undefined;
      recent(now);
      if (!grounded || !start || now - start.time > 1000) return;
      const distance = Math.hypot(x - start.x, z - start.z);
      if (distance < .00001 || distance > 1) return;
      const segment = { x: start.x, z: start.z, endX: x, endZ: z, time: now };
      history.push(segment);
      return segment;
    },
  };
}
