import type { Environment } from "../environment.ts";
import { flatTerrain } from "../terrain.ts";
import { starterWorld } from "../world.ts";
import type { Position2D } from "../uwb-position.ts";

export type WaterLayout = "connected" | "scattered";
export function createSoundscapeWorld(layout: WaterLayout = "connected") {
  const world = starterWorld();
  world.title = "사운드스케이프 · 풀과 물";
  world.start = { x: 5, z: 10 };
  world.assets = [
    { id: "circle", name: "A", shape: "image", color: "#111111", solid: false,
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAICAQAAACfDS2NAAAAHklEQVR4nGMQZECGEOo/GEK5/wVhgti5MEiEYiQIAKTpE6mhEPkNAAAAAElFTkSuQmCC" },
    { id: "square", name: "B", shape: "image", color: "#111111", solid: false,
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAICAQAAACfDS2NAAAAG0lEQVR4nGMQZECGIOI/FMK5ELn/xMniU4wEASd1FadyDEK9AAAAAElFTkSuQmCC" },
  ];
  world.objects = [
    { id: "A", asset: "circle", x: 5, z: 7, rotation: 0, scale: 1 },
    { id: "B", asset: "square", x: 5, z: 4, rotation: 0, scale: 1 },
  ];
  world.terrain = flatTerrain(world.size);
  for (let z = 1; z <= 6; z++) {
    const x = layout === "connected" || z % 2 === 0 ? 6 : 4;
    world.terrain.tiles[z * world.size + x].surface = "slick";
  }
  for (let z = 7; z <= 8; z++) {
    for (const x of [5, 6]) world.terrain.tiles[z * world.size + x].surface = "soft";
  }
  return world;
}

const spans = new WeakMap<Environment, Float32Array>();
function pondSpans(environment: Environment) {
  const cached = spans.get(environment);
  if (cached) return cached;
  const span = new Float32Array(environment.cells.length);
  for (const pond of environment.ponds) {
    const extent = Math.min(1, (pond.cells.length - 1) / 5);
    for (const cell of pond.cells) span[cell] = extent;
  }
  spans.set(environment, span);
  return span;
}

export function habitatAt(environment: Environment, position: Position2D) {
  const { x, z } = position;
  const spans = pondSpans(environment);
  let grass = 0, water = 0, extent = 0, total = 0;
  for (let row = Math.max(0, Math.ceil(z - 2)); row <= Math.min(environment.size - 1, z + 2); row++) {
    for (let col = Math.max(0, Math.ceil(x - 2)); col <= Math.min(environment.size - 1, x + 2); col++) {
      const weight = Math.max(0, 2 - Math.hypot(x - col, z - row));
      const index = row * environment.size + col;
      const cell = environment.cells[index];
      grass += weight * cell.grass;
      if (cell.water !== null) {
        water += weight;
        extent += weight * spans[index];
      }
      total += weight;
    }
  }
  return { grass: total ? grass / total : 0, water: total ? water / total : 0, extent: water ? extent / water : 0 };
}

export const routeIntervalMs = 100;
export function comparisonRoute(): Position2D[] {
  const points: Position2D[] = [];
  const leg = (from: number, to: number, steps: number) => {
    for (let i = 1; i <= steps; i++) points.push({ x: 5, z: from + (to - from) * i / steps });
  };
  points.push({ x: 5, z: 10 });
  leg(10, 7, 20);
  leg(7, 7, 20);
  leg(7, 3, 40);
  leg(3, 3, 40);
  return points;
}

export type PhraseRoute = "stay" | "follow";
export type VisitRoute = "pass" | "listen";
export const resonanceListeningPoint = { x: 5, z: 6 };

const connectivityCache = new WeakMap<Environment, number>();
export function waterConnectivity(environment: Environment) {
  const cached = connectivityCache.get(environment);
  if (cached !== undefined) return cached;
  let largest = 0, total = 0;
  for (const pond of environment.ponds) {
    largest = Math.max(largest, pond.cells.length);
    total += pond.cells.length;
  }
  const connected = total > 1 ? (largest - 1) / (total - 1) : 0;
  connectivityCache.set(environment, connected);
  return connected;
}

export function resonanceAt(environment: Environment, point?: Position2D) {
  const sources = locatePhraseSources(environment);
  const grass = point ? phraseMix(sources, point).grass : Number(sources.grass !== null);
  return { grass, water: environment.ponds.length ? grass : 0, extent: waterConnectivity(environment) };
}
export type ListeningZone = "away" | "grass" | "bank";

type PhraseSources = { grass: Position2D | null; water: Position2D | null; travelMs: number };
const phraseSources = new WeakMap<Environment, PhraseSources>();

export function locatePhraseSources(environment: Environment): PhraseSources {
  const cached = phraseSources.get(environment);
  if (cached) return cached;
  const { size, cells, ponds } = environment;
  let strongest = 0, grass: Position2D | null = null;
  for (const [index, cell] of cells.entries()) {
    if (cell.grass <= strongest || cell.hole) continue;
    strongest = cell.grass;
    grass = { x: index % size, z: Math.floor(index / size) };
  }
  let water: Position2D | null = null, distance = Infinity;
  if (grass) {
    for (const pond of ponds) {
      if (!pond.cells.length) continue;
      const center = { x: 0, z: 0 };
      for (const index of pond.cells) {
        center.x += index % size;
        center.z += Math.floor(index / size);
      }
      center.x /= pond.cells.length;
      center.z /= pond.cells.length;
      const separation = Math.hypot(center.x - grass.x, center.z - grass.z);
      if (separation < distance) { distance = separation; water = center; }
    }
  }
  const sources = { grass, water, travelMs: Math.min(4800, 2000 + 400 * distance) };
  phraseSources.set(environment, sources);
  return sources;
}

export function phraseMix(sources: PhraseSources, point: Position2D) {
  const gain = (source: Position2D | null) => source
    ? 1 / (1 + .22 * ((source.x - point.x) ** 2 + (source.z - point.z) ** 2)) : 0;
  return { grass: gain(sources.grass), water: gain(sources.water) };
}

export function phraseRoute(kind: PhraseRoute): Position2D[] {
  const start = { x: 5, z: 7 }, bank = { x: 5, z: 3.5 };
  return Array.from({ length: 71 }, (_, tick) => {
    const progress = kind === "stay" ? 0 : Math.max(0, Math.min(1, (tick - 12) / 20));
    return { x: start.x, z: start.z + (bank.z - start.z) * progress };
  });
}

export function listeningZone(sources: PhraseSources, point: Position2D, previous: ListeningZone = "away"): ListeningZone {
  const distance = (source: Position2D | null) => source ? Math.hypot(source.x - point.x, source.z - point.z) : Infinity;
  const grass = distance(sources.grass), bank = distance(sources.water);
  if (previous === "grass" && grass < 1.3 && grass <= bank) return "grass";
  if (previous === "bank" && bank < 1.8 && bank <= grass) return "bank";
  if (grass <= 1 && grass <= bank) return "grass";
  if (bank <= 1.45 && bank < grass) return "bank";
  return "away";
}

export function visitRoute(kind: VisitRoute): Position2D[] {
  const points: Position2D[] = [{ x: 5, z: 7 }];
  const moveTo = (x: number, z: number, endTick: number) => {
    const from = points[points.length - 1], steps = endTick + 1 - points.length;
    for (let i = 1; i <= steps; i++) {
      points.push({ x: from.x + (x - from.x) * i / steps, z: from.z + (z - from.z) * i / steps });
    }
  };
  if (kind === "listen") moveTo(5, 7, 13);
  moveTo(5, 5.4, kind === "pass" ? 6 : 20);
  moveTo(5, 5.4, 20);
  moveTo(5, 4.5, 33);
  moveTo(5, 4.5, 45);
  moveTo(3.5, 4.5, 54);
  moveTo(3.5, 4.5, 132);
  return points;
}
