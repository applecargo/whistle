import test from "node:test";
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
    rms(ms) {
      let sum = 0;
      const blocks = ms * rate / (1000 * size);
      for (let b = 0; b < blocks; b++) {
        engine.dspLoop([], output);
        for (const value of output[0]) sum += value * value;
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
