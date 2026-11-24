import assert from "node:assert/strict";
import { test } from "node:test";
import { toScene, forwardOf, terrainRegions, nearbyRegions, diffActive, DEFAULT_NEARBY, KIND_PATCHES, type SoundField } from "../lib/audio/terrain-sources.ts";
import { LEVEL, flatTerrain, deriveStructures, type Structure, type Surface, type Tile } from "../lib/terrain.ts";
import { deriveEnvironment, type Environment, type EnvironmentCell } from "../lib/environment.ts";
import { starterWorld } from "../lib/world.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
// 튜닝값(반경·패닝 전환·히스테리시스·패치 이름)은 코드에서 읽는다. 값을 바꿔도 공식과 동작만 검사한다.
const { radius: R, blend: B, hysteresis: H } = DEFAULT_NEARBY;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 외곽까지 거리 d에서 기대하는 음량·width */
const expectedGain = (d: number) => clamp01(1 - d / R);
/** 개수 상한과 무관한 동작을 볼 때: 상한만 넉넉하게 */
const UNCAPPED = { ...DEFAULT_NEARBY, max: 99 };
const expectedWidth = (d: number) => (B > 0 ? clamp01(1 - d / B) : d > 0 ? 0 : 1);

/** 문자 지도로 지형을 만든다. p=plain r=rough s=slick o=soft .=구멍 */
function map(rows: string[]): SoundField & { tiles: Tile[] } {
  const kinds: Record<string, Surface> = { p: "plain", r: "rough", s: "slick", o: "soft" };
  const size = rows.length;
  const tiles = rows.join("").split("").map((c): Tile =>
    c === "." ? { height: 0, surface: "plain", hole: true } : { height: 0, surface: kinds[c] });
  return { tiles, size };
}
/** 환경 칸 값만 정해 둔 가짜 environment(나머지 층 판정에 쓰는 값만) */
function fakeEnvironment(size: number, at: (x: number, z: number) => Partial<EnvironmentCell>): Environment {
  const cells = Array.from({ length: size * size }, (_, i) => ({
    grass: 0, water: null, tree: false, fog: 0, windX: 0, windZ: 0,
    ...at(i % size, Math.floor(i / size)),
  })) as EnvironmentCell[];
  return { size, cells, regions: [], trees: [], ponds: [] };
}
const surfaceOnly = (list: ReturnType<typeof terrainRegions>["list"]) => list.filter((r) => r.layer === "surface");

test("격자 → 장면 좌표: 타일 한 칸 2m, 가운데가 원점", () => {
  assert.equal(toScene(0, 24), -23);
  assert.equal(toScene(23, 24), 23);
  assert.equal(toScene(11.5, 24), 0);
  assert.equal(toScene(1, 24) - toScene(0, 24), 2);
});

test("yaw → 바라보는 방향: Scene.tsx의 이동 방향과 같다", () => {
  const north = forwardOf(0);
  close(north.x, 0); close(north.z, -1);
  const right = forwardOf(Math.PI / 2);
  close(right.x, 1); close(right.z, 0);
});

test("영역: 같은 종류끼리 상하좌우로 이어진 것만 한 영역", () => {
  const { tiles, size } = map([
    "rrpp",
    "rppr",
    "pppr",
    "rprr",
  ]);
  const { list } = terrainRegions({ tiles, size });
  const summary = list.map((r) => `${r.kind}:${r.tiles.join(",")}`);
  assert.deepEqual(summary, [
    "rough:0,1,4",
    "plain:2,3,5,6,8,9,10,13",
    "rough:7,11,14,15",
    "rough:12",
  ]);
  assert.equal(list[0].id, "surface-0");
  assert.equal(list[0].layer, "surface");
  assert.equal(list[0].patch, KIND_PATCHES.rough);
});

test("multiplayer void tiles do not create terrain sound regions", () => {
  const tiles = flatTerrain(3).tiles.map(tile => ({ ...tile, void: true }));
  tiles[4].void = false;
  const { list, layers } = terrainRegions({ size: 3, tiles });
  assert.deepEqual(surfaceOnly(list).map(region => region.tiles), [[4]]);
  assert.equal(layers[0].regionOf[0], -1);
});

test("영역: 대각선으로만 닿으면 다른 영역, 구멍은 영역을 끊고 영역에 들지 않는다", () => {
  const diagonal = terrainRegions(map(["rp", "pr"])).list;
  assert.equal(diagonal.filter((r) => r.kind === "rough").length, 2);
  const { list, layers } = terrainRegions(map(["p.p", "p.p", "p.p"]));
  assert.equal(list.length, 2);
  assert.equal(layers[0].regionOf[1], -1);
  // 예전 형식의 구멍(height −1)
  const legacy = flatTerrain(3).tiles.map((t, i) => (i === 4 ? { ...t, height: -1 } : t));
  assert.ok(terrainRegions({ tiles: legacy, size: 3 }).list.every((r) => !r.tiles.includes(4)));
});

test("근처 영역: 같은 종류라도 떨어진 두 섬은 각각 켜진다", () => {
  const { tiles, size } = map([
    "ppppppp",
    "rrppprr",
    "rrppprr",
    "rrppprr",
    "ppppppp",
    "ppppppp",
    "ppppppp",
  ]);
  const regions = terrainRegions({ tiles, size });
  // 묶기 동작만 본다: 섬이 1.5타일 떨어져 있으므로 반경을 고정
  const near = nearbyRegions({ x: 3, z: 2 }, regions, new Set(), { ...UNCAPPED, radius: 2 });
  const rough = near.filter((r) => regions.list.find((l) => l.id === r.id)!.kind === "rough");
  assert.equal(rough.length, 2);
  // 왼쪽 섬은 플레이어 왼쪽(−x), 오른쪽 섬은 오른쪽(+x)
  const [left, right] = [...rough].sort((a, b) => a.position.x - b.position.x);
  assert.ok(left.position.x < toScene(3, size) && right.position.x > toScene(3, size));
  close(left.gain, right.gain, 1e-9);
});

test("근처 영역: 음원은 영역 외곽에서 가장 가까운 점, 음량·width는 외곽까지 거리로", () => {
  // 오른쪽 세 줄이 거침. 왼쪽은 반경보다 넓게 비워 둔다. 외곽선은 x = edge
  const size = Math.ceil(R + H) + 6;
  const field = map(Array(size).fill("p".repeat(size - 3) + "rrr"));
  const regions = terrainRegions(field);
  const id = `surface-${size - 3}`;
  const edge = size - 3 - 0.5, mid = Math.floor(size / 2);
  const rough = (x: number, z = mid) => nearbyRegions({ x, z }, regions, new Set()).find((r) => r.id === id);
  assert.equal(rough(edge - R - 0.25), undefined, "반경 밖");
  for (const d of [R, R * 0.75, R / 2, B / 2, 0.25]) {
    if (d > R) continue;
    const near = rough(edge - d)!;
    close(near.distance, d);
    close(near.gain, expectedGain(d));
    close(near.width, expectedWidth(d));
    close(near.position.x, toScene(edge, size)); // 음원은 외곽 위의 점
    close(near.position.z, toScene(mid, size));
  }
  const onEdge = rough(edge)!;
  close(onEdge.gain, 1); close(onEdge.width, 1);
  const inside = rough(size - 1.8, mid - 0.7)!; // 안: 음원은 플레이어 위치, 좌우 1
  close(inside.distance, 0); close(inside.gain, 1); close(inside.width, 1);
  close(inside.position.x, toScene(size - 1.8, size));
  close(inside.position.z, toScene(mid - 0.7, size));
  // 대각선 방향도 유클리드 거리: 모서리 (edge, −0.5)까지
  const a = R / 2;
  const corner = nearbyRegions({ x: edge - a, z: -0.5 - a }, regions, new Set()).find((r) => r.id === id)!;
  close(corner.distance, Math.hypot(a, a));
});

test("근처 영역: 높이는 가장 가까운 칸의 높이, 높이는 영역을 나누지 않는다", () => {
  const terrain = flatTerrain(24);
  terrain.tiles.forEach((t, i) => (t.height = i % 24 >= 12 ? 2 : 0));
  const regions = terrainRegions({ tiles: terrain.tiles, size: 24 });
  assert.equal(regions.list.length, 1);
  close(nearbyRegions({ x: 5, z: 5 }, regions, new Set())[0].position.y, 0);
  close(nearbyRegions({ x: 13, z: 5 }, regions, new Set())[0].position.y, 2 * LEVEL, 1e-9);
});

test("근처 영역: 반경 밖 영역은 켜지지 않고, 켜진 영역은 반경 + 히스테리시스까지 유지", () => {
  const size = Math.ceil(R + H) + 3;
  const { tiles } = map(["p".repeat(size - 1) + "r", ...Array(size - 1).fill("p".repeat(size))]);
  const regions = terrainRegions({ tiles, size });
  const rough = regions.list.find((r) => r.kind === "rough")!; // 오른쪽 끝 한 칸
  const edge = size - 1 - 0.5;
  const at = (d: number, ids: string[]) => nearbyRegions({ x: edge - d, z: 0 }, regions, new Set(ids)).some((r) => r.id === rough.id);
  if (H > 0) {
    assert.ok(!at(R + H / 2, []), "반경 밖: 새로 켜지지 않음");
    assert.ok(at(R + H / 2, [rough.id]), "반경 밖이라도 히스테리시스 안: 켜져 있으면 유지");
  }
  assert.ok(!at(R + H + 0.1, [rough.id]), "히스테리시스 밖: 꺼짐");
  assert.ok(at(R, []), "반경 위: 켜짐");
});

test("근처 영역: 최대 개수를 넘으면 층을 가리지 않고 가까운 순, 켜진 것은 우대", () => {
  // 체스판: 모든 타일이 각자 영역
  const rows = Array.from({ length: 9 }, (_, z) => Array.from({ length: 9 }, (_, x) => ((x + z) % 2 ? "r" : "p")).join(""));
  const regions = terrainRegions(map(rows));
  const near = nearbyRegions({ x: 4, z: 4 }, regions, new Set());
  assert.equal(near.length, DEFAULT_NEARBY.max);
  assert.equal(near[0].id, `surface-${4 * 9 + 4}`, "발밑 타일이 가장 가깝다");
  for (let i = 1; i < near.length; i++) assert.ok(near[i - 1].distance <= near[i].distance);
  // 거리 1인 이웃 4칸까지는 반드시 들어간다
  assert.ok(near.slice(0, 5).every((r) => r.distance <= 1));
  if (H > 0) {
    // 조금 움직여 다른 칸이 살짝 더 가까워져도 켜진 것을 유지
    const again = nearbyRegions({ x: 4.05, z: 4 }, regions, new Set(near.map((r) => r.id)));
    assert.deepEqual(again.map((r) => r.id).sort(), near.map((r) => r.id).sort());
  }
});

test("층: 한 칸이 여러 층에 함께 속하고, 각 층의 영역이 따로 켜진다", () => {
  const field = map(Array(7).fill("ooooooo"));
  // 가운데 3×3에 풀과 안개가 겹치고, 한 칸에 나무
  const env = fakeEnvironment(7, (x, z) => {
    const inside = Math.abs(x - 3) <= 1 && Math.abs(z - 3) <= 1;
    return inside ? { grass: 1, fog: 0.5, tree: x === 3 && z === 3 } : {};
  });
  const regions = terrainRegions({ ...field, environment: env });
  assert.deepEqual(regions.list.map((r) => `${r.layer}:${r.kind}:${r.tiles.length}`), [
    "surface:soft:49", "grass:grass:9", "tree:tree:1", "fog:fog:9",
  ]);
  const near = nearbyRegions({ x: 3, z: 3 }, regions, new Set(), UNCAPPED);
  assert.deepEqual(near.map((r) => r.id).sort(), ["fog-16", "grass-16", "surface-0", "tree-24"]);
  // 층끼리 음량을 나누지 않는다: 안에 서 있으면 모두 1. 농도는 음량이 아니라 amount로(패치로 보냄)
  assert.ok(near.every((r) => r.gain === 1 && r.width === 1));
  const grass = near.find((r) => r.id === "grass-16")!, fog = near.find((r) => r.id === "fog-16")!;
  close(grass.amount, 1);
  close(fog.amount, 0.5);
});

test("층: 농도는 음량에 쓰지 않고 amount(가장 가까운 칸의 값)로만 넘긴다", () => {
  const field = map(Array(7).fill("ppppppp"));
  const thin = terrainRegions({ ...field, environment: fakeEnvironment(7, () => ({ grass: 0.2 })) });
  const thick = terrainRegions({ ...field, environment: fakeEnvironment(7, () => ({ grass: 1 })) });
  const grassOf = (regions: ReturnType<typeof terrainRegions>) =>
    nearbyRegions({ x: 3, z: 3 }, regions, new Set()).find((r) => r.id === "grass-0")!;
  close(grassOf(thin).gain, 1);
  close(grassOf(thick).gain, 1);
  close(grassOf(thin).amount, 0.2, 1e-6);
  close(grassOf(thick).amount, 1);
});

test("층: 나무는 대각선으로도 이어 숲 하나, 물은 물 칸끼리", () => {
  const field = map(Array(5).fill("ppppp"));
  const env = fakeEnvironment(5, (x, z) => ({
    tree: (x === 0 && z === 0) || (x === 1 && z === 1),
    water: x >= 3 && z >= 3 ? 0.5 : null,
  }));
  const regions = terrainRegions({ ...field, environment: env });
  assert.deepEqual(regions.list.filter((r) => r.layer !== "surface").map((r) => `${r.id}:${r.tiles.join(",")}`), [
    "water-18:18,19,23,24", "tree-0:0,6",
  ]);
});

test("층: 구조물은 하나하나가 따로 소스이고 높이는 구조물 높이", () => {
  const field = map(Array(5).fill("ppppp"));
  const structures: Structure[] = [
    { kind: "stairs", x: 1, z: 1, height: 1, dx: 1, dz: 0, key: "stairs:1:1" },
    { kind: "stairs", x: 2, z: 1, height: 1, dx: 1, dz: 0, key: "stairs:2:1" },
  ];
  const regions = terrainRegions({ ...field, structures });
  const built = regions.list.filter((r) => r.layer === "structure");
  assert.deepEqual(built.map((r) => `${r.id}:${r.kind}`), ["structure-6:stairs", "structure-7:stairs"]);
  const near = nearbyRegions({ x: 1, z: 1 }, regions, new Set());
  close(near.find((r) => r.id === "structure-6")!.position.y, LEVEL);
});

test("층: 실제 derivation에서 번짐 덩어리는 풀·나무 층을 만든다", () => {
  const world = starterWorld();
  world.objects = [];
  world.terrain = flatTerrain(world.size);
  for (let z = 1; z < 10; z++) for (let x = 1; x < 11; x++) world.terrain.tiles[z * world.size + x] = { height: 1, surface: "soft" };
  const structures = deriveStructures(world);
  const environment = deriveEnvironment(world, structures);
  const regions = terrainRegions({ size: world.size, tiles: world.terrain.tiles, environment, structures });
  const layers = new Set(regions.list.map((r) => r.layer));
  assert.ok(layers.has("grass") && layers.has("tree"), [...layers].join(","));
  // 환경이 없으면 surface 층만
  assert.ok(surfaceOnly(terrainRegions({ size: world.size, tiles: world.terrain.tiles }).list).length > 0);
  assert.ok(terrainRegions({ size: world.size, tiles: world.terrain.tiles }).list.every((r) => r.layer === "surface"));
});

test("켤 것·끌 것 비교", () => {
  assert.deepEqual(diffActive(new Set(["a", "b"]), new Set(["b", "c"])), { on: ["c"], off: ["a"] });
});
