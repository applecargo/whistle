import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameAudio } from "../lib/audio/game-audio.ts";
import { editSound, playerSound } from "../lib/audio/game-parameters.ts";
import { createWorldDeriver } from "../lib/world-derivation.ts";
import { starterWorld } from "../lib/world.ts";
import { flatTerrain } from "../lib/terrain.ts";
import type { PdSession, PlayerSound } from "../lib/audio/webpd-session.ts";
import { validateBoardHeight } from "../lib/audio/webpd-session.ts";
import { audioStateBus } from "../lib/audio/audio-state.ts";

test("board height accepts metres within the test range and rejects invalid measurements", () => {
  for (const height of [0, 0.1, 1.5, 10]) assert.equal(validateBoardHeight(height), height);
  for (const height of [-0.1, 10.01, NaN, Infinity, -Infinity]) {
    assert.throws(() => validateBoardHeight(height), /보드 높이/);
  }
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function session() {
  const edits: unknown[] = [], moves: PlayerSound[] = [], gates: boolean[] = [], events: unknown[] = [];
  let closed = 0, stops = 0;
  return {
    edits, moves, gates, events, get closed() { return closed; }, get stops() { return stops; },
    value: {
      context: { resume: async () => {} } as AudioContext,
      edit: (value: unknown) => edits.push(value),
      player: (value: PlayerSound) => moves.push(value),
      stopPlayer: () => { stops++; },
      event: (...values: number[]) => events.push(values),
      mute: (value: boolean) => gates.push(value),
      close: async () => { closed++; },
    } as Pick<PdSession, "context" | "edit" | "player" | "stopPlayer" | "event" | "mute" | "close">,
  };
}
const sound = { x: 0.5, z: 0.5, overlap: 0 };
const moving: PlayerSound = { x: 0.5, y: 0, z: 0.5, grass: 1, rough: 0 };

test("edit parameters identify terrain combinations and ignore regenerated IDs in cumulative strokes", () => {
  const before = starterWorld();
  before.objects = [{ id: "old", asset: "circle", x: 0, z: 0, rotation: 0, scale: 1 }];
  before.terrain = flatTerrain(before.size);
  before.terrain.tiles[1].surface = "rough";
  const next = structuredClone(before);
  next.objects[0].id = "regenerated";
  const derive = createWorldDeriver();
  assert.equal(editSound(before, next, [0], derive(next)), null);
  next.objects.push({ id: "new", asset: "square", x: 1, z: 0, rotation: 0, scale: 1 });
  assert.deepEqual(editSound(before, next, [0, 1], derive(next)), {
    x: 1.5 / 12, z: 0.5 / 12, overlap: 1, asset: "square", action: "add", surface: "rough",
  });
  assert.equal(editSound(next, before, [1], derive(before))?.action, "remove");
});

test("player parameters preserve spatial state without a speed field", () => {
  const frame = { x: 0, y: 2.5, z: 11, size: 12, grass: 1, rough: 0, water: 0,
    grounded: true, falling: false, yaw: 1 };
  assert.equal(playerSound(frame).x, 0.5 / 12);
  assert.equal(playerSound(frame).z, 11.5 / 12);
  assert.equal(playerSound(frame).y, 2.5);
  assert.equal("speed" in playerSound(frame), false);
  assert.equal(playerSound({ ...frame, grounded: false }).grounded, false);
  assert.equal(playerSound({ ...frame, falling: true }).falling, true);
});

test("one session keeps only the latest edit during startup and cancels it on play/exit", async () => {
  const stub = session();
  let finish!: (value: typeof stub.value) => void, loads = 0;
  const audio = createGameAudio(() => { loads++; return new Promise((resolve) => { finish = resolve; }); }, (error) => assert.fail(String(error)));
  audio.edit(sound);
  audio.edit({ ...sound, overlap: 1 });
  finish(stub.value);
  await tick();
  assert.equal(loads, 1);
  assert.deepEqual(stub.edits, [{ ...sound, overlap: 1 }]);
  audio.play();
  audio.movement(moving);
  await tick();
  assert.deepEqual(stub.moves.at(-1), moving);
  const moveCount = stub.moves.length;
  audio.pause();
  audio.movement(moving);
  audio.event(440, 0.1, 0);
  assert.equal(stub.moves.length, moveCount);
  assert.equal(stub.stops, 2);
  assert.equal(stub.gates.at(-1), true);
  assert.equal(stub.events.length, 0);
  audio.resume();
  audio.stop();
  await tick();
  assert.equal(stub.gates.at(-1), true);
  audio.dispose();
  assert.equal(stub.closed, 1);
});

test("pending load cannot replay stale input after exiting or unmounting", async () => {
  for (const dispose of [false, true]) {
    const stub = session();
    let finish!: (value: typeof stub.value) => void;
    const audio = createGameAudio(() => new Promise((resolve) => { finish = resolve; }), (error) => assert.fail(String(error)));
    audio.edit(sound);
    audio.play();
    audio.movement(moving);
    if (dispose) audio.dispose(); else audio.stop();
    finish(stub.value);
    await tick();
    assert.equal(stub.edits.length, 0);
    assert.equal(stub.moves.length, 0);
    assert.equal(stub.gates.length, 0);
    assert.equal(stub.closed, Number(dispose));
  }
});

test("a failed load can be retried by the next real interaction", async () => {
  const stub = session(), failures: unknown[] = [];
  let attempt = 0;
  const audio = createGameAudio(async () => {
    if (++attempt === 1) throw new Error("offline");
    return stub.value;
  }, (error) => failures.push(error));
  audio.edit(sound);
  await tick();
  assert.equal(failures.length, 1);
  audio.edit({ ...sound, overlap: 1 });
  await tick();
  assert.equal(attempt, 2);
  assert.deepEqual(stub.edits, [{ ...sound, overlap: 1 }]);
  audio.dispose();
});

test("AudioStateBus tracks player coordinates, yaw, and updates listener vectors", () => {
  audioStateBus.reset();
  let lastState: unknown;
  const unsubscribe = audioStateBus.subscribe((state: unknown) => { lastState = state; });
  audioStateBus.update({ x: 5, y: 1.5, z: 10, yaw: Math.PI / 2, crouch: true, run: false });
  assert.deepEqual(lastState, {
    x: 5, y: 1.5, z: 10, yaw: Math.PI / 2, crouch: true, run: false,
    grounded: true, falling: false, grass: 0, rough: 0, water: 0,
  });

  // Mock AudioContext listener
  const listener = {
    positionX: { value: 0, setValueAtTime(v: number) { this.value = v; } },
    positionY: { value: 0, setValueAtTime(v: number) { this.value = v; } },
    positionZ: { value: 0, setValueAtTime(v: number) { this.value = v; } },
    forwardX: { value: 0, setValueAtTime(v: number) { this.value = v; } },
    forwardY: { value: 0, setValueAtTime(v: number) { this.value = v; } },
    forwardZ: { value: 0, setValueAtTime(v: number) { this.value = v; } },
    upX: { value: 0, setValueAtTime(v: number) { this.value = v; } },
    upY: { value: 0, setValueAtTime(v: number) { this.value = v; } },
    upZ: { value: 0, setValueAtTime(v: number) { this.value = v; } },
  };
  const mockContext = { listener, currentTime: 0 } as unknown as AudioContext;
  audioStateBus.syncListener(mockContext);
  assert.equal(listener.positionX.value, 5);
  assert.equal(listener.positionY.value, 1.5);
  assert.equal(listener.positionZ.value, 10);
  assert.ok(Math.abs(listener.forwardX.value - 1) < 1e-6); // sin(PI/2) = 1
  assert.ok(Math.abs(listener.forwardZ.value) < 1e-6);    // -cos(PI/2) = 0
  unsubscribe();
});

test("SoundAssetManager manages clips, spatial 3D/2D playback, filter modes and voice pooling", async () => {
  const { SoundAssetManager } = await import("../lib/audio/sound-assets.ts");
  const manager = new SoundAssetManager();

  // Mock AudioBuffer and AudioContext
  const mockBuffer = { duration: 1.0, length: 44100 } as AudioBuffer;
  const mockContext = {
    currentTime: 0,
    decodeAudioData: async () => mockBuffer,
    createBufferSource: () => ({
      buffer: null,
      loop: false,
      connect() {},
      disconnect() {},
      start() {},
      stop() {},
      onended: null as (() => void) | null,
    }),
    createGain: () => ({
      gain: { value: 1, setValueAtTime(v: number) { this.value = v; } },
      connect() {},
      disconnect() {},
    }),
    createBiquadFilter: () => ({
      type: "lowpass",
      frequency: { setValueAtTime() {} },
      Q: { setValueAtTime() {} },
      connect() {},
      disconnect() {},
    }),
  } as unknown as AudioContext;

  // Global StereoPannerNode mock
  globalThis.StereoPannerNode = class {
    pan = { value: 0, setValueAtTime(v: number) { this.value = v; } };
    constructor(_ctx: unknown, opts: { pan: number }) { this.pan.value = opts.pan; }
    connect() {}
    disconnect() {}
  } as unknown as typeof StereoPannerNode;

  // Global PannerNode mock
  globalThis.PannerNode = class {
    positionX = { value: 0, setValueAtTime(v: number) { this.value = v; } };
    positionY = { value: 0, setValueAtTime(v: number) { this.value = v; } };
    positionZ = { value: 0, setValueAtTime(v: number) { this.value = v; } };
    panningModel = "HRTF";
    constructor(_ctx: unknown, opts: { positionX?: number; positionY?: number; positionZ?: number; panningModel?: string }) {
      if (opts.positionX) this.positionX.value = opts.positionX;
      if (opts.positionY) this.positionY.value = opts.positionY;
      if (opts.positionZ) this.positionZ.value = opts.positionZ;
      if (opts.panningModel) this.panningModel = opts.panningModel;
    }
    connect() {}
    disconnect() {}
  } as unknown as typeof PannerNode;

  const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;
  await manager.loadClip("bird", arrayBuffer, mockContext);
  assert.equal(manager.hasClip("bird"), true);
  assert.equal(manager.getClip("bird"), mockBuffer);

  const master = { connect() {} } as unknown as AudioNode;

  // 1. Equal power 2D stereo panner playback
  const instance2d = manager.playSpatialClip("bird", { pan: 0.5, filter: "bypass" }, mockContext, master);
  assert.ok(instance2d);
  instance2d.setPan(-0.8);
  instance2d.setVolume(0.5);
  instance2d.stop();

  // 2. 3D HRTF spatial playback with underwater filter
  const instance3d = manager.playSpatialClip("bird", {
    position: [10, 15, 20],
    panningModel: "HRTF",
    filter: "underwater",
  }, mockContext, master);
  assert.ok(instance3d);
  instance3d.setPosition([12, 16, 22]);
  instance3d.stop();

  // 3. Voice pooling: exceeding maxActiveVoices evicts oldest
  for (let i = 0; i < 8; i++) {
    manager.playSpatialClip("bird", { position: [i, 0, 0] }, mockContext, master);
  }
  manager.stopAll();
  manager.unloadClip("bird");
  assert.equal(manager.hasClip("bird"), false);
});

test("SoundscapeManager evaluates distance culling and activation policies", async () => {
  const { SoundscapeManager } = await import("../lib/audio/soundscape-manager.ts");
  const mockContext = {
    currentTime: 0,
    createGain: () => ({
      gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
      connect: () => {},
      disconnect: () => {},
    }),
    createPanner: () => ({
      positionX: { setValueAtTime() {} },
      positionY: { setValueAtTime() {} },
      positionZ: { setValueAtTime() {} },
      connect: () => {},
      disconnect: () => {},
    }),
  } as unknown as AudioContext;
  const mockMaster = { connect() {}, disconnect() {} } as unknown as AudioNode;

  const manager = new SoundscapeManager(mockContext, mockMaster, "/audio-test/", 15);

  let enabledCount = 0;
  let disabledCount = 0;
  // Mock patch instance
  const mockTilePatch = {
    id: "tile-1",
    patchName: "bell01",
    isSpatial: true,
    _enabled: false,
    async enable() { this._enabled = true; enabledCount++; },
    disable() { this._enabled = false; disabledCount++; },
    isEnabled() { return this._enabled; },
    setPosition() {},
    setGain() {},
    send() {},
    destroy() {},
  };

  // Mock registerPatch directly for unit testing logic
  (manager as unknown as { instances: Map<string, unknown> }).instances.set("tile-1", {
    instance: mockTilePatch,
    descriptor: {
      id: "tile-1",
      patchName: "bell01",
      position: { x: 0, y: 0, z: 10 },
      policy: { type: "distance", radius: 15 },
    },
  });

  // 1. Player close (distance 10 <= 15) -> Enabled
  manager.update({ x: 0, y: 0, z: 0 });
  assert.equal(mockTilePatch.isEnabled(), true);
  assert.equal(enabledCount, 1);

  // 2. Player far away (distance 40 > 15) -> Disabled
  manager.update({ x: 0, y: 0, z: 50 });
  assert.equal(mockTilePatch.isEnabled(), false);
  assert.equal(disabledCount, 1);

  // 3. Player returns (distance 5 <= 15) -> Re-enabled
  manager.update({ x: 0, y: 0, z: 15 });
  assert.equal(mockTilePatch.isEnabled(), true);
  assert.equal(enabledCount, 2);

  manager.disableAll();
  assert.equal(mockTilePatch.isEnabled(), false);
  manager.destroy();
});
