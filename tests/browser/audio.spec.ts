import { probePd, pdProbe } from "./pd-probe";
import { test, expect, type Page } from "@playwright/test";

type Level = { rms: number; hz: number };
const levels = async (page: Page): Promise<Level[]> =>
  JSON.parse((await page.locator("#meter").getAttribute("data-levels"))!);
const received = async (page: Page) => JSON.parse((await page.locator("#messages").textContent())!);

async function start(page: Page) {
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("실행 중");
}

test.beforeEach(async ({ page }) => {
  await page.goto("audio-lab/index.html");
});

test("Pd edit events change the emitted tone and decay back to silence", async ({ page }) => {
  await expect(page.locator("#edit")).toBeDisabled();
  await start(page);
  await expect.poll(async () => (await levels(page))[0].rms).toBeLessThan(0.0001);
  for (const overlap of [0, 1]) {
    await page.locator("#overlap").fill(String(overlap));
    await page.getByRole("button", { name: "배치 소리", exact: true }).click();
    await expect.poll(async () => (await received(page))["whistle-edit"]).toEqual([0.5, 0.5, overlap]);
    await expect.poll(async () => {
      const [left] = await levels(page);
      return left.rms > 0.005 && Math.abs(left.hz - (440 + overlap * 220)) < 16;
    }, { intervals: [10, 20, 20] }).toBe(true);
    await expect.poll(async () => (await levels(page))[0].rms).toBeLessThan(0.0001);
  }
});

test("Pd receives routed player state and the output gain mutes edit sounds", async ({ page }) => {
  await start(page);
  await page.locator("#player-x").fill("1");
  await page.locator("#player-y").fill("2.5");
  await page.locator("#player-z").fill("0.5");
  await page.locator("#grass").fill("1");
  await page.getByRole("button", { name: "이동 상태 보내기", exact: true }).click();
  await expect.poll(async () => (await received(page))["whistle-player position"]).toEqual([1, 2.5, 0.5]);
  expect((await received(page))["whistle-player footed"]).toEqual([1, 0]);
  await page.getByRole("button", { name: "음소거", exact: true }).click();
  await page.waitForTimeout(80);
  await page.locator("#edit").click();
  await expect.poll(async () => (await levels(page)).every(l => l.rms < .0001)).toBe(true);
  await page.getByRole("button", { name: "음소거 해제", exact: true }).click();
  await page.locator("#edit").click();
  await expect.poll(async () => (await levels(page)).some(l => l.rms > .005), { intervals: [10, 20] }).toBe(true);
});

test("audio is lazy, retries a failed download and reuses the engine after stopping", async ({ page }) => {
  await probePd(page);
  await page.addInitScript(() => {
    const state = window as typeof window & { contexts: AudioContext[]; microphoneCalls: number };
    state.contexts = [];
    state.microphoneCalls = 0;
    const Original = AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) { super(options); state.contexts.push(this); }
    };
    navigator.mediaDevices.getUserMedia = async () => { state.microphoneCalls++; throw new Error("Unexpected microphone"); };
  });
  await page.reload();
  const audioState = () => page.evaluate(() => {
    const state = window as typeof window & { contexts: AudioContext[]; microphoneCalls: number };
    return { states: state.contexts.map(c => c.state), microphoneCalls: state.microphoneCalls };
  });
  expect(await audioState()).toEqual({ states: [], microphoneCalls: 0 });
  await page.route("**/audio/patches.tar.gz", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.locator("#start").click();
  await expect(page.locator("#status")).toHaveText("오디오를 시작할 수 없습니다.");
  expect(await audioState()).toEqual({ states: [], microphoneCalls: 0 });
  await page.unroute("**/audio/patches.tar.gz");
  await start(page);
  await page.locator("#stop").click();
  await expect(page.locator("#status")).toHaveText("종료됨");
  await start(page);
  expect(await audioState()).toEqual({ states: ["running"], microphoneCalls: 0 });
  expect((await pdProbe(page)).modules).toBe(1);
  expect((await pdProbe(page)).starts).toEqual(["edit", "player", "event", "edit", "player", "event"]);
});
