import { expect, test } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import { pdProbe, probePd } from "./pd-probe";

if (process.platform === "darwin") {
  test.use({ channel: "chromium", launchOptions: { args: ["--use-angle=metal"] } });
}

test("pd4web renders the grass attack and ring breath at opposite positions", async ({ page }) => {
  await probePd(page);
  await page.goto("uwb-lab/index.html");
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("오디오 실행 중");
  const index = (await pdProbe(page)).starts.indexOf("world-audio");
  expect(index).toBeGreaterThanOrEqual(0);
  const readings = await page.evaluate(async index => {
    const { Pd4Web, Pd4WebAudioWorkletNode: node } = window as unknown as {
      Pd4Web: { sendList(name: string, values: number[]): boolean }; Pd4WebAudioWorkletNode: AudioWorkletNode;
    };
    const context = node.context as AudioContext;
    const split = context.createChannelSplitter(32), stereo = context.createChannelMerger(2);
    node.connect(split);
    split.connect(stereo, index * 2, 0);
    split.connect(stereo, index * 2 + 1, 1);
    const meter = context.createScriptProcessor(512, 2, 1);
    stereo.connect(meter).connect(context.destination);
    const send = (bus: string, ...values: number[]) => Pd4Web.sendList(`slot${index}-whistle-resonance${bus}`, values);
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    async function measure(pan: number, area: number, path: number, rock = 0) {
      send("-control", 0);
      await sleep(700);
      send("", 1, 1, 1, rock, path, area, pan, 1, -pan);
      await sleep(80);
      const left: number[] = [], right: number[] = [];
      meter.onaudioprocess = ({ inputBuffer }) => {
        left.push(...inputBuffer.getChannelData(0));
        right.push(...inputBuffer.getChannelData(1));
      };
      send("-control", 2);
      while (left.length < context.sampleRate * 0.85) await sleep(25);
      meter.onaudioprocess = null;
      const onset = left.findIndex((v, i) => Math.max(Math.abs(v), Math.abs(right[i])) > 0.001);
      const rms = (channel: number[], from: number, to: number) => {
        const samples = channel.slice(onset + Math.round(context.sampleRate * from), onset + Math.round(context.sampleRate * to));
        return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
      };
      return { onset, attack: [rms(left, 0, .005), rms(right, 0, .005)],
        breath: [rms(left, .35, .52), rms(right, .35, .52)], tail: rms(left, .07, .15),
        echo: rms(left, .421, .464) };
    }
    const result = [];
    try {
      for (const pan of [-1, 1]) result.push(await measure(pan, 1, 3));
      result.push(await measure(-1, 0, 0), await measure(-1, 0, 8), await measure(-1, 0, 0, 1));
      return result;
    } finally {
      meter.disconnect(); stereo.disconnect(); node.disconnect(split); split.disconnect();
    }
  }, index);
  for (const [i, { attack, breath, onset }] of readings.slice(0, 2).entries()) {
    expect(onset).toBeGreaterThanOrEqual(0);
    expect(attack[i]).toBeGreaterThan(3 * attack[1 - i]);
    expect(breath[1 - i]).toBeGreaterThan(.005);
    expect(breath[1 - i]).toBeGreaterThan(1.5 * breath[i]);
  }
  const [cut, open, damped] = readings.slice(2);
  expect(open.echo).toBeGreaterThan(cut.echo + .001);
  expect(cut.tail).toBeGreaterThan(damped.tail * 2);
});

test("game and virtual UWB send the same grass and ring positions to Pd", async ({ page }) => {
  const world = terrainFixtures().flat;
  world.start = { x: 4, z: 5 };
  const tile = (x: number, z: number) => world.terrain!.tiles[z * world.size + x];
  tile(2, 5).surface = "soft";
  for (const x of [3, 4, 5, 7]) tile(x, 5).surface = "slick";
  for (const z of [4, 6]) for (const x of [5, 6, 7]) tile(x, z).surface = "slick";
  await page.addInitScript(world => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await probePd(page);
  const values = () => page.evaluate(() => (window as unknown as { pdWorldValues?: number[] }).pdWorldValues);
  await page.goto(".");
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect.poll(async () => (await values())?.slice(4, 7)).toEqual([3, 1, -1]);
  const game = (await values())!;
  expect(game[8]).toBe(1);
  await page.goto("uwb-lab/index.html");
  await page.getByRole("button", { name: "Whistle 3D", exact: true }).click();
  await page.getByLabel("관객 X (m)", { exact: true }).fill("2.25");
  await page.getByLabel("관객 Z (m)", { exact: true }).fill("2.75");
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect.poll(values).toEqual(game);
});
