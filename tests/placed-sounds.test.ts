import test from "node:test";
import { deriveEnvironment } from "../lib/environment.ts";
import assert from "node:assert/strict";
import { starterWorld, createSimulation, validateWorld } from "../lib/world.ts";
import { createPlacedSounds, nearbySounds } from "../lib/audio/placed-sounds.ts";
import { wavFile, type PlaySound } from "../lib/audio/pd-sounds.ts";
import { validRecording, type Recording } from "../lib/audio/recording.ts";
import type { PlayerAudioFrame } from "../lib/audio/game-parameters.ts";
import type { PatchHandle, SoundscapeSource } from "../lib/audio/soundscape.ts";
import { toScene } from "../lib/audio/terrain-sources.ts";

const sound: Recording = { data: "data:audio/wav;base64,AAAA", duration: 1, radius: 4, volume: 1, mode: "loop" };
const player: PlayerAudioFrame = { x: 6, y: 0, z: 6, size: 12, grass: 0, rough: 0, water: 0, grounded: true, falling: false, yaw: 0 };
function worldWithSounds(count = 1) {
  const world = starterWorld();
  world.assets.push({ id: "recording", name: "Sound", shape: "sphere", color: "#111111", solid: false, sound: { ...sound } });
  world.objects = Array.from({ length: count }, (_, i) => ({ id: `sound${i}`, asset: "recording", x: 6 + i % 5, z: 5 + Math.floor(i / 5), scale: 1, rotation: 0 }));
  return world;
}
/** 가짜 사운드스케이프(소스를 켜면 source.start로 슬롯을 연다)와 가짜 play(Pd 슬롯 대신).
 *  plays: play 호출 수, active: 살아 있는 소리 수, end(): 재생 중인 소리가 끝났다고 알림, sent: 패치로 보낸 메시지 */
function scapeProbe(deferred = false) {
  let plays = 0, active = 0;
  const sent: string[] = [];
  const waiting: (() => void)[] = [], ends: (() => void)[] = [];
  const sources = new Map<string, SoundscapeSource>();
  type FakeVoice = { state: "loading" | "active"; wanted: boolean; patch?: PatchHandle };
  const voices = new Map<string, FakeVoice>();
  const deliver = (id: string) => {
    const voice = voices.get(id), source = sources.get(id);
    for (const [bus, messages] of Object.entries(source?.messages ?? {}))
      for (const message of messages) voice?.patch?.send?.(bus, message);
  };
  const scape = {
    set(source: SoundscapeSource) { sources.set(source.id, source); if (voices.get(source.id)?.state === "active") deliver(source.id); },
    remove(id: string) { scape.deactivate(id); sources.delete(id); },
    activate(id: string) {
      if (voices.has(id)) return;
      const voice: FakeVoice = { state: "loading", wanted: true };
      voices.set(id, voice);
      sources.get(id)!.start!().then((patch) => {
        if (!voice.wanted) { patch.destroy(); return; }
        Object.assign(voice, { state: "active", patch });
        deliver(id);
      }, () => voices.delete(id));
    },
    deactivate(id: string) {
      const voice = voices.get(id);
      if (!voice) return;
      voice.wanted = false;
      voice.patch?.destroy();
      voices.delete(id);
    },
    snapshot: () => ({ sources: sources.size, voices: [...voices].map(([id, v]) => ({ id, patch: "placed_sound", state: v.state, instance: v.patch?.id })) }),
  };
  const node = { connect(next: unknown) { return next; }, disconnect() {} } as unknown as AudioNode;
  const voice = () => {
    active++;
    return { id: `v${plays}`, node, onEnd: (listener: () => void) => { ends.push(listener); },
      send: (_bus: string, message: (string | number)[]) => { sent.push(message.join(" ")); }, destroy() { active--; } };
  };
  const play: PlaySound = {
    prepare: () => Promise.resolve(),
    play: () => { plays++; return deferred ? new Promise(resolve => waiting.push(() => resolve(voice()))) : Promise.resolve(voice()); },
  };
  return { scape, sources, play, finish: () => waiting.splice(0).forEach(go => go()), end: () => ends.splice(0).forEach(go => go()), state: () => ({ plays, active }), sent };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("recordings survive validation and reject URLs, malformed data, excessive duration and placement counts", () => {
  const world = worldWithSounds();
  assert.deepEqual(validateWorld(world).assets.at(-1)?.sound, sound);
  for (const change of [{ data: "https://example.com/audio.mp3" }, { data: "data:audio/wav;base64,AAAA!" }, { duration: 61 }, { radius: NaN }, { volume: 2 }])
    assert.equal(validRecording({ ...sound, ...change }), false);
  assert.throws(() => validateWorld(worldWithSounds(21)), /20개/);
  world.assets.at(-1)!.sound!.data = "data:audio/wav;base64,AAAA!";
  assert.throws(() => validateWorld(world), /사물 데이터/);
});

test("distance reduces volume; the source sits on its tile like a region (direction comes from the panner)", async () => {
  const world = worldWithSounds(); world.objects[0].x = 7; world.objects[0].z = 6;
  const actors = createSimulation(world).actors;
  const near = nearbySounds(world, actors, player)[0];
  const far = nearbySounds(world, actors, { ...player, x: 4 })[0];
  assert.ok(near.gain > far.gain);
  assert.equal(nearbySounds(world, actors, { ...player, x: 0 })[0].gain, 0);
  const probe = scapeProbe(), audio = createPlacedSounds(probe.scape, probe.play);
  audio.update(world, actors, player);
  const source = probe.sources.get("placed:sound0")!;
  assert.deepEqual([source.position.x, source.position.z], [toScene(7, world.size), toScene(6, world.size)]);
  assert.equal(source.gain, near.gain);
  audio.stop();
});

test("only three nearby voices play and stop on exit", async () => {
  const world = worldWithSounds(5), actors = createSimulation(world).actors, probe = scapeProbe();
  const audio = createPlacedSounds(probe.scape, probe.play);
  audio.update(world, actors, player); await flush();
  assert.deepEqual(probe.state(), { plays: 3, active: 3 });
  audio.update(world, actors, { ...player, x: 0, z: 0 });
  assert.equal(probe.state().active, 0);
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().plays, 6);
  audio.stop(); assert.equal(probe.state().active, 0);
});

test("playing sounds get their distance and radius (tiles) each update", async () => {
  const world = worldWithSounds(), actors = createSimulation(world).actors, probe = scapeProbe();
  const audio = createPlacedSounds(probe.scape, probe.play);
  audio.update(world, actors, player); await flush();
  audio.update(world, actors, player);
  const [item] = audio.snapshot();
  const radius = nearbySounds(world, actors, player)[0].radius;
  assert.deepEqual(probe.sent, [`distance ${item.distance} ${radius}`, `distance ${item.distance} ${radius}`], "열 때 한 번, 다음 update에 한 번");
});

test("a slot that opens late cannot play after stopping", async () => {
  const world = worldWithSounds(), probe = scapeProbe(true);
  const audio = createPlacedSounds(probe.scape, probe.play);
  audio.update(world, createSimulation(world).actors, player);
  audio.stop(); probe.finish(); await flush();
  assert.equal(probe.state().active, 0);
});

test("approach clips play once (until the patch says it ended) and rearm only after leaving the radius", async () => {
  const world = worldWithSounds(); world.assets.at(-1)!.sound!.mode = "approach";
  const actors = createSimulation(world).actors, probe = scapeProbe();
  const audio = createPlacedSounds(probe.scape, probe.play);
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().active, 1);
  probe.end();
  assert.equal(probe.state().active, 0, "패치가 끝을 알리면 슬롯을 닫는다");
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().plays, 1);
  audio.update(world, actors, { ...player, x: 0, z: 0 });
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().plays, 2);
  audio.stop();
});

test("uploaded sounds become a 16-bit wav for Pd, stereo kept", () => {
  const wav = wavFile([new Float32Array([1, -1, 0.5]), new Float32Array([0, 0.5, -2])], 48000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(view.getUint16(22, true), 2, "스테레오");
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 12, "프레임 3개 × 2채널 × 2바이트");
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)), [32767, 0, -32767, 16384, 16384, -32767], "L R 번갈아");
  assert.equal(new DataView(wavFile([new Float32Array(4)], 44100).buffer).getUint16(22, true), 1, "모노는 모노");
});

test("20 stored sounds can exceed the old total byte cap, but a file cannot exceed 10 MB", () => {
  const world = worldWithSounds(20);
  const asset = world.assets.at(-1)!;
  for (let i = 1; i < 20; i++) world.assets.push({ ...asset, id: `recording${i}`, sound: { ...sound } });
  const data = "data:audio/wav;base64," + Buffer.alloc(1_000_000).toString("base64");
  for (const item of world.assets) if (item.sound) item.sound.data = data;
  assert.doesNotThrow(() => validateWorld(world));
  assert.equal(validRecording({ ...sound, data: "data:audio/wav;base64," + Buffer.alloc(10_000_000).toString("base64") }), true);
  assert.equal(validRecording({ ...sound, data: "data:audio/wav;base64," + Buffer.alloc(10_000_001).toString("base64") }), false);
});

test("terrain rules replace stored radii and change which recordings are audible", () => {
  const world = worldWithSounds(), actors = createSimulation(world).actors;
  world.assets.at(-1)!.sound!.radius = 8;
  const environment = deriveEnvironment(world);
  const source = world.objects[0], cell = environment.cells[source.z * world.size + source.x];
  const distant = { ...player, x: source.x - 5, z: source.z };
  assert.equal(nearbySounds(world, actors, distant, environment)[0].gain, 0);
  cell.water = 0;
  assert.ok(nearbySounds(world, actors, distant, environment)[0].gain > 0);
  cell.water = null;
  cell.grass = 1;
  const nearby = { ...player, x: source.x - 2.5, z: source.z };
  assert.ok(nearbySounds(world, actors, nearby, environment)[0].gain > 0);
  cell.tree = true;
  assert.equal(nearbySounds(world, actors, nearby, environment)[0].gain, 0);
  cell.tree = false; cell.grass = 0; cell.light = 0.3;
  assert.equal(nearbySounds(world, actors, nearby, environment)[0].gain, 0);
  delete world.assets.at(-1)!.sound!.radius;
  assert.doesNotThrow(() => validateWorld(world));
});

for (const kind of ["image", "text", "sound"] as const) {
  test(`${kind} limits count both saved assets and placements, including unplaced imports`, () => {
    const world = starterWorld();
    world.objects = [];
    const media = kind === "sound" ? { sound: { ...sound } }
      : { image: "data:image/png;base64,AAAA", ...(kind === "text" ? { text: "글" } : {}) };
    const asset = { id: "media", name: "1", shape: "sphere" as const, color: "#111111", solid: false, ...media };
    for (let i = 0; i < 20; i++) world.assets.push({ ...asset, id: `media${i}` });
    assert.doesNotThrow(() => validateWorld(world));
    world.assets.push(asset);
    assert.throws(() => validateWorld(world), /20개/);
    world.assets.pop();
    for (let i = 0; i < 21; i++) world.objects.push({ id: `placed${i}`, asset: "media0", x: i % 12, z: Math.floor(i / 12), scale: 1, rotation: 0 });
    assert.throws(() => validateWorld(world), /20개/);
    world.objects.pop();
    assert.doesNotThrow(() => validateWorld(world));
  });
}
