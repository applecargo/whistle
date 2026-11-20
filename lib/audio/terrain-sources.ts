// 지형 타일 → 사운드스케이프 소스. 순수 함수만 둔다(테스트 대상).
//
// 좌표 규칙(Scene.tsx와 같음)
// - 격자 좌표: 타일 (x, z)의 중심은 정수 좌표. 플레이어 위치도 격자 단위(실수).
// - 장면 좌표: toScene(n) = n × 2 − size + 1  (타일 한 칸 = 2m). 높이 = tile.height × LEVEL.
// - 바라보는 방향: yaw 0 = −Z, 이동 방향 (sin yaw, 0, −cos yaw).
import { LEVEL, type Surface, type Tile } from "../terrain.ts";
import { isHole } from "../tile.ts";
import type { SoundscapeSource, Vec3 } from "./soundscape.ts";

export const toScene = (n: number, size: number) => n * 2 - size + 1;
export const forwardOf = (yaw: number): Vec3 => ({ x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) });

/** 지면 종류별 패치. 지금은 빌드된 지형 패치가 terrain_clock 하나뿐이라 모두 같은 패치. */
export const SURFACE_PATCHES: Record<Surface, string> = {
  plain: "terrain_clock",
  rough: "terrain_clock",
  slick: "terrain_clock",
  soft: "terrain_clock",
};

export const tileSourceId = (index: number) => `tile-${index}`;

/** 타일마다 소스 하나. 구멍(hole) 타일은 소리를 내지 않는다. */
export function terrainSources(tiles: readonly Tile[], size: number): SoundscapeSource[] {
  const sources: SoundscapeSource[] = [];
  tiles.forEach((tile, index) => {
    if (isHole(tile)) return;
    const x = index % size, z = Math.floor(index / size);
    sources.push({
      id: tileSourceId(index),
      patch: SURFACE_PATCHES[tile.surface] ?? SURFACE_PATCHES.plain,
      position: { x: toScene(x, size), y: tile.height * LEVEL, z: toScene(z, size) },
    });
  });
  return sources;
}

export type NearbyOptions = {
  /** 이 거리(타일) 안의 타일을 켠다 */
  radius: number;
  /** 동시에 켜 두는 최대 개수(가까운 순) */
  max: number;
  /** 이미 켜진 타일은 radius + hysteresis까지 유지하고, 순위에서도 이만큼 가깝게 친다.
   *  (반경 경계와 최대 개수 경계 양쪽에서 깜빡임 방지) */
  hysteresis: number;
};
export const DEFAULT_NEARBY: NearbyOptions = { radius: 3, max: 10, hysteresis: 0.5 };

/**
 * 플레이어(격자 좌표) 근처에서 켤 소스 id 집합.
 * candidates: 소스가 있는 타일 인덱스. active: 지금 켜져 있는 id.
 */
export function nearbyTiles(
  player: { x: number; z: number },
  size: number,
  candidates: ReadonlySet<number>,
  active: ReadonlySet<string>,
  options: NearbyOptions = DEFAULT_NEARBY,
) {
  const keep = options.radius + options.hysteresis;
  const reach = Math.ceil(keep);
  const cx = Math.round(player.x), cz = Math.round(player.z);
  const found: { id: string; rank: number }[] = [];
  for (let z = Math.max(0, cz - reach); z <= Math.min(size - 1, cz + reach); z++) {
    for (let x = Math.max(0, cx - reach); x <= Math.min(size - 1, cx + reach); x++) {
      const index = z * size + x;
      if (!candidates.has(index)) continue;
      const id = tileSourceId(index);
      const distance = Math.hypot(x - player.x, z - player.z);
      const on = active.has(id);
      if (distance <= options.radius || (on && distance <= keep)) {
        found.push({ id, rank: on ? distance - options.hysteresis : distance });
      }
    }
  }
  // 순위가 같으면 id 순으로 고정한다.
  found.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
  return new Set(found.slice(0, options.max).map((f) => f.id));
}

/** 지금 켜진 것과 다음에 켤 것을 비교해 켤 것·끌 것을 나눈다. */
export function diffActive(current: ReadonlySet<string>, next: ReadonlySet<string>) {
  return {
    on: [...next].filter((id) => !current.has(id)),
    off: [...current].filter((id) => !next.has(id)),
  };
}
