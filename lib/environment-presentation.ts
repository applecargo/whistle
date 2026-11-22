import type { Asset, Placed, World } from "./world.ts";
import { environmentAt, type Environment } from "./environment.ts";
import { tileAt } from "./terrain.ts";
import { isGap } from "./tile.ts";

export function environmentPresentation(world: World, placed: Pick<Placed, "x" | "z">, environment: Environment): Pick<Asset, "display"> {
  const tile = tileAt(world, placed.x, placed.z);
  const cell = environmentAt(environment, placed.x, placed.z);
  const textured = tile?.surface === "soft" || tile?.surface === "rough";
  const raised = (tile?.height ?? 0) >= 2;
  const boundary = !!tile && !isGap(tile) && tile.surface !== "plain" &&
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const neighbor = tileAt(world, placed.x + dx, placed.z + dz);
      return neighbor && !isGap(neighbor) && neighbor.surface !== "plain" && neighbor.surface !== tile.surface;
    });
  const display = cell.flicker > .1 || boundary ? "pulse"
    : cell.fog > .15 || isGap(tile) || (!textured && raised) ? "nearby" : "steady";
  return { display };
}
