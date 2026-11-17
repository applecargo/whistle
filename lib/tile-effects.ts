import type { World } from "./world.ts";
import type { Environment, EnvironmentRegion } from "./environment.ts";
import { LEVEL } from "./terrain.ts";
import { isHole } from "./tile.ts";

export const tileEffectDefaults = {
  clusterSize: 0, rain: 0, dust: 0, bounce: 0, flowX: 0, flowZ: 0,
  lift: 0, liftCeiling: 0, glide: 0, focus: 0, flicker: 0,
};

export function applyTileEffects(world: World, environment: Environment) {
  const tiles = world.terrain?.tiles;
  if (!tiles) return;
  const size = world.size, seen = new Set<number>();
  const adjacent = (i: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].flatMap(([dx, dz]) => {
    const x = i % size + dx, z = Math.floor(i / size) + dz;
    return x < 0 || z < 0 || x >= size || z >= size ? [] : [z * size + x];
  });
  const kind = (i: number) => isHole(tiles[i]) ? "hole" : tiles[i].surface;
  const cells = environment.cells;
  for (let i = 0; i < tiles.length; i++) {
    const type = kind(i);
    if (seen.has(i) || type === "plain") continue;
    const indices = [i]; seen.add(i);
    for (let n = 0; n < indices.length; n++) for (const next of adjacent(indices[n])) {
      if (!seen.has(next) && kind(next) === type) { seen.add(next); indices.push(next); }
    }
    const strength = indices.length === 1 ? .25 : indices.length === 2 ? .6 : 1;
    const region: EnvironmentRegion = { kind: type, cells: indices, strength };
    environment.regions.push(region);
    for (const index of indices) {
      const cell = cells[index], tile = tiles[index], neighbors = adjacent(index);
      cell.clusterSize = indices.length;
      if (type === "soft") {
        if (indices.length >= 3) {
          cell.windX += .24; cell.windZ += .1;
        }
        for (const other of neighbors) {
          if (kind(other) === "slick") cell.fog = Math.max(cell.fog, .3 + strength * .3);
          if (kind(other) === "soft" && tiles[other].height !== tile.height)
            cell.bounce = Math.min(1, Math.abs(tiles[other].height - tile.height) * .5);
        }
      } else if (type === "slick") {
        cell.rain = indices.length >= 3 ? Math.min(.75, .3 + indices.length * .025) : 0;
        for (const other of neighbors) {
          if (kind(other) === "soft") cell.fog = Math.max(cell.fog, .3 + strength * .3);
          if (kind(other) === "slick" && tile.height !== tiles[other].height) {
            const sign = Math.sign(tile.height - tiles[other].height);
            cell.flowX += (other % size - index % size) * sign * .45;
            cell.flowZ += (Math.floor(other / size) - Math.floor(index / size)) * sign * .45;
          }
        }
        const flow = Math.hypot(cell.flowX, cell.flowZ);
        if (flow > .65) { cell.flowX *= .65 / flow; cell.flowZ *= .65 / flow; }
      } else if (type === "rough") {
        cell.dust = indices.length >= 3 ? Math.min(.6, .2 + indices.length * .02) : 0;
        cell.glide = tile.height >= 1 ? 1 : 0;
      } else if (type === "hole") {
        const raised = neighbors.filter(other => kind(other) !== "hole" && tiles[other].height > 0);
        if (raised.length) {
          cell.lift = .65;
          cell.liftCeiling = Math.max(...raised.map(other => tiles[other].height)) * LEVEL + .45;
        }
        const rocks = neighbors.filter(other => kind(other) === "rough");
        if (rocks.length) {
          cell.focus = Math.min(1, .35 + Math.max(...rocks.map(other => tiles[other].height)) * .2);
          cell.flicker = [...neighbors, ...rocks.flatMap(adjacent)].some(other => kind(other) === "soft") ? 1 : 0;
        }
      }
    }
  }
}
