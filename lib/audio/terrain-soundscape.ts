import type { World } from "../world.ts";
import type { Terrain, Surface } from "../terrain.ts";
import { SoundscapeManager } from "./soundscape-manager.ts";

/**
 * 지형 표면(Surface) 및 환경 조건에 따라 적절한 컴파일된 WASM 패치 이름을 결정합니다.
 * 예: 풀밭(grass) -> bell01.wasm, 물(water) -> noise_mod.wasm, 암석(stone/rough) -> stone_knock.wasm
 */
export function getPatchForSurface(surface: Surface, waterLevel: number, groundHeight: number): string {
  if (waterLevel > groundHeight) {
    return "noise_mod"; // 물 위/수면 타일: 물결/노이즈 패치
  }
  switch (surface) {
    case "grass":
      return "bell01"; // 풀밭 타일: 벨/풀 사운드 패치
    case "rough":
    case "plain":
      return "stone_knock"; // 돌/일반 지면 타일: 스톤 콕 패치
    default:
      return "simplesine";
  }
}

/**
 * 월드 지형(Terrain)의 각 타일을 순회하며 표면 타입(Grass, Water, Stone 등)에 맞는
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
    const waterY = tile.water ?? -1;

    // 표면 타입 및 환경 조건에 따른 WASM 패치 선택
    const patchName = getPatchForSurface(tile.surface, waterY, groundY);
    const patchId = `tile-${xIndex}-${zIndex}-${patchName}`;

    // SoundscapeManager에 등록 (거리 컬링 16m 기본 적용)
    await manager.registerPatch({
      id: patchId,
      patchName,
      position: { x: worldX, y: Math.max(groundY, waterY), z: worldZ },
      policy: { type: "distance", radius: cullingRadius },
      initialGain: 0.6,
    });
  }
}
