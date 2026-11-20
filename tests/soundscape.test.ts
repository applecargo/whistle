import assert from "node:assert/strict";
import { test } from "node:test";
import { createSoundscape, type SoundscapeEvent } from "../lib/audio/soundscape.ts";

// --- 최소한의 가짜 Web Audio: 램프를 시간에 따라 실제처럼 보간한다 ---
class FakeParam {
  events: { time: number; value: number; ramp: boolean }[] = [];
  clock: { currentTime: number };
  initial: number;
  constructor(clock: { currentTime: number }, initial = 0) { this.clock = clock; this.initial = initial; }
  get value() {
    const now = this.clock.currentTime;
    let value = this.initial, time = 0;
    for (const event of this.events) {
      if (event.time <= now) { value = event.value; time = event.time; continue; }
      if (event.ramp) return value + (event.value - value) * (now - time) / (event.time - time);
      break;
    }
    return value;
  }
  set value(v: number) { this.initial = v; this.events = []; }
  cancelScheduledValues(time: number) { this.events = this.events.filter(e => e.time < time); }
  setValueAtTime(value: number, time: number) { this.events.push({ time, value, ramp: false }); }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ time, value, ramp: true }); }
}
class FakeNode {
  outputs: FakeNode[] = [];
  disconnected = false;
  connect(node: FakeNode) { this.outputs.push(node); return node; }
  disconnect() { this.disconnected = true; this.outputs = []; }
}
function fakeContext() {
  const clock = { currentTime: 0 };
  const param = (v = 0) => new FakeParam(clock, v);
  type FakePanner = FakeNode & { positionX: FakeParam; positionY: FakeParam; positionZ: FakeParam; panningModel?: string };
  const created = { gains: [] as (FakeNode & { gain: FakeParam })[], panners: [] as FakePanner[] };
  const listener = Object.fromEntries(
    ["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"].map(k => [k, param()]),
  );
  const context = {
    get currentTime() { return clock.currentTime; },
    destination: new FakeNode(),
    listener,
    createGain() {
      const node = Object.assign(new FakeNode(), { gain: param(1) });
      created.gains.push(node);
      return node;
    },
    createPanner() {
      const node = Object.assign(new FakeNode(), { positionX: param(), positionY: param(), positionZ: param() });
      created.panners.push(node);
      return node;
    },
  };
  return { context: context as unknown as BaseAudioContext, clock, created, listener };
}
function fakePatches() {
  const started: { name: string; node: FakeNode; destroyed: boolean; resolve: () => void; reject: (e: Error) => void }[] = [];
  const start = (_context: BaseAudioContext, name: string) => new Promise<{ node: AudioNode; destroy(): void }>((resolve, reject) => {
    const entry = {
      name, node: new FakeNode(), destroyed: false,
      resolve: () => resolve({ node: entry.node as unknown as AudioNode, destroy: () => { entry.destroyed = true; } }),
      reject,
    };
    started.push(entry);
  });
  return { start, started };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const origin = { x: 0, y: 0, z: 0 };

function setup(fade = 0.5) {
  const audio = fakeContext();
  const patches = fakePatches();
  const events: SoundscapeEvent[] = [];
  const scape = createSoundscape({ context: audio.context, start: patches.start, fade, onEvent: e => events.push(e) });
  return { ...audio, ...patches, events, scape, types: () => events.map(e => `${e.type}:${e.id}`) };
}

test("등록만으로는 패치를 로드하지 않는다", () => {
  const { scape, started } = setup();
  scape.set({ id: "a", patch: "terrain_clock", position: origin });
  assert.equal(started.length, 0);
  assert.deepEqual(scape.snapshot(), { sources: 1, voices: [] });
});

test("activate: 패치 → 게인 → 패너 → 마스터로 연결하고 위치를 적용한 뒤 fade in", async () => {
  const { scape, started, created, clock } = setup(0.5);
  scape.set({ id: "a", patch: "terrain_clock", position: { x: 3, y: 1, z: -4 } });
  scape.activate("a");
  scape.activate("a"); // 로딩 중 중복 호출은 무시
  assert.equal(started.length, 1);
  started[0].resolve();
  await flush();
  const [master, gain] = created.gains;
  const [panner] = created.panners;
  assert.deepEqual(started[0].node.outputs, [gain]);
  assert.deepEqual(gain.outputs, [panner]);
  assert.deepEqual(panner.outputs, [master]);
  assert.equal(panner.panningModel, "equalpower", "기본값");
  assert.deepEqual([(panner.positionX as FakeParam).value, (panner.positionY as FakeParam).value, (panner.positionZ as FakeParam).value], [3, 1, -4]);
  assert.equal(gain.gain.value, 0);
  clock.currentTime = 0.25;
  assert.equal(gain.gain.value, 0.5, "fade 중간");
  clock.currentTime = 1;
  assert.equal(gain.gain.value, 1);
  assert.deepEqual(scape.snapshot().voices, [{ id: "a", patch: "terrain_clock", state: "active" }]);
});

test("deactivate: fade out 후 update()에서 오디오 시계 기준으로 정리한다", async () => {
  const { scape, started, created, clock, types } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  clock.currentTime = 1;
  scape.deactivate("a");
  const gain = created.gains[1];
  clock.currentTime = 1.25;
  assert.equal(gain.gain.value, 0.5);
  scape.update();
  assert.equal(started[0].destroyed, false, "fade 중에는 정리하지 않음");
  clock.currentTime = 1.5;
  scape.update();
  assert.equal(started[0].destroyed, true);
  assert.equal(gain.disconnected, true);
  assert.deepEqual(scape.snapshot().voices, []);
  assert.deepEqual(types(), ["loading:a", "active:a", "releasing:a", "released:a"]);
});

test("fade out 중에 다시 켜면 같은 노드로 현재 값에서 다시 올린다", async () => {
  const { scape, started, created, clock } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  clock.currentTime = 1;
  scape.deactivate("a");
  clock.currentTime = 1.25; // 0.5까지 내려옴
  scape.activate("a");
  const gain = created.gains[1];
  assert.equal(gain.gain.value, 0.5, "튀지 않고 현재 값에서 시작");
  clock.currentTime = 1.75;
  assert.equal(gain.gain.value, 1);
  scape.update();
  assert.equal(started.length, 1, "새로 로드하지 않음");
  assert.equal(started[0].destroyed, false);
});

test("로딩 중에 끄면 로드가 끝나는 즉시 정리하고 연결하지 않는다", async () => {
  const { scape, started, created } = setup();
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  scape.deactivate("a");
  started[0].resolve();
  await flush();
  assert.equal(started[0].destroyed, true);
  assert.equal(created.gains.length, 1, "마스터 외에 게인을 만들지 않음");
  assert.deepEqual(scape.snapshot().voices, []);
});

test("로딩 중에 껐다가 다시 켜면 한 번만 로드해서 켠다", async () => {
  const { scape, started } = setup();
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  scape.deactivate("a");
  scape.activate("a");
  started[0].resolve();
  await flush();
  assert.equal(started.length, 1);
  assert.equal(started[0].destroyed, false);
  assert.deepEqual(scape.snapshot().voices, [{ id: "a", patch: "p", state: "active" }]);
});

test("로드 실패는 error 이벤트로 알리고 다음 activate에서 다시 시도한다", async () => {
  const { scape, started, types } = setup();
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].reject(new Error("fetch failed"));
  await flush();
  assert.deepEqual(scape.snapshot().voices, []);
  scape.activate("a");
  assert.equal(started.length, 2);
  assert.deepEqual(types(), ["loading:a", "error:a", "loading:a"]);
});

test("set: 위치는 바로 반영하고, 패치가 바뀌면 끄고 다음 activate에서 새 패치를 로드한다", async () => {
  const { scape, started, created, clock } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  scape.set({ id: "a", patch: "p", position: { x: 5, y: 0, z: 0 } });
  assert.equal((created.panners[0].positionX as FakeParam).value, 5);
  scape.set({ id: "a", patch: "q", position: origin });
  assert.equal(scape.snapshot().voices[0].state, "releasing");
  scape.activate("a");
  assert.equal(started[0].destroyed, true, "이전 패치 정리");
  assert.equal(started[1].name, "q");
  clock.currentTime = 1;
});

test("리스너 위치·방향을 설정한다", () => {
  const { scape, listener } = setup();
  scape.setListener({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -1 });
  const values = Object.fromEntries(Object.entries(listener).map(([k, p]) => [k, (p as FakeParam).value]));
  assert.deepEqual(values, { positionX: 1, positionY: 2, positionZ: 3, forwardX: 0, forwardY: 0, forwardZ: -1, upX: 0, upY: 1, upZ: 0 });
});

test("dispose: 모든 패치를 정리하고 로딩 중인 것도 끝나면 정리한다", async () => {
  const { scape, started, created } = setup();
  scape.set({ id: "a", patch: "p", position: origin });
  scape.set({ id: "b", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  scape.activate("b");
  scape.dispose();
  assert.equal(started[0].destroyed, true);
  started[1].resolve();
  await flush();
  assert.equal(started[1].destroyed, true);
  assert.equal(created.gains[0].disconnected, true, "마스터 연결 해제");
  scape.activate("a");
  assert.equal(started.length, 2, "dispose 후에는 아무것도 하지 않음");
});

test("등록되지 않은 소스를 켜면 오류", () => {
  const { scape } = setup();
  assert.throws(() => scape.activate("missing"), /등록되지 않은/);
});

test("Firefox: AudioParam이 없는 리스너·패너는 setPosition/setOrientation으로 설정한다", async () => {
  const calls: string[] = [];
  const clock = { currentTime: 0 };
  const context = {
    get currentTime() { return clock.currentTime; },
    destination: new FakeNode(),
    listener: {
      setPosition: (...a: number[]) => calls.push(`listener.setPosition ${a.join(",")}`),
      setOrientation: (...a: number[]) => calls.push(`listener.setOrientation ${a.join(",")}`),
    },
    createGain: () => Object.assign(new FakeNode(), { gain: new FakeParam(clock, 1) }),
    createPanner: () => Object.assign(new FakeNode(), {
      setPosition: (...a: number[]) => calls.push(`panner.setPosition ${a.join(",")}`),
    }),
  } as unknown as BaseAudioContext;
  const { start, started } = fakePatches();
  const scape = createSoundscape({ context, start });
  scape.setListener({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -1 });
  scape.set({ id: "a", patch: "p", position: { x: -6, y: 0, z: 0 } });
  scape.activate("a");
  started[0].resolve();
  await flush();
  scape.set({ id: "a", patch: "p", position: { x: 4, y: 1, z: 2 } });
  assert.deepEqual(calls, [
    "listener.setPosition 1,2,3",
    "listener.setOrientation 0,0,-1,0,1,0",
    "panner.setPosition -6,0,0",
    "panner.setPosition 4,1,2",
  ]);
  assert.equal(scape.snapshot().voices[0].state, "active");
});
