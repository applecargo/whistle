import assert from "node:assert/strict";
import { test } from "node:test";
import { toScene, forwardOf, terrainSources, nearbyTiles, diffActive, tileSourceId, DEFAULT_NEARBY } from "../lib/audio/terrain-sources.ts";
import { LEVEL, flatTerrain } from "../lib/terrain.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const all = (size: number) => new Set(Array.from({ length: size * size }, (_, i) => i));

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

test("타일마다 소스 하나, 장면 좌표와 높이, 구멍은 제외", () => {
  const terrain = flatTerrain(3);
  terrain.tiles[4] = { height: 2, surface: "rough" };
  terrain.tiles[0] = { height: 0, surface: "plain", hole: true };
  terrain.tiles[1] = { height: -1, surface: "plain" }; // 예전 형식의 구멍
  const sources = terrainSources(terrain.tiles, 3);
  assert.equal(sources.length, 7);
  assert.ok(!sources.some((s) => s.id === tileSourceId(1)));
  const center = sources.find((s) => s.id === tileSourceId(4))!;
  assert.deepEqual(center.position, { x: 0, y: 2 * LEVEL, z: 0 });
  assert.equal(center.patch, "terrain_clock");
  assert.ok(!sources.some((s) => s.id === tileSourceId(0)));
  assert.deepEqual(sources.find((s) => s.id === tileSourceId(8))!.position, { x: 2, y: 0, z: 2 });
});

test("근처 타일: 반경 3 안에서 가까운 순 최대 10개", () => {
  const near = nearbyTiles({ x: 10, z: 10 }, 24, all(24), new Set());
  assert.equal(near.size, 10);
  assert.ok(near.has(tileSourceId(10 * 24 + 10)), "발밑 타일 포함");
  for (const id of near) {
    const i = Number(id.slice(5));
    assert.ok(Math.hypot(i % 24 - 10, Math.floor(i / 24) - 10) <= 3);
  }
});

test("근처 타일: 맵 가장자리와 후보가 없는 타일", () => {
  const near = nearbyTiles({ x: 0, z: 0 }, 24, all(24), new Set(), { ...DEFAULT_NEARBY, max: 100 });
  // 반경 3의 1/4 원(경계 포함): x,z ≥ 0
  let expected = 0;
  for (let z = 0; z <= 3; z++) for (let x = 0; x <= 3; x++) if (Math.hypot(x, z) <= 3) expected++;
  assert.equal(near.size, expected);
  assert.equal(nearbyTiles({ x: 5, z: 5 }, 24, new Set(), new Set()).size, 0);
});

test("근처 타일: 이미 켜진 것은 반경 + 0.5까지 유지(경계 깜빡임 방지)", () => {
  const id = tileSourceId(0 * 24 + 13); // (13, 0)
  const options = { ...DEFAULT_NEARBY, max: 100 };
  // 플레이어 (9.7, 0): 거리 3.3 → 새로 켜지지는 않지만 켜져 있으면 유지
  assert.ok(!nearbyTiles({ x: 9.7, z: 0 }, 24, all(24), new Set(), options).has(id));
  assert.ok(nearbyTiles({ x: 9.7, z: 0 }, 24, all(24), new Set([id]), options).has(id));
  // 거리 3.6 → 꺼짐
  assert.ok(!nearbyTiles({ x: 9.4, z: 0 }, 24, all(24), new Set([id]), options).has(id));
});

test("근처 타일: 최대 개수 경계에서도 조금 움직였다고 바뀌지 않고, 충분히 가까워지면 바뀐다", () => {
  const first = nearbyTiles({ x: 10, z: 10 }, 24, all(24), new Set());
  const nudged = nearbyTiles({ x: 10.05, z: 10 }, 24, all(24), first);
  assert.deepEqual([...nudged].sort(), [...first].sort());
  const moved = nearbyTiles({ x: 11, z: 10 }, 24, all(24), first);
  assert.notDeepEqual([...moved].sort(), [...first].sort());
  assert.ok(moved.has(tileSourceId(10 * 24 + 11)), "새 발밑 타일은 켜진다");
});

test("근처 타일: 같은 입력이면 같은 결과(거리가 같을 때 순서 고정)", () => {
  const a = [...nearbyTiles({ x: 10, z: 10 }, 24, all(24), new Set())];
  const b = [...nearbyTiles({ x: 10, z: 10 }, 24, all(24), new Set())];
  assert.deepEqual(a, b);
});

test("켤 것·끌 것 비교", () => {
  assert.deepEqual(diffActive(new Set(["a", "b"]), new Set(["b", "c"])), { on: ["c"], off: ["a"] });
});
