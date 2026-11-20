import { starterWorld } from "../lib/world.ts";
import { flatTerrain, type Surface } from "../lib/terrain.ts";
import type { EFFECT_RULES } from "../lib/effect-limits.ts";
export type EffectKind = typeof EFFECT_RULES[number]["kind"];

export function effectFixture(kind: EffectKind) {
  const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size); world.timeOfDay = "noon";
  const set = (x: number, z: number, surface: Surface = "plain", height = 0, hole = false) => {
    world.terrain!.tiles[z * world.size + x] = { surface, height, hole };
  };
  let breakAt = [4, 4];
  switch (kind) {
    case "wind": case "dust": case "flicker":
      for (const x of [3, 4, 5]) for (const z of [3, 5]) set(x, z, "plain", 1);
      breakAt = [3, 3];
      if (kind === "dust") { set(4, 4, "rough"); breakAt = [4, 4]; }
      if (kind === "flicker") {
        for (const [x, z] of [[1, 4], [2, 3], [2, 4], [2, 5], [3, 4], [4, 4], [5, 4]]) set(x, z, "soft");
        breakAt = [2, 4];
      }
      break;
    case "fog":
      set(4, 4, "slick"); set(3, 4, "plain", 2); set(4, 3, "plain", 2); set(4, 5, "plain", 2); breakAt = [3, 4]; break;
    case "lift":
      set(4, 4, "plain", 0, true); set(4, 3, "plain", 1); set(4, 5, "plain", 1); breakAt = [4, 3]; break;
    case "bounce":
      set(4, 4, "soft"); set(3, 4, "plain", 1); set(5, 4, "plain", 2); set(4, 5, "plain", 1); breakAt = [3, 4]; break;
    case "glide":
      for (const x of [3, 4, 5]) { set(x, 4, "plain", 1); for (const z of [3, 5]) set(x, z, "plain", 2); }
      breakAt = [4, 4]; break;
    case "flow":
      set(3, 4, "slick", 2); set(4, 4, "slick", 1); set(5, 4, "slick"); breakAt = [4, 4]; break;

  }
  return { world, breakIndex: breakAt[1] * world.size + breakAt[0] };
}
