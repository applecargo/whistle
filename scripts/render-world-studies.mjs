import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "../node_modules/webpd/dist/node_modules/@webpd/compiler/dist/src/engine-assemblyscript/run/index.js";
import { readMetadata } from "../node_modules/webpd/dist/node_modules/@webpd/compiler/dist/src/run/index.js";
import { createSoundscapeWorld, waterConnectivity } from "../lib/audio/world-resonance.ts";
import { deriveEnvironment } from "../lib/environment.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(process.argv[2] ?? join(root, "output/world-studies"));
const rate = 48000, block = 96, segmentMs = 10500;
const score = Array.from({ length: 5 }, (_, bar) => [0, 220, 760].map(offset => 200 + bar * 2100 + offset)).flat();

function renderEngine(wasm, metadata) {
  const ports = Object.entries(metadata.settings.io.messageReceivers).map(([id, [port]]) =>
    [metadata.customMetadata.graph[id].args.busName, { id, port }]);
  const inputs = Object.fromEntries(ports);
  return async (model, layout, notes = score, duration = segmentMs) => {
    const engine = await createEngine(wasm);
    engine.initialize(rate, block);
    const send = (name, values) => {
      const { id, port } = inputs[name];
      engine.io.messageReceivers[id][port](values);
    };
    const env = deriveEnvironment(createSoundscapeWorld(layout));
    const waterTiles = env.ponds.reduce((n, pond) => n + pond.cells.length, 0);
    assert.equal(waterTiles, 6);
    send("study-layout", [waterConnectivity(env)]);
    send("study-model", [model]);
    send("study-start", ["bang"]);
    const dry = new Float32Array(duration * rate / 1000), wet = new Float32Array(dry.length);
    const outputs = [new Float32Array(block), new Float32Array(block)];
    const beats = new Set(notes);
    for (let frame = 0; frame < dry.length; frame += block) {
      if (beats.has(frame * 1000 / rate)) send("study-knock", ["bang"]);
      engine.dspLoop([], outputs);
      dry.set(outputs[0], frame);
      wet.set(outputs[1], frame);
    }
    return { dry, wet };
  };
}

function rms(samples, fromMs, toMs) {
  const band = samples.subarray(fromMs * rate / 1000, toMs * rate / 1000);
  return Math.sqrt(band.reduce((sum, x) => sum + x * x, 0) / band.length);
}

function onsets(samples) {
  const times = [];
  let active = false;
  for (let ms = 0; ms < segmentMs; ms += 10) {
    const sounding = rms(samples, ms, ms + 10) > .015;
    if (sounding && !active) times.push(ms);
    active = sounding;
  }
  return times;
}

function ringTime(samples) {
  const levels = [];
  for (let ms = 0; ms < 1800; ms += 20) levels.push(rms(samples, ms, ms + 20));
  const peak = Math.max(...levels);
  assert.ok(peak > .001);
  return (levels.findLastIndex(level => level >= peak / 10) + 1) * 20;
}

async function exportPair(name, takes) {
  const gap = rate * .7, frames = takes[0].dry.length;
  const mix = new Float32Array(frames * 2 + gap);
  takes.forEach(({ dry, wet }, take) => {
    for (let i = 0; i < frames; i++) {
      const fade = Math.min(1, (frames - 1 - i) / (rate * .18));
      mix[take * (frames + gap) + i] = (dry[i] + wet[i]) * fade;
    }
  });
  const input = Buffer.from(mix.buffer);
  const format = ["-hide_banner", "-nostats", "-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", "pipe:0"];
  const meter = spawnSync("ffmpeg", [...format, "-af", "ebur128=peak=true", "-f", "null", "-"], { input, encoding: "utf8" });
  if (meter.status !== 0) throw meter.error ?? new Error(meter.stderr);
  const summary = meter.stderr.split("Summary:").at(-1);
  const loudness = Number(summary.match(/I:\s+([-\d.]+) LUFS/)[1]);
  const peak = Number(summary.match(/Peak:\s+([-\d.]+) dBFS/)[1]);
  const gain = Math.min(-24 - loudness, -1.5 - peak);
  assert.ok(Number.isFinite(gain));
  const target = join(destination, name + ".mp3");
  execFileSync("ffmpeg", [...format, "-loglevel", "error", "-af", "volume=" + gain + "dB", "-c:a", "libmp3lame", "-b:a", "192k", "-y", target], { input });
  console.log(name, { estimatedLUFS: (loudness + gain).toFixed(1), peakDB: (peak + gain).toFixed(1) });
}

const temporary = await mkdtemp(join(tmpdir(), "whistle-world-studies-"));
try {
  const filename = join(temporary, "study.wasm");
  execFileSync(process.execPath, [join(root, "node_modules/webpd/bin/cli.mjs"), "-i", join(root, "audio/patches/world-listening-study.pd"), "-o", filename]);
  const wasm = await readFile(filename);
  const render = renderEngine(wasm, await readMetadata("assemblyscript", wasm));
  await mkdir(destination, { recursive: true });
  let reference;
  for (const [index, name] of ["phase", "openings", "resonance"].entries()) {
    const model = index + 1;
    const takes = [];
    for (const layout of ["connected", "scattered"]) takes.push(await render(model, layout));
    reference ??= takes[0].dry;
    for (const { dry, wet } of takes) {
      assert.ok(dry.every((value, i) => value === reference[i]), "grass score changed");
      assert.ok(wet.every(Number.isFinite) && rms(wet, 0, segmentMs) > .001);
    }
    if (model === 1) {
      const periods = takes.map(({ wet }) => { const hits = onsets(wet); return hits[3] - hits[0]; });
      assert.deepEqual(periods, [2080, 1840]);
      const independent = await render(model, "connected", []);
      assert.deepEqual(onsets(independent.wet), onsets(takes[0].wet));
      console.log("Water phrase periods (ms)", periods);
    } else if (model === 2) {
      const starts = takes.map(({ wet }) => onsets(wet)[0]);
      assert.ok(starts[0] < 950 && starts[1] > 1800);
      const interrupted = await render(model, "connected", [0, 1000], 1600);
      const uninterrupted = await render(model, "connected", [0], 1600);
      assert.ok(rms(interrupted.wet, 1080, 1200) < .001);
      assert.ok(rms(uninterrupted.wet, 1080, 1200) > .06);
      console.log("First audible opening (ms)", starts);
    } else {
      const silent = await render(model, "connected", [], 1800);
      assert.equal(rms(silent.wet, 0, 1800), 0);
      const decay = [];
      for (const layout of ["connected", "scattered"]) {
        const hit = await render(model, layout, [0], 1800);
        decay.push(ringTime(hit.wet));
      }
      assert.ok(decay[0] > 2 * decay[1]);
      console.log("Single knock, wet tail to -20 dB (ms)", decay);
    }
    await exportPair(name, takes);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
