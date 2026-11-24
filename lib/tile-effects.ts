import type { World } from "./world.ts";
import type { Environment, EnvironmentRegion } from "./environment.ts";
import { LEVEL } from "./terrain.ts";
import { isHole, isVoid } from "./tile.ts";
import { limitEffectAreas } from "./effect-limits.ts";

export const tileEffectDefaults = {
  clusterSize: 0, dust: 0, flowX: 0, flowZ: 0,
  lift: 0, liftCeiling: 0, flicker: 0,
};
const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

export function applyTileEffects(world: World, environment: Environment) {
  const tiles = world.terrain?.tiles;
  if (!tiles) return;
  const size = world.size, seen = new Set<number>(), cells = environment.cells;
  const at = (i: number, dx: number, dz: number) => {
    const x = i % size + dx, z = Math.floor(i / size) + dz;
    return x < 0 || z < 0 || x >= size || z >= size ? -1 : z * size + x;
  };
  const adjacent = (i: number) => directions.map(([dx, dz]) => at(i, dx, dz)).filter(n => n >= 0);
  const kind = (i: number) => i < 0 || isVoid(tiles[i]) ? null : isHole(tiles[i]) ? "hole" : tiles[i].surface;
  const solid = (i: number) => i >= 0 && kind(i) !== null && kind(i) !== "hole";
  for (let i = 0; i < tiles.length; i++) {
    const type = kind(i);
    if (seen.has(i) || type === "plain" || type === null) continue;
    const indices = [i]; seen.add(i);
    for (let n = 0; n < indices.length; n++) for (const next of adjacent(indices[n])) {
      if (!seen.has(next) && kind(next) === type) { seen.add(next); indices.push(next); }
    }
    const strength = indices.length === 1 ? .25 : indices.length === 2 ? .6 : 1;
    const region: EnvironmentRegion = { kind: type, cells: indices, strength };
    environment.regions.push(region);
    for (const index of indices) cells[index].clusterSize = indices.length;
  }

  for (let i = 0; i < tiles.length; i++) {
    const cell = cells[i], tile = tiles[i], type = kind(i);
    const breeze = Math.hypot(cell.windX, cell.windZ);
    if (type === "rough" && breeze > .1 && cell.moisture < .8)
      cell.dust = Math.min(.6, breeze * .6);
    if (cell.tree && breeze > .1) cell.flicker = Math.min(1, breeze);
    if (type === "slick") {
      for (const [dx, dz] of directions) {
        const up = at(i, -dx, -dz), down = at(i, dx, dz);
        if (kind(up) !== "slick" || kind(down) !== "slick" || tiles[up].height <= tile.height || tiles[down].height >= tile.height) continue;
        const force = Math.min(.65, .25 + (tiles[up].height - tiles[down].height) * .1);
        for (const n of [up, i, down]) { cells[n].flowX += dx * force; cells[n].flowZ += dz * force; }
      }
    } else if (type === "hole") {
      for (const [dx, dz] of directions.slice(0, 2)) {
        const a = at(i, dx, dz), b = at(i, -dx, -dz);
        if (solid(a) && solid(b) && tiles[a].height >= 1 && tiles[b].height >= 1) {
          cell.lift = .65;
          cell.liftCeiling = Math.max(cell.liftCeiling, Math.min(tiles[a].height, tiles[b].height) * LEVEL + .45);
        }
      }

    }
  }
  for (const cell of cells) {
    const flow = Math.hypot(cell.flowX, cell.flowZ);
    if (flow > .65) { cell.flowX *= .65 / flow; cell.flowZ *= .65 / flow; }
  }
  limitEffectAreas(size, cells);
}
