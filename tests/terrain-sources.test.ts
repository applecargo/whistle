import assert from "node:assert/strict";
import { test } from "node:test";
import { toScene, forwardOf, terrainRegions, nearbyRegions, diffActive, DEFAULT_NEARBY } from "../lib/audio/terrain-sources.ts";
import { LEVEL, flatTerrain, type Surface, type Tile } from "../lib/terrain.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

/** 문자 지도로 지형을 만든다. p=plain r=rough s=slick o=soft .=구멍 */
function map(rows: string[]): { tiles: Tile[]; size: number } {
  const kinds: Record<string, Surface> = { p: "plain", r: "rough", s: "slick", o: "soft" };
  const size = rows.length;
  const tiles = rows.join("").split("").map((c): Tile =>
    c === "." ? { height: 0, surface: "plain", hole: true } : { height: 0, surface: kinds[c] });
  return { tiles, size };
}

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
  const { list } = terrainRegions(tiles, size);
  const summary = list.map((r) => `${r.surface}:${r.tiles.join(",")}`);
  assert.deepEqual(summary, [
    "rough:0,1,4",
    "plain:2,3,5,6,8,9,10,13",
    "rough:7,11,14,15",
    "rough:12",
  ]);
  assert.equal(list[0].id, "region-0");
  assert.equal(list[0].patch, "terrain_clock");
});

test("영역: 대각선으로만 닿으면 다른 영역, 구멍은 영역을 끊고 영역에 들지 않는다", () => {
  const diagonal = terrainRegions(map(["rp", "pr"]).tiles, 2).list;
  assert.equal(diagonal.filter((r) => r.surface === "rough").length, 2);
  const { list, regionOf } = terrainRegions(map(["p.p", "p.p", "p.p"]).tiles, 3);
  assert.equal(list.length, 2);
  assert.equal(regionOf[1], -1);
  // 예전 형식의 구멍(height −1)
  const legacy = flatTerrain(3).tiles.map((t, i) => (i === 4 ? { ...t, height: -1 } : t));
  assert.ok(terrainRegions(legacy, 3).list.every((r) => !r.tiles.includes(4)));
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
  const regions = terrainRegions(tiles, size);
  const near = nearbyRegions({ x: 3, z: 2 }, regions, new Set());
  const rough = near.filter((r) => regions.list.find((l) => l.id === r.id)!.surface === "rough");
  assert.equal(rough.length, 2);
  // 왼쪽 섬은 플레이어 왼쪽(−x), 오른쪽 섬은 오른쪽(+x)
  const [left, right] = [...rough].sort((a, b) => a.position.x - b.position.x);
  assert.ok(left.position.x < toScene(3, size) && right.position.x > toScene(3, size));
  close(left.gain, right.gain, 1e-9);
});

test("근처 영역: 위치는 반경 안 타일의 가중 중심, 음량은 반경 안 비중", () => {
  const terrain = flatTerrain(24);
  terrain.tiles.forEach((t, i) => (t.height = i % 24 >= 12 ? 2 : 0));
  const regions = terrainRegions(terrain.tiles, 24);
  assert.equal(regions.list.length, 1); // 높이는 영역을 나누지 않는다
  const [only] = nearbyRegions({ x: 5, z: 5 }, regions, new Set());
  // 모두 같은 영역 안 → 비중 1, 중심은 플레이어 위치, 높이 0(반경 안은 모두 x<12)
  close(only.gain, 1);
  close(only.position.x, toScene(5, 24), 1e-9);
  close(only.position.z, toScene(5, 24), 1e-9);
  close(only.position.y, 0);
  // 높이 경계 위에 서면 중심 높이가 그 사이
  const [edge] = nearbyRegions({ x: 11.5, z: 5 }, regions, new Set());
  assert.ok(edge.position.y > 0 && edge.position.y < 2 * LEVEL);
});

test("근처 영역: 반경 밖 영역은 켜지지 않고, 켜진 영역은 반경 + 0.5까지 유지", () => {
  const { tiles, size } = map(["ppppppppr", ...Array(8).fill("ppppppppp")]);
  const regions = terrainRegions(tiles, size);
  const rough = regions.list.find((r) => r.surface === "rough")!; // (8, 0)
  const at = (x: number, ids: string[]) => nearbyRegions({ x, z: 0 }, regions, new Set(ids)).some((r) => r.id === rough.id);
  assert.ok(!at(4.7, []), "거리 3.3: 새로 켜지지 않음");
  assert.ok(at(4.7, [rough.id]), "거리 3.3: 켜져 있으면 유지");
  assert.ok(!at(4.4, [rough.id]), "거리 3.6: 꺼짐");
  assert.ok(at(5, []), "거리 3: 켜짐");
});

test("근처 영역: 최대 개수를 넘으면 비중이 큰 순, 켜진 것은 우대", () => {
  // 체스판: 모든 타일이 각자 영역
  const rows = Array.from({ length: 9 }, (_, z) => Array.from({ length: 9 }, (_, x) => ((x + z) % 2 ? "r" : "p")).join(""));
  const regions = terrainRegions(map(rows).tiles, 9);
  const near = nearbyRegions({ x: 4, z: 4 }, regions, new Set());
  assert.equal(near.length, DEFAULT_NEARBY.max);
  assert.equal(near[0].id, `region-${4 * 9 + 4}`, "발밑 타일이 가장 크다");
  for (let i = 1; i < near.length; i++) assert.ok(near[i - 1].gain >= near[i].gain);
  const again = nearbyRegions({ x: 4.05, z: 4 }, regions, new Set(near.map((r) => r.id)));
  assert.deepEqual(again.map((r) => r.id).sort(), near.map((r) => r.id).sort());
});

test("켤 것·끌 것 비교", () => {
  assert.deepEqual(diffActive(new Set(["a", "b"]), new Set(["b", "c"])), { on: ["c"], off: ["a"] });
});
