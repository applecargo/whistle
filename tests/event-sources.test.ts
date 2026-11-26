import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventSources, EVENT_RULE, SOURCE_BUS } from "../lib/audio/event-sources.ts";
import { ruleGain } from "../lib/audio/spatial-rule.ts";
import { toScene } from "../lib/audio/terrain-sources.ts";
import { EAR_HEIGHT } from "../lib/audio/game-soundscape.ts";
import type { PatchHandle, SoundscapeSource } from "../lib/audio/soundscape.ts";
import type { PlayerAudioFrame } from "../lib/audio/game-parameters.ts";

const player: PlayerAudioFrame = { x: 5, y: 0, z: 5, size: 12, grass: 0, rough: 0, water: 0, grounded: true, falling: false, yaw: 0 };
/** 격자 좌표 → whistle-player position 좌표 */
const norm = (tile: number) => (tile + 0.5) / player.size;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** 가짜 사운드스케이프(activate하면 source.start로 연다)와 가짜 엔진 start. sent: 패치로 보낸 것 */
function probe(fail = false) {
  const sources = new Map<string, SoundscapeSource>();
  const open = new Map<string, PatchHandle>();
  const sent: string[] = [], removed: string[] = [], warnings: string[] = [];
  let starts = 0;
  const scape = {
    set(source: SoundscapeSource) { sources.set(source.id, source); },
    remove(id: string) { removed.push(id); open.get(id)?.destroy(); open.delete(id); sources.delete(id); },
    activate(id: string) { void sources.get(id)!.start!().then((h) => open.set(id, h), () => {}); },
    deactivate() {},
  };
  const start = async (patch: string, name: string): Promise<PatchHandle> => {
    starts++;
    if (fail) throw new Error("슬롯이 모자람");
    return { id: name, node: {} as AudioNode, destroy() {}, send(bus, message) { sent.push(`${name}-${bus} ${message.join(" ")}`); } };
  };
  const events = createEventSources(scape, start, (m) => warnings.push(m));
  return { events, sources, open, sent, removed, warnings, starts: () => starts };
}

test("만들면 첫 프레임부터 슬롯을 열고, 규칙대로 음량을 정한다. 좌표는 whistle-player position과 같다", async () => {
  const p = probe();
  assert.equal(p.events.spawn("star1", "fallingstar_source", { x: norm(8), y: EAR_HEIGHT, z: norm(1) }), true);
  assert.equal(p.starts(), 0, "플레이어 위치를 모르면 아직 열지 않는다");
  p.events.frame(player); await flush();
  assert.equal(p.starts(), 1);
  const source = p.sources.get("star1")!;
  assert.deepEqual([source.position.x, source.position.z], [toScene(8, 12), toScene(1, 12)]);
  assert.equal(source.gain, ruleGain(EVENT_RULE, 5), "3-4-5: 5타일");
  assert.deepEqual(p.sent.slice(0, 2), ["star1-whistle-source alive 1", `star1-whistle-source pos ${norm(8)} ${EAR_HEIGHT} ${norm(1)}`]);
  assert.deepEqual(source.messages, { [SOURCE_BUS]: [["distance", 5]] });
});

test("이름: v+숫자(엔진이 쓰는 꼴)와 살아 있는 이름은 받지 않는다. 끝난 이름은 다시 쓴다", async () => {
  const p = probe();
  p.events.frame(player);
  assert.equal(p.events.spawn("v12", "x", { x: 0.5, y: 0, z: 0.5 }), false);
  assert.equal(p.events.spawn("star", "x", { x: 0.5, y: 0, z: 0.5 }), true);
  assert.equal(p.events.spawn("star", "x", { x: 0.5, y: 0, z: 0.5 }), false);
  p.events.set("star", ["alive", 0]);
  assert.deepEqual(p.removed, ["star"]);
  assert.equal(p.events.spawn("star", "x", { x: 0.5, y: 0, z: 0.5 }), true);
  assert.equal(p.warnings.length, 2);
});

test("값은 한 곳: 누가 바꾸든(Pd·게임) 패치로 다시 보낸다. 규칙 낱말·pos를 받는다", async () => {
  const p = probe();
  p.events.frame(player);
  p.events.fromPdSpawn("rainy", ["fallingstar_source", norm(5), 0, norm(5), "range", 4, "curve", "exp"]);
  await flush();
  p.sent.length = 0;
  p.events.set("rainy", ["curve", "pow", 3]);
  p.events.set("rainy", ["pos", norm(6), 0, norm(5)]);
  p.events.set("rainy", ["nonsense", 1]);
  assert.deepEqual(p.sent, ["rainy-whistle-source curve pow 3", `rainy-whistle-source pos ${norm(6)} 0 ${norm(5)}`]);
  const source = p.sources.get("rainy")!;
  assert.ok(source.gain! > 0 && source.gain! < 1, "range 4 안, 1타일 떨어짐(높이 차이 포함)");
  assert.equal(p.events.set("nobody", ["alive", 0]), false, "모르는 이름은 다른 소스(영역 슬롯)에게 넘긴다");
});

test("슬롯을 열지 못하면 알리고 지운다(매 프레임 다시 시도하지 않는다)", async () => {
  const p = probe(true);
  p.events.frame(player);
  p.events.spawn("star", "fallingstar_source", { x: 0.5, y: 0, z: 0.5 });
  await flush();
  p.events.frame(player); p.events.frame(player);
  assert.equal(p.starts(), 1);
  assert.equal(p.events.has("star"), false);
  assert.match(p.warnings[0], /띄우지 못했습니다/);
});

test("Pd의 whistle-spawn 모양이 틀리면 알린다", () => {
  const p = probe();
  p.events.fromPdSpawn("star", ["fallingstar_source", 0.5, "high", 0.5]);
  assert.equal(p.events.has("star"), false);
  assert.match(p.warnings[0], /x y z/);
});
