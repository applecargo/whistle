import test from "node:test";
import { deriveEnvironment } from "../lib/environment.ts";
import assert from "node:assert/strict";
import { starterWorld, createSimulation, validateWorld } from "../lib/world.ts";
import { createPlacedSounds, nearbySounds } from "../lib/audio/placed-sounds.ts";
import { validRecording, type Recording } from "../lib/audio/recording.ts";
import type { PlayerAudioFrame } from "../lib/audio/game-parameters.ts";

const sound: Recording = { data: "data:audio/wav;base64,AAAA", duration: 1, radius: 4, volume: 1, mode: "loop" };
const player: PlayerAudioFrame = { x: 6, y: 0, z: 6, size: 12, grass: 0, rough: 0, water: 0, grounded: true, falling: false, yaw: 0 };
function worldWithSounds(count = 1) {
  const world = starterWorld();
  world.assets.push({ id: "recording", name: "Sound", shape: "sphere", color: "#111111", solid: false, sound: { ...sound } });
  world.objects = Array.from({ length: count }, (_, i) => ({ id: `sound${i}`, asset: "recording", x: 6 + i % 5, z: 5 + Math.floor(i / 5), scale: 1, rotation: 0 }));
  return world;
}
function contextProbe(deferred = false) {
  let decoded = 0, starts = 0, active = 0;
  let resolve!: (value: AudioBuffer) => void;
  const buffer = { duration: 1, numberOfChannels: 1 } as AudioBuffer;
  const nodes: { onended: (() => void) | null; stop(): void; start(): void }[] = [];
  const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect(next: unknown) { return next; }, disconnect() {} });
  const ctx = {
    currentTime: 2, state: "running", destination: {},
    decodeAudioData: () => { decoded++; return deferred ? new Promise<AudioBuffer>(r => { resolve = r; }) : Promise.resolve(buffer); },
    createBufferSource: () => {
      const source = { ...node(), onended: null as (() => void) | null,
        start() { starts++; active++; }, stop() { active--; } };
      nodes.push(source); return source;
    },
    createGain: () => ({ ...node(), gain: param() }),
    createStereoPanner: () => ({ ...node(), pan: param() }),
  } as unknown as AudioContext;
  return { ctx, nodes, finish: () => resolve(buffer), state: () => ({ decoded, starts, active }) };
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

test("distance reduces volume and turning reverses left and right", () => {
  const world = worldWithSounds(); world.objects[0].x = 7; world.objects[0].z = 6;
  const actors = createSimulation(world).actors;
  const near = nearbySounds(world, actors, player)[0];
  const far = nearbySounds(world, actors, { ...player, x: 4 })[0];
  assert.ok(near.gain > far.gain);
  assert.equal(near.pan, 1);
  assert.equal(nearbySounds(world, actors, { ...player, yaw: Math.PI })[0].pan, -1);
  assert.equal(nearbySounds(world, actors, { ...player, x: 0 })[0].gain, 0);
});

test("only three nearby voices play, share one decoded buffer, and stop on exit", async () => {
  const world = worldWithSounds(5), actors = createSimulation(world).actors, probe = contextProbe();
  const audio = createPlacedSounds(probe.ctx, () => assert.fail("decode failed"));
  audio.update(world, actors, player); await flush();
  assert.deepEqual(probe.state(), { decoded: 1, starts: 3, active: 3 });
  audio.update(world, actors, { ...player, x: 0, z: 0 });
  assert.equal(probe.state().active, 0);
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().decoded, 2);
  audio.stop(); assert.equal(probe.state().active, 0);
});

test("late decoding cannot start playback after stopping", async () => {
  const world = worldWithSounds(), probe = contextProbe(true);
  const audio = createPlacedSounds(probe.ctx, () => assert.fail("decode failed"));
  audio.update(world, createSimulation(world).actors, player);
  audio.stop(); probe.finish(); await flush();
  assert.equal(probe.state().starts, 0);
});

test("approach clips play once and rearm only after leaving the radius", async () => {
  const world = worldWithSounds(); world.assets.at(-1)!.sound!.mode = "approach";
  const actors = createSimulation(world).actors, probe = contextProbe();
  const audio = createPlacedSounds(probe.ctx, () => assert.fail("decode failed"));
  audio.update(world, actors, player); await flush();
  probe.nodes[0].stop(); probe.nodes[0].onended?.();
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().starts, 1);
  audio.update(world, actors, { ...player, x: 0, z: 0 });
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().starts, 2);
  audio.stop();
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
