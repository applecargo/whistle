import type { World } from "../world.ts";
import type { Terrain, Surface } from "../terrain.ts";
import { SoundscapeManager } from "./soundscape-manager.ts";

/**
 * 지형 표면(Surface)에 따라 적절한 컴파일된 WASM 패치 이름을 결정합니다.
 */
export function getPatchForSurface(surface: Surface): string {
  switch (surface) {
    case "plain":
      return "bell01";
    case "rough":
      return "stone_knock";
    case "slick":
      return "noise_mod";
    case "soft":
      return "simplesine";
    default:
      return "simplesine";
  }
}

/**
 * 월드 지형(Terrain)의 각 타일을 순회하며 표면 타입에 맞는
 * 고유 WASM 패치를 결정하고, SoundscapeManager에 3D 위치 및 거리 컬링 정책과 함께 등록합니다.
 */
export async function registerWorldTerrainSoundscapes(
  manager: SoundscapeManager,
  world: World,
  terrain: Terrain,
  cullingRadius = 16.0
) {
  const size = world.size;
  const toScene = (n: number) => n * 2 - size + 1;

  for (let i = 0; i < terrain.tiles.length; i++) {
    const tile = terrain.tiles[i];
    const xIndex = i % size;
    const zIndex = Math.floor(i / size);

    const worldX = toScene(xIndex);
    const worldZ = toScene(zIndex);
    const groundY = tile.height;

    const patchName = getPatchForSurface(tile.surface);
    const patchId = `tile-${xIndex}-${zIndex}-${patchName}`;

    await manager.registerPatch({
      id: patchId,
      patchName,
      position: { x: worldX, y: groundY, z: worldZ },
      policy: { type: "distance", radius: cullingRadius },
      initialGain: 0.6,
    });
  }
}
