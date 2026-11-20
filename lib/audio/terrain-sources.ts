// 지형 → 사운드스케이프 소스. 순수 함수만 둔다(테스트 대상).
//
// 단위는 "영역": 같은 지면 종류끼리 상하좌우로 이어진 타일 묶음(위에서 내려다본 섬 하나).
// 영역마다 소스 하나. 떨어진 두 섬은 종류가 같아도 소스가 둘이다. 구멍 타일은 영역을 끊는다.
//
// 좌표 규칙(Scene.tsx와 같음)
// - 격자 좌표: 타일 (x, z)의 중심은 정수 좌표. 플레이어 위치도 격자 단위(실수).
// - 장면 좌표: toScene(n) = n × 2 − size + 1  (타일 한 칸 = 2m). 높이 = tile.height × LEVEL.
// - 바라보는 방향: yaw 0 = −Z, 이동 방향 (sin yaw, 0, −cos yaw).
import { LEVEL, type Surface, type Tile } from "../terrain.ts";
import { isHole } from "../tile.ts";
import type { Vec3 } from "./soundscape.ts";

export const toScene = (n: number, size: number) => n * 2 - size + 1;
export const forwardOf = (yaw: number): Vec3 => ({ x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) });

/** 지면 종류별 패치. 지금은 빌드된 지형 패치가 terrain_clock 하나뿐이라 모두 같은 패치. */
export const SURFACE_PATCHES: Record<Surface, string> = {
  plain: "terrain_clock",
  rough: "terrain_clock",
  slick: "terrain_clock",
  soft: "terrain_clock",
};

export type Region = { id: string; surface: Surface; patch: string; tiles: number[] };
export type Regions = {
  size: number;
  tiles: readonly Tile[];
  list: Region[];
  /** 타일 인덱스 → list의 인덱스(구멍은 −1) */
  regionOf: Int32Array;
};

/** 같은 종류끼리 상하좌우로 이어진 타일을 묶는다(너비 우선 탐색). id는 영역에서 가장 작은 타일 인덱스. */
export function terrainRegions(tiles: readonly Tile[], size: number): Regions {
  const regionOf = new Int32Array(tiles.length).fill(-1);
  const list: Region[] = [];
  for (let start = 0; start < tiles.length; start++) {
    if (regionOf[start] !== -1 || isHole(tiles[start])) continue;
    const surface = tiles[start].surface;
    const index = list.length;
    const members: number[] = [];
    const queue = [start];
    regionOf[start] = index;
    while (queue.length) {
      const i = queue.pop()!;
      members.push(i);
      const x = i % size, z = Math.floor(i / size);
      for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        const n = nz * size + nx;
        if (regionOf[n] !== -1 || isHole(tiles[n]) || tiles[n].surface !== surface) continue;
        regionOf[n] = index;
        queue.push(n);
      }
    }
    members.sort((a, b) => a - b);
    list.push({ id: `region-${start}`, surface, patch: SURFACE_PATCHES[surface] ?? SURFACE_PATCHES.plain, tiles: members });
  }
  return { size, tiles, list, regionOf };
}

export type NearbyOptions = {
  /** 이 거리(타일) 안의 타일이 영역을 켠다 */
  radius: number;
  /** 동시에 켜 두는 최대 영역 수(비중이 큰 순) */
  max: number;
  /** 이미 켜진 영역은 radius + hysteresis 안의 타일까지 세고, 순위에서도 우대한다(경계 깜빡임 방지) */
  hysteresis: number;
};
export const DEFAULT_NEARBY: NearbyOptions = { radius: 3, max: 6, hysteresis: 0.5 };

/** 가까운 타일일수록 크게 친다. */
const tileWeight = (distance: number) => 1 / (1 + distance);

export type NearbyRegion = {
  id: string;
  patch: string;
  /** 반경 안에 들어온 그 영역 타일들의 가중 중심(장면 좌표) */
  position: Vec3;
  /** 반경 안(구멍 포함 모든 칸)의 가중치 합 대비 이 영역의 비중, 0~1 */
  gain: number;
};

/**
 * 플레이어(격자 좌표) 근처에서 켤 영역들.
 * active: 지금 켜져 있는 영역 id.
 */
export function nearbyRegions(
  player: { x: number; z: number },
  regions: Regions,
  active: ReadonlySet<string>,
  options: NearbyOptions = DEFAULT_NEARBY,
): NearbyRegion[] {
  const { size, tiles, list, regionOf } = regions;
  const keep = options.radius + options.hysteresis;
  const reach = Math.ceil(keep);
  const cx = Math.round(player.x), cz = Math.round(player.z);
  let disk = 0;
  const sums = new Map<number, { w: number; x: number; y: number; z: number }>();
  for (let z = Math.max(0, cz - reach); z <= Math.min(size - 1, cz + reach); z++) {
    for (let x = Math.max(0, cx - reach); x <= Math.min(size - 1, cx + reach); x++) {
      const distance = Math.hypot(x - player.x, z - player.z);
      if (distance > keep) continue;
      const w = tileWeight(distance);
      if (distance <= options.radius) disk += w;
      const index = z * size + x;
      const r = regionOf[index];
      if (r === -1) continue;
      if (distance > options.radius && !active.has(list[r].id)) continue;
      const sum = sums.get(r) ?? { w: 0, x: 0, y: 0, z: 0 };
      sum.w += w;
      sum.x += w * toScene(x, size);
      sum.y += w * tiles[index].height * LEVEL;
      sum.z += w * toScene(z, size);
      sums.set(r, sum);
    }
  }
  const found = [...sums].map(([r, sum]) => {
    const region = list[r];
    const gain = disk > 0 ? Math.min(1, sum.w / disk) : 0;
    return {
      rank: active.has(region.id) ? gain * 1.25 : gain,
      region: {
        id: region.id, patch: region.patch, gain,
        position: { x: sum.x / sum.w, y: sum.y / sum.w, z: sum.z / sum.w },
      },
    };
  });
  // 순위가 같으면 id 순으로 고정한다.
  found.sort((a, b) => b.rank - a.rank || (a.region.id < b.region.id ? -1 : 1));
  return found.slice(0, options.max).map((f) => f.region);
}

/** 지금 켜진 것과 다음에 켤 것을 비교해 켤 것·끌 것을 나눈다. */
export function diffActive(current: ReadonlySet<string>, next: ReadonlySet<string>) {
  return {
    on: [...next].filter((id) => !current.has(id)),
    off: [...current].filter((id) => !next.has(id)),
  };
}
