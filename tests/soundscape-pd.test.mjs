import test from "node:test";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEngine } from "../node_modules/webpd/dist/node_modules/@webpd/compiler/dist/src/engine-assemblyscript/run/index.js";
import { comparisonRoute, createSoundscapeWorld, habitatAt, listeningZone, locatePhraseSources, phraseMix, phraseRoute, resonanceAt, resonanceListeningPoint, routeIntervalMs, visitRoute } from "../lib/audio/soundscape.ts";
import { deriveEnvironment } from "../lib/environment.ts";

async function renderer() {
  const wasm = await readFile(new URL("../public/audio-test/patch.wasm", import.meta.url));
  const io = JSON.parse(await readFile(new URL("../public/audio-test/io.json", import.meta.url)));
  const engine = await createEngine(wasm);
  const rate = 48000, size = 96;
  engine.initialize(rate, size);
  const output = [new Float32Array(size), new Float32Array(size)];
  return {
    send(bus, ...values) {
      const { nodeId, portletId } = io.inputs[bus];
      engine.io.messageReceivers[nodeId][portletId](values);
    },
    rms(ms, channel = 0) {
      let sum = 0;
      const blocks = ms * rate / (1000 * size);
      for (let b = 0; b < blocks; b++) {
        engine.dspLoop([], output);
        for (const value of output[channel]) sum += value * value;
      }
      return Math.sqrt(sum / (blocks * size));
    },
  };
}

test("a stationary habitat generates multiple pulses without contact and stops on tracking loss", async () => {
  const pd = await renderer();
  pd.send("whistle-gate", 1);
  pd.send("whistle-habitat", 1, 0, 0);
  assert.ok(pd.rms(1000) < .0001);
  pd.send("whistle-habitat-run", 1);
  const windows = Array.from({length: 20}, () => pd.rms(100));
  assert.ok(windows.filter(level => level > .005).length >= 8);
  pd.send("whistle-habitat-run", 0);
  pd.rms(500);
  assert.ok(pd.rms(1000) < .0001);
  pd.send("whistle-habitat", 0, 0, 0);
  pd.send("whistle-habitat-run", 1);
  pd.rms(100);
  assert.ok(pd.rms(1000) < .0001);
});

test("connected water sustains resonance between pulses along the same route", async () => {
  async function render(layout) {
    const pd = await renderer(), env = deriveEnvironment(createSoundscapeWorld(layout));
    const levels = [];
    pd.send("whistle-gate", 1);
    for (const point of comparisonRoute()) {
      const { grass, water, extent } = habitatAt(env, point);
      pd.send("whistle-habitat", grass, water, extent);
      if (!levels.length) pd.send("whistle-habitat-run", 1);
      levels.push(pd.rms(routeIntervalMs));
    }
    return levels;
  }
  const connected = await render("connected"), scattered = await render("scattered");
  const wetHold = levels => levels.slice(-30);
  assert.ok(Math.min(...wetHold(connected)) > .012);
  assert.ok(wetHold(scattered).filter(level => level < .0001).length >= 12);
  assert.ok(Math.max(...wetHold(scattered)) > .01);
});

test("Pd passes all three grass onsets to water, even when the listener stays in the meadow", async () => {
  const sources = locatePhraseSources(deriveEnvironment(createSoundscapeWorld()));
  async function listen(kind) {
    const pd = await renderer(), levels = [];
    pd.send("whistle-gate", 1);
    for (const [tick, point] of phraseRoute(kind).entries()) {
      const mix = phraseMix(sources, point);
      pd.send("whistle-phrase-space", mix.grass, mix.water, sources.travelMs);
      if (tick === 0) pd.send("whistle-phrase-run", 1);
      for (let ms = 0; ms < routeIntervalMs; ms += 10) levels.push(pd.rms(10));
    }
    return levels;
  }
  const stay = await listen("stay"), follow = await listen("follow");
  const peak = (levels, ms, span) => Math.max(...levels.slice(Math.floor(ms / 10), Math.ceil((ms + span) / 10)));
  assert.ok(peak(stay, 10, 225) < .0001);
  for (const onset of [250, 470, 1010]) {
    assert.ok(peak(stay, onset - 30, 20) < .003);
    assert.ok(peak(stay, onset, 30) > .02);
    assert.ok(Math.abs(peak(stay, onset, 30) - peak(follow, onset, 30)) < .0001);
    const arrival = onset + sources.travelMs;
    const distant = peak(stay, arrival + 10, 30), near = peak(follow, arrival + 10, 30);
    assert.ok(distant > .015 && near > distant * 3);
    assert.ok(peak(stay, arrival - 35, 20) < distant * .6);
  }
  assert.ok(peak(follow, 1300, sources.travelMs - 1300) < .001);
});

test("stopping the phrase cancels in-flight replies before restart", async () => {
  const pd = await renderer();
  pd.send("whistle-gate", 1);
  pd.send("whistle-phrase-space", 0, 1, 2200);
  pd.send("whistle-phrase-run", 1);
  pd.rms(1400);
  pd.send("whistle-phrase-run", 0);
  pd.rms(100);
  pd.send("whistle-phrase-run", 1);
  assert.ok(pd.rms(2000) < .0001);
  assert.ok(pd.rms(1200) > .01);
});

test("the same pond plays one or three notes, then two fading phrases after departure", async () => {
  const sources = locatePhraseSources(deriveEnvironment(createSoundscapeWorld()));
  for (const kind of ["pass", "listen"]) {
    const pd = await renderer(), levels = [];
    pd.send("whistle-gate", 1);
    let zone, arrival;
    for (const [tick, point] of visitRoute(kind).entries()) {
      const mix = phraseMix(sources, point);
      const next = listeningZone(sources, point, zone);
      if (next !== zone) {
        pd.send("whistle-phrase-zone", { away: 0, grass: 1, bank: 2 }[next]);
        if (next === "bank") arrival = tick * routeIntervalMs;
        zone = next;
      }
      pd.send("whistle-phrase-space", mix.grass, mix.water, sources.travelMs);
      if (!tick) pd.send("whistle-phrase-run", 1);
      for (let ms = 0; ms < routeIntervalMs; ms += 10) levels.push(pd.rms(10));
    }
    const peak = ms => Math.max(...levels.slice(ms / 10, ms / 10 + 3));
    const peaks = [];
    for (const age of [0, 3000, 6000]) {
      const first = peak(arrival + age + 10);
      peaks.push(first);
      assert.ok(first > .007, kind + " reply at " + age);
      // The initial 360 ms decay overlaps the second onset.
      const second = peak(arrival + age + 240);
      const third = peak(arrival + age + 780);
      assert.ok(kind === "pass" ? second < first * .55 : second > first * .8);
      assert.ok(kind === "pass" ? third < .001 : third > first * .8);
    }
    assert.ok(peaks[0] > peaks[1] && peaks[1] > peaks[2]);
    assert.ok(Math.max(...levels.slice((arrival + 9000) / 10)) < .0001);
  }
});

test("bank entry alone and a restarted session cannot replay a previous visit", async () => {
  const pd = await renderer();
  pd.send("whistle-gate", 1);
  pd.send("whistle-phrase-space", 0, 1, 3000);
  pd.send("whistle-phrase-zone", 2);
  pd.send("whistle-phrase-run", 1);
  assert.ok(pd.rms(4300) < .0001);
  pd.send("whistle-phrase-zone", 1);
  pd.send("whistle-phrase-zone", 2);
  assert.ok(pd.rms(100) > .02);
  pd.send("whistle-phrase-run", 0);
  pd.rms(500);
  pd.send("whistle-phrase-zone", 2);
  pd.send("whistle-phrase-run", 1);
  assert.ok(pd.rms(4500) < .0001);
});

test("arriving in grass mid-phrase earns one note, and staying at the bank sustains it", async () => {
  const pd = await renderer();
  pd.send("whistle-gate", 1);
  pd.send("whistle-phrase-space", 0, 1, 3000);
  pd.send("whistle-phrase-zone", 0);
  pd.send("whistle-phrase-run", 1);
  pd.rms(600);
  pd.send("whistle-phrase-zone", 1);
  pd.rms(600);
  pd.send("whistle-phrase-zone", 2);
  for (let phrase = 0; phrase < 4; phrase++) {
    assert.ok(pd.rms(100) > .04);
    pd.rms(350);
    assert.ok(pd.rms(2550) < .0001);
  }
});

test("live resonance at a fixed listener keeps the dry attack and changes the decay", async () => {
  const attacks = [], tails = [];
  for (const layout of ["connected", "scattered"]) {
    const env = deriveEnvironment(createSoundscapeWorld(layout));
    const { grass, water, extent } = resonanceAt(env, resonanceListeningPoint);
    const pd = await renderer();
    pd.send("whistle-resonance", grass, water, extent);
    assert.equal(pd.rms(400), 0);
    pd.send("whistle-gate", 1);
    pd.send("whistle-resonance-control", 1);
    pd.rms(200);
    attacks.push(pd.rms(4));
    pd.rms(1250);
    tails.push(pd.rms(300));
    pd.send("whistle-resonance-control", 0);
    pd.rms(30);
    assert.ok(pd.rms(2300) < .00001);
  }
  assert.ok(attacks[0] > .001 && Math.abs(attacks[0] - attacks[1]) < .00001);
  assert.ok(tails[0] > .005 && tails[1] < .0001);
});

test("one grid edit auditions one strike and leaves the play clock stopped", async () => {
  const pd = await renderer();
  pd.send("whistle-gate", 1);
  pd.send("whistle-resonance", 1, 0, 0);
  pd.send("whistle-resonance-control", 2);
  assert.ok(pd.rms(70) > .001);
  assert.ok(pd.rms(2500) < .00001);
  pd.send("whistle-resonance-control", 2);
  pd.send("whistle-resonance-control", 0);
  assert.ok(pd.rms(300) < .00001);
});

test("placing and removing a shoreline rock changes the decay of the same grass strike", async (t) => {
  const pd = await renderer();
  const world = createSoundscapeWorld();
  pd.send("whistle-gate", 1);
  pd.rms(2000);
  function strike(surface) {
    world.terrain.tiles[2 * world.size + 5].surface = surface;
    const mix = resonanceAt(deriveEnvironment(world));
    pd.send("whistle-resonance", mix.grass, mix.water, mix.extent, Number(mix.bankRock));
    pd.rms(40);
    pd.send("whistle-resonance-control", 2);
    pd.rms(22);
    const attack = pd.rms(4);
    const levels = Array.from({ length: 100 }, () => pd.rms(20));
    const threshold = Math.max(...levels) / 10;
    pd.send("whistle-resonance-control", 0);
    pd.rms(80);
    return { attack, decayMs: 20 * (1 + levels.findLastIndex(level => level >= threshold)) };
  }
  const before = strike("plain"), damped = strike("rough"), restored = strike("plain");
  t.diagnostic(`Decay to -20 dB (ms): ${before.decayMs} → ${damped.decayMs} → ${restored.decayMs}`);
  assert.ok(before.attack > .001 && Math.abs(damped.attack - before.attack) < .0001);
  assert.ok(damped.decayMs > 0 && before.decayMs > 3 * damped.decayMs);
  assert.ok(Math.abs(restored.decayMs - before.decayMs) <= 20);
});

test("the same strike returns as a breath, a single path echo, or no distant response", async () => {
  async function render(steps, area, interrupt, changeMs = 100) {
    const pd = await renderer();
    pd.send("whistle-gate", 1);
    const space = (length, enclosed) => pd.send("whistle-resonance", 1, 1, 0, 0, length, enclosed);
    space(steps, area);
    pd.rms(50);
    pd.send("whistle-resonance-control", 2);
    return Array.from({ length: 110 }, (_, i) => {
      if (i * 10 === changeMs && interrupt) space(...interrupt);
      return pd.rms(10);
    });
  }
  const closed = await render(3, 1);
  const open = await render(8, 0);
  const cut = await render(0, 0);
  const changedInFlight = await render(3, 1, [8, 0]);
  const peak = (levels, from, to) => Math.max(...levels.slice(from / 10, to / 10));
  assert.ok(Math.abs(closed[2] - open[2]) < .00001 && Math.abs(closed[2] - cut[2]) < .00001);
  assert.deepEqual(closed.slice(0, 23), cut.slice(0, 23));
  assert.ok(Math.min(...closed.slice(32, 60)) > .006);
  assert.ok(peak(open, 410, 440) < .001 && peak(open, 440, 470) > .007);
  assert.ok(peak(open, 520, 1000) < .001);
  assert.ok(peak(cut, 300, 1000) < .001);
  assert.ok(peak(changedInFlight, 300, 1000) < .001);
  const openedWhileBreathing = await render(3, 1, [8, 0], 400);
  assert.ok(peak(openedWhileBreathing, 400, 450) > .01);
  assert.ok(peak(openedWhileBreathing, 590, 1000) < .001);
});

test("stereo output locates the first strike at the grass and its breath at the ring", async () => {
  async function listen(channel, grassPan, breathPan, breathGain = .53) {
    const pd = await renderer();
    pd.send("whistle-gate", 1);
    pd.send("whistle-resonance", .53, .53, 1, 0, 3, 1, grassPan, breathGain, breathPan);
    pd.rms(60);
    pd.send("whistle-resonance-control", 2);
    pd.rms(22);
    const attack = pd.rms(4, channel);
    pd.rms(354);
    return { attack, breath: pd.rms(140, channel) };
  }
  for (const side of [-1, 1]) {
    const grassChannel = side === -1 ? 0 : 1;
    const grass = await listen(grassChannel, side, -side);
    const ring = await listen(1 - grassChannel, side, -side);
    assert.ok(grass.attack > .001 && grass.attack > ring.attack * 3);
    assert.ok(ring.breath > .005 && ring.breath > grass.breath * 1.5);
    const far = await listen(1 - grassChannel, side, -side, .1);
    assert.ok(ring.breath > far.breath * 1.5);
  }
});

test("the browser worklet keeps playing when WASM memory grows between stereo input blocks", async () => {
  const assets = new URL("../public/audio-test/", import.meta.url);
  const runtime = await readFile(new URL("webpd-runtime.js", assets), "utf8");
  const api = runInNewContext(runtime + "\nWebPdRuntime", { AudioWorkletNode: class {}, Blob, URL, fetch });
  let processor, memory;
  await api.initialize({ audioWorklet: { async addModule(url) {
    const script = await (await fetch(url)).text();
    URL.revokeObjectURL(url);
    runInNewContext(script, {
      sampleRate: 48000, AudioWorkletProcessor: class { port = { postMessage() {} }; },
      registerProcessor(_name, Processor) { processor = new Processor(); },
      WebAssembly: { Module: WebAssembly.Module, compile: WebAssembly.compile, async instantiate(...args) {
        const result = await WebAssembly.instantiate(...args);
        memory = result.instance.exports.memory;
        return result;
      } },
    });
  } } });
  await processor.setWasm(await readFile(new URL("patch.wasm", assets)));
  const { inputs } = JSON.parse(await readFile(new URL("io.json", assets), "utf8"));
  const send = (bus, message) => processor.onMessage({ data: {
    type: "io:messageReceiver", payload: { ...inputs[bus], message },
  } });
  const input = [new Float32Array(128), new Float32Array(128)];
  const output = input.map(channel => channel.slice());
  const block = () => processor.process([input], [output]);
  block();
  send("whistle-gate", [1]);
  send("whistle-event", [261.63, .09, 0]);
  memory.grow(1);
  for (let i = 0; i < 20; i++) block();
  for (const channel of output) assert.ok(channel.some(value => Math.abs(value) > .005));
});
