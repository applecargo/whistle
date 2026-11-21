// 맵 → 사운드스케이프 소스. 순수 함수만 둔다(테스트 대상).
//
// 소리는 "층"별로 따로 묶는다. 한 칸이 여러 층에 동시에 속할 수 있다
// (예: 번짐 칸 위에 풀과 안개가 함께 있으면 surface·grass·fog 세 층의 영역에 모두 속함).
// 층 안에서는 같은 종류끼리 이어진 칸을 영역 하나로 묶고(위에서 내려다본 섬 하나), 영역마다 소스 하나.
// 떨어진 두 섬은 종류가 같아도 소스가 둘이다.
//
// 층 (입력은 world-derivation의 결과)
//   surface   지면 종류(빈 타일·거침·흐름·번짐). 구멍은 영역을 끊는다.   tiles
//   water     물이 찬 칸                                                environment.cells[i].water
//   grass     풀이 난 칸(농도 = grass)                                  environment.cells[i].grass
//   tree      나무가 선 칸(대각선도 이어서 숲 하나로)                    environment.cells[i].tree
//   fog       안개 낀 칸(농도 = fog)                                    environment.cells[i].fog
//   wind      바람길(농도 = 바람 세기)                                  environment.cells[i].windX/Z
//   structure 계단·다리·캐노피. 하나하나가 따로 소스                     derivation.structures
//
// 좌표 규칙(Scene.tsx와 같음)
// - 격자 좌표: 타일 (x, z)의 중심은 정수 좌표. 플레이어 위치도 격자 단위(실수).
// - 장면 좌표: toScene(n) = n × 2 − size + 1  (타일 한 칸 = 2m). 높이 = tile.height × LEVEL.
// - 바라보는 방향: yaw 0 = −Z, 이동 방향 (sin yaw, 0, −cos yaw).
import { LEVEL, type Structure, type Tile } from "../terrain.ts";
import type { Environment } from "../environment.ts";
import { isHole } from "../tile.ts";
import type { Vec3 } from "./soundscape.ts";

export const toScene = (n: number, size: number) => n * 2 - size + 1;
export const forwardOf = (yaw: number): Vec3 => ({ x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) });

export const LAYERS = ["surface", "water", "grass", "tree", "fog", "wind", "structure"] as const;
export type Layer = (typeof LAYERS)[number];

/** 종류별 패치. 지금은 빌드된 지형 패치가 terrain_clock 하나뿐이라 모두 같은 패치. */
export const KIND_PATCHES: Record<string, string> = {
  plain: "terrain_clock",
  rough: "terrain_clock",
  slick: "terrain_clock",
  soft: "terrain_clock",
  water: "terrain_clock",
  grass: "terrain_clock",
  tree: "terrain_clock",
  fog: "terrain_clock",
  wind: "terrain_clock",
  stairs: "terrain_clock",
  bridge: "terrain_clock",
  canopy: "terrain_clock",
};
const DEFAULT_PATCH = "terrain_clock";

/** 소리를 놓을 맵 정보. environment·structures가 없으면 surface 층만 만든다. */
export type SoundField = {
  size: number;
  tiles: readonly Tile[];
  environment?: Environment;
  structures?: readonly Structure[];
};

export type Region = { id: string; layer: Layer; kind: string; patch: string; tiles: number[] };
type LayerMap = {
  layer: Layer;
  /** 타일 인덱스 → list의 인덱스(이 층에 속하지 않으면 −1) */
  regionOf: Int32Array;
  /** 칸별 농도 0~1(속하지 않으면 0) */
  amount: Float64Array;
  /** 칸별 높이(장면 좌표 y) */
  height: Float64Array;
};
export type Regions = {
  field: SoundField;
  list: Region[];
  layers: LayerMap[];
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAGONALS = [...NEIGHBOURS, [-1, -1], [1, -1], [-1, 1], [1, 1]];

type Classified = { kinds: (string | null)[]; amount: Float64Array; height?: Float64Array; diagonal?: boolean; separate?: boolean };

/** 층마다 칸의 종류(같은 종류끼리 이어짐)와 농도를 정한다. */
function classify(layer: Layer, field: SoundField): Classified | null {
  const { size, tiles, environment: env, structures } = field;
  const count = size * size;
  const kinds: (string | null)[] = new Array(count).fill(null);
  const amount = new Float64Array(count);
  const mark = (i: number, kind: string, value: number) => {
    if (value <= 0) return;
    kinds[i] = kind;
    amount[i] = clamp01(value);
  };
  if (layer === "surface") {
    for (let i = 0; i < count; i++) if (!isHole(tiles[i])) mark(i, tiles[i].surface, 1);
    return { kinds, amount };
  }
  if (layer === "structure") {
    if (!structures?.length) return null;
    const height = new Float64Array(count);
    for (const s of structures) {
      const x = Math.round(s.x), z = Math.round(s.z);
      if (x < 0 || z < 0 || x >= size || z >= size) continue;
      const i = z * size + x;
      if (kinds[i] !== null) continue; // 한 칸에 구조물이 둘이면 먼저 나온 것만
      mark(i, s.kind, 1);
      height[i] = s.height * LEVEL;
    }
    return { kinds, amount, height, separate: true };
  }
  if (!env || env.size !== size) return null;
  for (let i = 0; i < count; i++) {
    const c = env.cells[i];
    if (!c) continue;
    if (layer === "water" && c.water !== null) mark(i, "water", 1);
    else if (layer === "grass") mark(i, "grass", c.grass);
    else if (layer === "tree" && c.tree) mark(i, "tree", 1);
    else if (layer === "fog") mark(i, "fog", c.fog);
    else if (layer === "wind") mark(i, "wind", Math.hypot(c.windX, c.windZ));
  }
  return { kinds, amount, diagonal: layer === "tree" };
}

/** 층마다 같은 종류끼리 이어진 칸을 묶는다(너비 우선 탐색). id는 `층-영역에서 가장 작은 타일 인덱스`. */
export function terrainRegions(field: SoundField): Regions {
  const { size, tiles } = field;
  const list: Region[] = [];
  const layers: LayerMap[] = [];
  const groundHeight = new Float64Array(size * size);
  for (let i = 0; i < groundHeight.length; i++) groundHeight[i] = isHole(tiles[i]) ? 0 : tiles[i].height * LEVEL;
  for (const layer of LAYERS) {
    const classified = classify(layer, field);
    if (!classified) continue;
    const { kinds, amount, diagonal, separate } = classified;
    const regionOf = new Int32Array(kinds.length).fill(-1);
    const steps = diagonal ? DIAGONALS : NEIGHBOURS;
    for (let start = 0; start < kinds.length; start++) {
      const kind = kinds[start];
      if (kind === null || regionOf[start] !== -1) continue;
      const index = list.length;
      const members: number[] = [];
      const queue = [start];
      regionOf[start] = index;
      while (queue.length) {
        const i = queue.pop()!;
        members.push(i);
        if (separate) continue;
        const x = i % size, z = Math.floor(i / size);
        for (const [dx, dz] of steps) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
          const n = nz * size + nx;
          if (regionOf[n] !== -1 || kinds[n] !== kind) continue;
          regionOf[n] = index;
          queue.push(n);
        }
      }
      members.sort((a, b) => a - b);
      list.push({ id: `${layer}-${start}`, layer, kind, patch: KIND_PATCHES[kind] ?? DEFAULT_PATCH, tiles: members });
    }
    layers.push({ layer, regionOf, amount, height: classified.height ?? groundHeight });
  }
  return { field, list, layers };
}

export type NearbyOptions = {
  /** 이 거리(타일) 안의 칸이 영역을 켠다 */
  radius: number;
  /** 동시에 켜 두는 최대 영역 수. 층을 가리지 않고 플레이어에게 가까운 순 */
  max: number;
  /** 이미 켜진 영역은 radius + hysteresis 안의 칸까지 세고, 거리 순위에서도 이만큼 가깝게 친다(경계 깜빡임 방지) */
  hysteresis: number;
};
export const DEFAULT_NEARBY: NearbyOptions = { radius: 3, max: 6, hysteresis: 0.5 };

/** 가까운 칸일수록 크게 친다. */
const tileWeight = (distance: number) => 1 / (1 + distance);
/** 이보다 가까운 칸(발밑)은 방향이 없다: 사방에서 들리는 쪽으로 센다. */
const UNDERFOOT = 0.5;

export type NearbyRegion = {
  id: string;
  patch: string;
  /** 반경 안에 들어온 그 영역 칸들의 가중 중심(장면 좌표) */
  position: Vec3;
  /** 반경 안(구멍 포함 모든 칸)의 가중치 합 대비 이 영역의 비중(농도 반영), 0~1 */
  gain: number;
  /** 0 = 한 방향의 점, 1 = 사방을 감쌈. 1 − (칸 방향 단위벡터 가중 평균의 길이) */
  spread: number;
  /** 플레이어에서 영역의 가장 가까운 칸까지 거리(타일) */
  distance: number;
};

/**
 * 플레이어(격자 좌표) 근처에서 켤 영역들. 모든 층의 후보를 모아 가까운 순으로 max개.
 * active: 지금 켜져 있는 영역 id.
 */
export function nearbyRegions(
  player: { x: number; z: number },
  regions: Regions,
  active: ReadonlySet<string>,
  options: NearbyOptions = DEFAULT_NEARBY,
): NearbyRegion[] {
  const { field: { size }, list, layers } = regions;
  const keep = options.radius + options.hysteresis;
  const reach = Math.ceil(keep);
  const cx = Math.round(player.x), cz = Math.round(player.z);
  let disk = 0;
  type Sum = { w: number; x: number; y: number; z: number; dx: number; dz: number; nearest: number };
  const sums = new Map<number, Sum>();
  for (let z = Math.max(0, cz - reach); z <= Math.min(size - 1, cz + reach); z++) {
    for (let x = Math.max(0, cx - reach); x <= Math.min(size - 1, cx + reach); x++) {
      const distance = Math.hypot(x - player.x, z - player.z);
      if (distance > keep) continue;
      const weight = tileWeight(distance);
      if (distance <= options.radius) disk += weight;
      const index = z * size + x;
      const ux = distance < UNDERFOOT ? 0 : (x - player.x) / distance;
      const uz = distance < UNDERFOOT ? 0 : (z - player.z) / distance;
      for (const map of layers) {
        const r = map.regionOf[index];
        if (r === -1) continue;
        if (distance > options.radius && !active.has(list[r].id)) continue;
        const w = weight * map.amount[index];
        const sum = sums.get(r) ?? { w: 0, x: 0, y: 0, z: 0, dx: 0, dz: 0, nearest: Infinity };
        sum.w += w;
        sum.x += w * toScene(x, size);
        sum.y += w * map.height[index];
        sum.z += w * toScene(z, size);
        sum.dx += w * ux;
        sum.dz += w * uz;
        sum.nearest = Math.min(sum.nearest, distance);
        sums.set(r, sum);
      }
    }
  }
  const found = [...sums].filter(([, sum]) => sum.w > 0).map(([r, sum]) => {
    const region = list[r];
    const gain = disk > 0 ? Math.min(1, sum.w / disk) : 0;
    return {
      rank: active.has(region.id) ? sum.nearest - options.hysteresis : sum.nearest,
      region: {
        id: region.id, patch: region.patch, gain,
        position: { x: sum.x / sum.w, y: sum.y / sum.w, z: sum.z / sum.w },
        spread: clamp01(1 - Math.hypot(sum.dx, sum.dz) / sum.w),
        distance: sum.nearest,
      },
    };
  });
  // 가까운 순. 같으면 비중이 큰 순, 그것도 같으면 id 순으로 고정한다.
  found.sort((a, b) => a.rank - b.rank || b.region.gain - a.region.gain || (a.region.id < b.region.id ? -1 : 1));
  return found.slice(0, options.max).map((f) => f.region);
}

/** 지금 켜진 것과 다음에 켤 것을 비교해 켤 것·끌 것을 나눈다. */
export function diffActive(current: ReadonlySet<string>, next: ReadonlySet<string>) {
  return {
    on: [...next].filter((id) => !current.has(id)),
    off: [...current].filter((id) => !next.has(id)),
  };
}
