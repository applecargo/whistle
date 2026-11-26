import type { Tile, Surface } from "./terrain.ts";

export const MIN_HEIGHT = -1;
export const MAX_HEIGHT = 6;
export type TerrainTool = "surface" | "raise" | "lower" | "hole" | "erase";

export function groundTileHeight(tile?: Tile) {
  return tile?.surface === "slick" ? Math.min(0, tile.height) : tile?.height ?? 0;
}

export function isHole(tile?: { height: number; hole?: boolean }) {
  return !!tile && (tile.hole ?? tile.height === -1);
}

export function isVoid(tile?: { void?: boolean }) {
  return tile?.void === true;
}

export function isGap(tile?: Tile) {
  return isVoid(tile) || isHole(tile);
}

export function editTile(tile: Tile, tool: TerrainTool, surface: Surface): Tile {
  if (tool === "erase") return { height: 0, surface: "plain", void: true };
  if (isVoid(tile)) {
    if (tool !== "surface") return tile;
    return { height: 0, surface, hole: false };
  }
  const hole = isHole(tile);
  const height = hole && tile.hole === undefined ? 0 : tile.height;
  if (tool === "hole") return { ...tile, height, hole: !hole };
  if (tool === "surface") return { height, surface: !hole && tile.surface === surface ? "plain" : surface, hole: false };
  if (hole) return tile;
  return {
    ...tile,
    hole: false,
    height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height + (tool === "raise" ? 1 : -1))),
  };
}
