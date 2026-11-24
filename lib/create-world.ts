import { starterWorld } from "./world.ts";
import { flatTerrain, randomSequence, type Tile } from "./terrain.ts";

export function createTerrainWorld(seed = crypto.getRandomValues(new Uint32Array(1))[0]) {
  const world = starterWorld();
  world.objects = [];
  const terrain = flatTerrain(world.size);
  terrain.floating = true;
  terrain.tiles = terrain.tiles.map(() => ({ height: 0, surface: "plain", void: true }));
  const occupied: { x: number; z: number }[] = [];
  for (let z = world.start.z - 1; z <= world.start.z; z++) {
    for (let x = world.start.x - 1; x <= world.start.x; x++) {
      terrain.tiles[z * world.size + x] = { height: 0, surface: "plain" };
      occupied.push({ x, z });
    }
  }
  terrain.seed = seed;
  const random = randomSequence(seed);
  const patch = (cells: number[][], tile: Tile) => {
    const candidates: { x: number; z: number }[] = [];
    for (let z = 1; z < world.size - 2; z++) for (let x = 1; x < world.size - 2; x++) {
      if (cells.every(([dx, dz]) => occupied.every(p => Math.max(Math.abs(p.x - x - dx), Math.abs(p.z - z - dz)) > 1)))
        candidates.push({ x, z });
    }
    const position = candidates[Math.floor(random() * candidates.length)];
    if (!position) return;
    const { x, z } = position;
    for (const [dx, dz] of cells)
      terrain.tiles[(z + dz) * world.size + x + dx] = { ...tile };
    occupied.push(...cells.map(([dx, dz]) => ({ x: x + dx, z: z + dz })));
  };
  patch([[0, 0], [1, 0], [0, 1], [1, 1]], { height: 0, surface: "soft" });
  patch([[0, 0], [1, 0], [0, 1]], { height: 0, surface: "slick" });
  patch([[0, 0], [1, 0], [1, 1]], { height: 1, surface: "plain" });
  world.terrain = terrain;
  return world;
}
