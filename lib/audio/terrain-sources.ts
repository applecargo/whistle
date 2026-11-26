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
import { LINEAR, ruleGain, ruleWidth, type SpatialRule } from "./spatial-rule.ts";
import { LEVEL, type Structure, type Tile } from "../terrain.ts";
import type { Environment } from "../environment.ts";
import { isGap } from "../tile.ts";
import type { Vec3 } from "./soundscape.ts";

export const toScene = (n: number, size: number) => n * 2 - size + 1;
export const forwardOf = (yaw: number): Vec3 => ({ x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) });

export const LAYERS = ["surface", "water", "grass", "tree", "fog", "wind", "structure"] as const;
export type Layer = (typeof LAYERS)[number];

/** 종류별 패치(audio/patches/<이름>.pd) */
export const KIND_PATCHES: Record<string, string> = {
  plain: "terrain_plain",
  rough: "terrain_rough",
  slick: "terrain_slick",
  soft: "terrain_soft",
  water: "environment_water",
  grass: "environment_grass",
  tree: "environment_tree",
  fog: "environment_fog",
  wind: "environment_wind",
  stairs: "structure_ladder", // 게임 코드의 이름은 stairs, 화면에서는 사다리
  bridge: "structure_bridge",
  canopy: "structure_canopy",
};
const DEFAULT_PATCH = "terrain_plain";

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
  /** 칸별 농도 0~1(속하지 않으면 0). 음량·위치에는 쓰지 않고 패치로 보낸다 */
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
    for (let i = 0; i < count; i++) if (!isGap(tiles[i])) mark(i, tiles[i].surface, 1);
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
  for (let i = 0; i < groundHeight.length; i++) groundHeight[i] = isGap(tiles[i]) ? 0 : tiles[i].height * LEVEL;
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
  /** 영역 외곽까지 이 거리(타일) 안이면 켠다. 여기서 음량 0, 외곽에 닿으면 1 */
  radius: number;
  /** 동시에 켜 두는 최대 영역 수. 층을 가리지 않고 플레이어에게 가까운 순 */
  max: number;
  /** 이미 켜진 영역은 radius + hysteresis까지 유지하고, 거리 순위에서도 이만큼 가깝게 친다(경계 깜빡임 방지) */
  hysteresis: number;
  /** 외곽까지 이 거리(타일)부터 패닝이 줄어들어 외곽에서 좌우 1이 된다 */
  blend: number;
};
export const DEFAULT_NEARBY: NearbyOptions = { radius: 2, max: 6, hysteresis: 0.5, blend: 2 };

export type NearbyRegion = {
  id: string;
  patch: string;
  /** 플레이어에서 가장 가까운 영역 외곽의 점(장면 좌표). 영역 안이면 플레이어 위치 */
  position: Vec3;
  /** 외곽까지 거리로 정한 음량: radius에서 0, 외곽·안에서 1 */
  gain: number;
  /** 0 = 패닝(방향), 1 = 좌우 1(방향 없음). 외곽까지 blend 타일부터 커져 외곽에서 1 */
  width: number;
  /** 플레이어에서 영역 외곽까지 유클리드 거리(타일). 안이면 0 */
  distance: number;
  /** 가장 가까운 칸의 농도(풀·안개·바람 세기 등, 나머지 층은 1). 음량에는 쓰지 않고 패치로 보낸다 */
  amount: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 플레이어(격자 좌표) 근처에서 켤 영역들. 모든 층의 후보를 모아 가까운 순으로 max개.
 * 칸은 중심 (x, z), 한 변 1인 정사각형으로 보고 외곽까지 유클리드 거리를 잰다.
 * active: 지금 켜져 있는 영역 id.
 */
export function nearbyRegions(
  player: { x: number; z: number },
  regions: Regions,
  active: ReadonlySet<string>,
  options: NearbyOptions = DEFAULT_NEARBY,
  rules?: ReadonlyMap<string, Partial<SpatialRule>>,
): NearbyRegion[] {
  const { field: { size }, list, layers } = regions;
  // 공간화 규칙(spatial-rule.ts): 기본은 radius에서 0 → 외곽 1(선형), width는 blend부터. 패치가 바꾼 값(rules, 패치 이름별)이 있으면 그것.
  const ruleOf = (patch: string): SpatialRule => ({ range: options.radius, width: 0, curve: LINEAR, ...rules?.get(patch) });
  const blendOf = (patch: string) => rules?.get(patch)?.range === undefined ? options.blend : undefined;
  let reachRange = options.radius;
  for (const rule of rules?.values() ?? []) if (rule.range !== undefined) reachRange = Math.max(reachRange, rule.range);
  const keep = reachRange + options.hysteresis;
  const reach = Math.ceil(keep + 1);
  const cx = Math.round(player.x), cz = Math.round(player.z);
  type Nearest = { distance: number; x: number; z: number; index: number; map: LayerMap };
  const nearest = new Map<number, Nearest>();
  for (let z = Math.max(0, cz - reach); z <= Math.min(size - 1, cz + reach); z++) {
    for (let x = Math.max(0, cx - reach); x <= Math.min(size - 1, cx + reach); x++) {
      // 이 칸(정사각형)에서 플레이어에게 가장 가까운 점
      const px = clamp(player.x, x - 0.5, x + 0.5), pz = clamp(player.z, z - 0.5, z + 0.5);
      const distance = Math.hypot(px - player.x, pz - player.z);
      if (distance > keep) continue;
      const index = z * size + x;
      for (const map of layers) {
        const r = map.regionOf[index];
        if (r === -1) continue;
        const best = nearest.get(r);
        if (!best || distance < best.distance) nearest.set(r, { distance, x: px, z: pz, index, map });
      }
    }
  }
  const found = [...nearest]
    .filter(([r, n]) => {
      const range = ruleOf(list[r].patch).range;
      return n.distance <= range || (active.has(list[r].id) && n.distance <= range + options.hysteresis);
    })
    .map(([r, n]) => {
      const region = list[r], rule = ruleOf(region.patch);
      return {
        rank: active.has(region.id) ? n.distance - options.hysteresis : n.distance,
        region: {
          id: region.id, patch: region.patch,
          position: { x: toScene(n.x, size), y: n.map.height[n.index], z: toScene(n.z, size) },
          gain: ruleGain(rule, n.distance),
          width: ruleWidth(rule, n.distance, blendOf(region.patch)),
          distance: n.distance,
          amount: n.map.amount[n.index],
        },
      };
    });
  // 가까운 순. 같으면 id 순으로 고정한다.
  found.sort((a, b) => a.rank - b.rank || (a.region.id < b.region.id ? -1 : 1));
  return found.slice(0, options.max).map((f) => f.region);
}

/** 지금 켜진 것과 다음에 켤 것을 비교해 켤 것·끌 것을 나눈다. */
export function diffActive(current: ReadonlySet<string>, next: ReadonlySet<string>) {
  return {
    on: [...next].filter((id) => !current.has(id)),
    off: [...current].filter((id) => !next.has(id)),
  };
}
