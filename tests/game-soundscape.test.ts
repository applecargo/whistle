import assert from "node:assert/strict";
import { test } from "node:test";
import { createGameSoundscape, EAR_HEIGHT } from "../lib/audio/game-soundscape.ts";
import type { SoundscapeSource, Vec3 } from "../lib/audio/soundscape.ts";
import type { PlayerAudioFrame } from "../lib/audio/game-parameters.ts";
import { flatTerrain, type Tile } from "../lib/terrain.ts";
import type { Environment } from "../lib/environment.ts";

function fakeScape() {
  const calls: string[] = [];
  const sources = new Map<string, SoundscapeSource>();
  let listener: { position: Vec3; forward: Vec3 } | undefined;
  return {
    calls, sources, listener: () => listener,
    set(source: SoundscapeSource) { sources.set(source.id, source); },
    remove(id: string) { sources.delete(id); calls.push(`remove ${id}`); },
    activate(id: string) {
      assert.ok(sources.has(id), "activate 전에 등록되어 있어야 한다");
      calls.push(`on ${id}`);
    },
    deactivate(id: string) { calls.push(`off ${id}`); },
    setListener(position: Vec3, forward: Vec3) { listener = { position, forward }; },
  };
}
const frame = (x: number, z: number, size: number, yaw = 0): PlayerAudioFrame => ({
  x, y: 0, z, size, grass: 0, rough: 0, water: 0, grounded: true, falling: false, yaw,
});
const field = (tiles: Tile[], size = 24) => ({ tiles, size });
const ons = (calls: string[]) => calls.filter((c) => c.startsWith("on "));
const offs = (calls: string[]) => calls.filter((c) => c.startsWith("off "));

/** 24×24 plain 위에 rough 섬 두 개: (2..3, 2..3), (20..21, 2..3) */
function twoIslands(): Tile[] {
  const tiles = flatTerrain(24).tiles;
  for (const [x0] of [[2], [20]]) for (let z = 2; z <= 3; z++) for (let x = x0; x <= x0 + 1; x++) {
    tiles[z * 24 + x] = { ...tiles[z * 24 + x], surface: "rough" };
  }
  return tiles;
}

test("첫 프레임에 영역을 등록하고, 같은 지형이면 다시 등록하지 않는다", () => {
  const scape = fakeScape();
  const logs: string[] = [];
  const game = createGameSoundscape(scape, (m) => logs.push(m));
  const tiles = twoIslands();
  game.frame(frame(10, 10, 24), field(tiles));
  game.frame(frame(10, 10, 24), field(tiles));
  assert.equal(scape.sources.size, 3);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /소리 영역 등록 3개 \(24×24, plain 1, rough 2\)/);
});

test("평평한 맵: 영역 하나 → 소스 하나만 켜진다", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  game.frame(frame(10, 10, 24), field(flatTerrain(24).tiles, 24));
  assert.deepEqual(game.activeIds(), ["surface-0"]);
  assert.equal(scape.sources.get("surface-0")!.gain, 1);
});

test("리스너: 장면 좌표, 귀 높이, yaw 방향", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  game.frame({ ...frame(11.5, 0, 24, Math.PI / 2), y: 2 }, field(flatTerrain(24).tiles, 24));
  const { position, forward } = scape.listener()!;
  assert.deepEqual(position, { x: 0, y: 2 + EAR_HEIGHT, z: -23 });
  assert.ok(Math.abs(forward.x - 1) < 1e-9 && Math.abs(forward.z) < 1e-9);
});

test("섬에 다가가면 그 섬이 켜지고, 다른 섬으로 옮겨가면 앞의 섬은 꺼진다", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  const tiles = twoIslands();
  game.frame(frame(4, 4, 24), field(tiles));
  const west = "surface-50", east = "surface-68"; // 2*24+2, 2*24+20
  assert.deepEqual(new Set(game.activeIds()), new Set(["surface-0", west]));
  scape.calls.length = 0;
  game.frame(frame(20, 4, 24), field(tiles));
  assert.deepEqual(new Set(game.activeIds()), new Set(["surface-0", east]));
  assert.deepEqual(offs(scape.calls), [`off ${west}`]);
  assert.deepEqual(ons(scape.calls), [`on ${east}`]);
});

test("켜진 영역은 프레임마다 위치·음량이 갱신된다", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  const tiles = twoIslands();
  game.frame(frame(5, 3, 24), field(tiles));
  const far = { ...scape.sources.get("surface-50")! };
  game.frame(frame(4, 1.2, 24), field(tiles)); // 외곽 (3.5, 1.5)까지 0.58
  const near = scape.sources.get("surface-50")!;
  assert.ok(near.gain! > far.gain!, "외곽에 가까워지면 커진다");
  assert.notDeepEqual(near.position, far.position);
});

test("제자리에서는 켜고 끄기를 반복하지 않는다", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  const tiles = twoIslands();
  game.frame(frame(5, 3, 24), field(tiles));
  scape.calls.length = 0;
  for (let i = 0; i < 5; i++) game.frame(frame(5 + i * 0.01, 3, 24), field(tiles));
  assert.deepEqual(scape.calls, []);
});

test("stop: 켜진 것을 모두 끄고, 다음 프레임에서 다시 켠다", () => {
  const scape = fakeScape();
  const game = createGameSoundscape(scape, () => {});
  const tiles = twoIslands();
  game.frame(frame(4, 4, 24), field(tiles));
  scape.calls.length = 0;
  game.stop();
  assert.equal(offs(scape.calls).length, 2);
  assert.deepEqual(game.activeIds(), []);
  game.frame(frame(4, 4, 24), field(tiles));
  assert.equal(game.activeIds().length, 2);
});

test("지형이 바뀌면 끄고 이전 영역을 지운 뒤 새로 등록한다", () => {
  const scape = fakeScape();
  const logs: string[] = [];
  const game = createGameSoundscape(scape, (m) => logs.push(m));
  game.frame(frame(4, 4, 24), field(twoIslands()));
  scape.calls.length = 0;
  game.frame(frame(5, 5, 12), field(flatTerrain(12).tiles, 12));
  assert.equal(offs(scape.calls).length, 2);
  assert.equal(scape.calls.filter((c) => c.startsWith("remove ")).length, 3);
  assert.equal(scape.sources.size, 1);
  assert.equal(logs.length, 2);
});

test("환경(derivation)이 바뀌면 다시 등록하고, 켜진 영역에는 width와 농도 메시지를 넘긴다", () => {
  const scape = fakeScape();
  const logs: string[] = [];
  const game = createGameSoundscape(scape, (m) => logs.push(m));
  const tiles = flatTerrain(24).tiles;
  game.frame(frame(10, 10, 24), field(tiles));
  assert.equal(scape.sources.get("surface-0")!.width, 1);
  assert.deepEqual(scape.sources.get("surface-0")!.messages, { "whistle-region": [1] });
  const environment = {
    size: 24, regions: [], trees: [], ponds: [],
    cells: tiles.map((_, i) => ({ grass: i % 24 < 12 ? 1 : 0, water: null, tree: false, fog: 0, windX: 0, windZ: 0 })),
  } as unknown as Environment;
  game.frame(frame(10, 10, 24), { tiles, size: 24, environment });
  assert.equal(logs.length, 2);
  assert.match(logs[1], /plain 1, grass 1/);
  assert.deepEqual(new Set(game.activeIds()), new Set(["surface-0", "grass-0"]));
  // (10, 10)은 풀(x < 12) 안: 음량 1, 농도는 메시지로
  assert.equal(scape.sources.get("grass-0")!.gain, 1);
  assert.deepEqual(scape.sources.get("grass-0")!.messages, { "whistle-region": [1] });
});
