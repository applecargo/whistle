import assert from "node:assert/strict";
import { test } from "node:test";
import { createGameSoundscape, EAR_HEIGHT } from "../lib/audio/game-soundscape.ts";
import type { SoundscapeSource, Vec3 } from "../lib/audio/soundscape.ts";
import type { PlayerAudioFrame } from "../lib/audio/game-parameters.ts";
import { flatTerrain } from "../lib/terrain.ts";

function fakeScape() {
  const calls: string[] = [];
  const sources = new Map<string, SoundscapeSource>();
  let listener: { position: Vec3; forward: Vec3 } | undefined;
  return {
    calls, sources, listener: () => listener,
    set(source: SoundscapeSource) { sources.set(source.id, source); },
    remove(id: string) { sources.delete(id); calls.push(`remove ${id}`); },
    activate(id: string) { calls.push(`on ${id}`); },
    deactivate(id: string) { calls.push(`off ${id}`); },
    setListener(position: Vec3, forward: Vec3) { listener = { position, forward }; },
  };
}
const frame = (x: number, z: number, size: number, yaw = 0): PlayerAudioFrame => ({
  x, y: 0, z, size, grass: 0, rough: 0, water: 0, grounded: true, falling: false, yaw,
});

test("첫 프레임에 등록하고, 같은 지형이면 다시 등록하지 않는다", () => {
  const scape = fakeScape();
  const logs: string[] = [];
  const game = createGameSoundscape(scape, (m) => logs.push(m));
  const tiles = flatTerrain(24).tiles;
  game.frame(frame(10, 10, 24), tiles);
  game.frame(frame(10, 10, 24), tiles);
  assert.equal(scape.sources.size, 576);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /지형 소스 등록 576개 \(24×24, terrain_clock 576\)/);
});

test("리스너: 장면 좌표, 귀 높이, yaw 방향", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  game.frame({ ...frame(11.5, 0, 24, Math.PI / 2), y: 2 }, flatTerrain(24).tiles);
  const { position, forward } = scape.listener()!;
  assert.deepEqual(position, { x: 0, y: 2 + EAR_HEIGHT, z: -23 });
  assert.ok(Math.abs(forward.x - 1) < 1e-9 && Math.abs(forward.z) < 1e-9);
});

test("근처 타일만 켜고, 이동하면 벗어난 것은 끄고 새로 들어온 것은 켠다", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  const tiles = flatTerrain(24).tiles;
  game.frame(frame(5, 5, 24), tiles);
  const first = new Set(game.activeIds());
  assert.equal(first.size, 10);
  assert.equal(scape.calls.filter((c) => c.startsWith("on ")).length, 10);
  scape.calls.length = 0;
  game.frame(frame(15, 5, 24), tiles); // 10타일 이동: 전부 바뀜
  const second = new Set(game.activeIds());
  assert.equal([...second].filter((id) => first.has(id)).length, 0);
  assert.equal(scape.calls.filter((c) => c.startsWith("off ")).length, 10);
  assert.equal(scape.calls.filter((c) => c.startsWith("on ")).length, 10);
});

test("제자리에서는 켜고 끄기를 반복하지 않는다", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  const tiles = flatTerrain(24).tiles;
  game.frame(frame(5, 5, 24), tiles);
  scape.calls.length = 0;
  for (let i = 0; i < 5; i++) game.frame(frame(5 + i * 0.01, 5, 24), tiles);
  assert.deepEqual(scape.calls, []);
});

test("stop: 켜진 것을 모두 끄고, 다음 프레임에서 다시 켠다", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  const tiles = flatTerrain(24).tiles;
  game.frame(frame(5, 5, 24), tiles);
  scape.calls.length = 0;
  game.stop();
  assert.equal(scape.calls.filter((c) => c.startsWith("off ")).length, 10);
  assert.deepEqual(game.activeIds(), []);
  game.frame(frame(5, 5, 24), tiles);
  assert.equal(game.activeIds().length, 10);
});

test("지형이 바뀌면 끄고 이전 소스를 지운 뒤 새로 등록한다", () => {
  const scape = fakeScape();
  const logs: string[] = [];
  const game = createGameSoundscape(scape, (m) => logs.push(m));
  game.frame(frame(5, 5, 24), flatTerrain(24).tiles);
  scape.calls.length = 0;
  game.frame(frame(5, 5, 12), flatTerrain(12).tiles);
  assert.equal(scape.calls.filter((c) => c.startsWith("off ")).length, 10);
  assert.equal(scape.calls.filter((c) => c.startsWith("remove ")).length, 576);
  assert.equal(scape.sources.size, 144);
  assert.equal(logs.length, 2);
});
