import type { Environment } from "./environment.ts";
import { terrainSample } from "./terrain.ts";
import { treeAppearance } from "./vegetation.ts";
import type { Actor, World } from "./world.ts";
import type { Position2D } from "./uwb-position.ts";

export const monitors = ["M1", "M2", "M3", "M4"] as const;
export type Monitor = typeof monitors[number];

export type Subject = Position2D & { id: string; y: number; height: number };

export function observationSubjects(world: World, environment: Environment, actors: Actor[]): Subject[] {
  const subjects: Subject[] = [], land: Subject[] = [];
  const size = world.size;
  for (let i = 0; i < environment.cells.length; i++) {
    const cell = environment.cells[i], tile = world.terrain?.tiles[i];
    if (cell.hole || !tile) continue;
    const x = i % size, z = Math.floor(i / size);
    const kind = cell.tree ? "tree" : cell.water !== null ? "water" : cell.grass > 0 ? "grass"
      : tile.surface === "rough" ? "stone" : tile.height !== 0 ? "land" : null;
    if (!kind) continue;
    let height = .35;
    if (kind === "tree") {
      const tree = treeAppearance(world.terrain!.seed, x, z);
      height = tree.height * tree.scale;
    }
    const ground = cell.water ?? terrainSample(world, x, z).height;
    (kind === "land" ? land : subjects).push({ id: kind + "-" + i, x, z, y: ground + height * .38, height });
  }
  const assets = new Map(world.assets.map(asset => [asset.id, asset]));
  for (const a of actors) {
    const asset = assets.get(a.asset);
    if (a.removed || !(asset?.image || asset?.text?.trim())) continue;
    const y = terrainSample(world, a.x, a.z).height;
    subjects.unshift({ id: a.id, x: a.x, z: a.z, y: y + .5 * a.scale, height: a.scale });
  }
  return subjects.length ? subjects : land;
}

export function chooseSubject(subjects: Subject[], anchor: Position2D, previous?: string) {
  let nearest: Subject | undefined, held: Subject | undefined;
  let best = Infinity;
  const distance = (s: Subject) => Math.hypot(anchor.x - s.x, anchor.z - s.z);
  for (const s of subjects) {
    const d = distance(s);
    if (d < best) { nearest = s; best = d; }
    if (s.id === previous) held = s;
  }
  return held && distance(held) < best + 1 ? held : nearest;
}
