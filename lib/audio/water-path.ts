import type { Environment } from "../environment.ts";
import type { Position2D } from "../uwb-position.ts";

const edges = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const cornersAndEdges = [...edges, [-1, -1], [1, -1], [1, 1], [-1, 1]];

export function traceWaterPath({ size, cells, terrain }: Environment, source: Position2D | null) {
  const silent = { pathSteps: 0, loopArea: 0 };
  if (!source) return silent;
  function neighbors(index: number, offsets = edges) {
    const result: number[] = [];
    for (const [dx, dz] of offsets) {
      const x = index % size + dx, z = Math.floor(index / size) + dz;
      if (x >= 0 && x < size && z >= 0 && z < size) result.push(z * size + x);
    }
    return result;
  }

  const grass = new Set([source.z * size + source.x]);
  const water: number[] = [];
  const distance = new Int16Array(cells.length);
  for (const index of grass) {
    for (const n of neighbors(index)) {
      if (cells[n].grass > 0) grass.add(n);
      if (cells[n].water === null || distance[n]) continue;
      distance[n] = 1;
      water.push(n);
    }
  }
  if (!water.length) return silent;
  for (let cursor = 0; cursor < water.length; cursor++) {
    const index = water[cursor];
    for (const n of neighbors(index)) {
      if (cells[n].water === null || distance[n]) continue;
      distance[n] = distance[index] + 1;
      water.push(n);
    }
  }

  let closest = Infinity, loopArea = 0;
  const visited = new Uint8Array(cells.length);
  for (let seed = 0; seed < cells.length; seed++) {
    if (cells[seed].water !== null || visited[seed]) continue;
    const interior = [seed];
    visited[seed] = 1;
    let enclosed = true, steps = Infinity;
    for (const index of interior) {
      const around = neighbors(index, cornersAndEdges);
      if (around.length < 8 || cells[index].hole || terrain?.tiles[index].surface !== "plain") enclosed = false;
      for (const n of around) {
        if (cells[n].water !== null) {
          if (!distance[n]) enclosed = false;
        } else if (!visited[n]) {
          visited[n] = 1;
          interior.push(n);
        }
      }
      for (const n of neighbors(index)) if (distance[n]) steps = Math.min(steps, distance[n]);
    }
    if (enclosed && (steps < closest || (steps === closest && interior.length > loopArea))) {
      closest = steps;
      loopArea = interior.length;
    }
  }
  const pathSteps = loopArea ? closest : distance[water[water.length - 1]];
  return { pathSteps: !loopArea && pathSteps < 2 ? 0 : pathSteps, loopArea };
}
