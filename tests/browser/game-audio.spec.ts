import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import { atFixedStart } from "./fixed-start";
import { probePd, pdProbe, pdMessages } from "./pd-probe";

test.setTimeout(120_000);
test.use({ viewport: { width: 520, height: 600 }, deviceScaleFactor: 1 });

async function open(page: Page) {
  await page.addInitScript(world => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, atFixedStart(terrainFixtures().flat));
  await probePd(page);
  await page.goto(`?meeting=audio-${Date.now()}`);
  await expect(page.locator("main")).toHaveAttribute("data-meeting-status", "online");
}
const audioState = (page: Page) => page.evaluate(() =>
  (window as unknown as { Pd4WebAudioContext?: AudioContext }).Pd4WebAudioContext?.state);

test("real edits reach the shared Pd engine; no-op and undo stay silent; failed downloads retry", async ({ page }) => {
  await open(page);
  expect((await pdProbe(page)).modules).toBe(0);
  await page.route("**/audio/patches.tar.gz", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="0"]').click();
  await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 1/);
  await expect(page.locator(".toast")).toContainText("오디오를 시작하지 못했어요");
  await page.unroute("**/audio/patches.tar.gz");
  await page.locator('[data-cell="1"]').click();
  await expect.poll(async () => (await pdMessages(page, "whistle-edit")).length).toBe(1);
  expect((await pdMessages(page, "whistle-edit"))[0]).toEqual([1.5 / 12, 0.5 / 12, 0, "terrain", "paint", "plain"]);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  expect((await pdMessages(page, "whistle-edit")).length).toBe(1);
  await page.getByRole("button", { name: "바닥", exact: true }).click();
  await page.locator('[data-cell="1"]').click();
  expect((await pdMessages(page, "whistle-edit")).length).toBe(1);
  expect((await pdProbe(page)).modules).toBe(1);
});

for (const touch of [false, true]) {
  test(`${touch ? "phone touch" : "PC mouse"} joystick moves, turns, stops on release and preserves keyboard controls`, async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ baseURL, locale: "ko-KR", hasTouch: touch,
      isMobile: touch, viewport: touch ? { width: 390, height: 844 } : { width: 720, height: 600 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await open(page);
      await page.getByRole("button", { name: "플레이", exact: true }).click();
      const stick = page.getByRole("group", { name: "이동 조이스틱", exact: true });
      await expect(stick).toBeVisible();
      expect(await page.locator(".play-shell canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.clientWidth)).toBeCloseTo(1, 2);
      const position = async () => (await pdMessages(page, "whistle-player position")).at(-1)! as number[];
      const yaw = async () => Number((await pdMessages(page, "whistle-player yaw")).at(-1)?.[0]);
      await expect.poll(async () => (await position())?.length, { timeout: 30_000 }).toBe(3);
      expect((await pdProbe(page)).starts).toEqual(expect.arrayContaining(["edit", "player", "event"]));
      await expect.poll(async () => (await pdProbe(page)).starts.some(s => s.startsWith("terrain_"))).toBe(true);
      const box = (await stick.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
      const cdp = touch ? await context.newCDPSession(page) : undefined;
      const move = async (dx: number, dy: number, start = false) => {
        if (cdp) await cdp.send("Input.dispatchTouchEvent", { type: start ? "touchStart" : "touchMove", touchPoints: [{ x: x + dx, y: y + dy }] });
        else { await page.mouse.move(x + dx, y + dy); if (start) await page.mouse.down(); }
      };
      const release = async () => {
        if (cdp) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        else await page.mouse.up();
      };
      const before = await position();
      await move(0, -35, true);
      await expect.poll(async () => (await position())[2], { timeout: 15_000 }).toBeLessThan(before[2] - .005);
      await release();
      await expect(page.locator(".stick-knob")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
      await page.waitForTimeout(250);
      const stopped = await position();
      await page.waitForTimeout(400);
      expect((await position())[2]).toBeCloseTo(stopped[2], 4);
      const beforeYaw = await yaw();
      await move(35, 0, true);
      await expect.poll(yaw, { timeout: 15_000 }).toBeGreaterThan(beforeYaw + .1);
      if (touch) await cdp!.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      else { await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await release(); }
      await expect(page.locator(".stick-knob")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
      if (!touch) {
        await expect.poll(() => audioState(page)).toBe("suspended");
        const p = await position();
        await page.keyboard.down("w");
        await expect.poll(async () => Math.hypot(...(await position()).filter((_, i) => i !== 1).map((v, i) => v - p[i * 2])), { timeout: 15_000 }).toBeGreaterThan(.005);
        await page.keyboard.up("w");
        await page.getByRole("button", { name: "기어가기", exact: true }).click();
        await expect.poll(async () => (await pdMessages(page, "whistle-player stat")).at(-1)?.[0]).toBe(1);
      }
      await page.screenshot({ path: info.outputPath(touch ? "joystick-phone.png" : "joystick-pc.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await pdProbe(page)).modules).toBe(1);
      expect(errors).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator(".workspace")).toBeVisible();
    } finally { await context.close(); }
  });
}
