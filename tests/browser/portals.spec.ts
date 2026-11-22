import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import type { World } from "../../lib/world";

test.setTimeout(120_000);

async function member(browser: Browser, world: World, room: string, mobile = false) {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:5189", viewport: { width: 900, height: 650 }, ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
  await context.addInitScript(world => {
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    if (localStorage.getItem("portal-test-seeded")) return;
    localStorage.setItem("whistle.language", "ko");
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("portal-test-seeded", "1");
  }, world);
  const page = await context.newPage();
  await page.goto(`/whistle/?room=${room}`);
  await expect(page.locator("main")).toHaveAttribute("data-portal-status", "online");
  await expect(page.getByRole("button", { name: "파일 저장", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨", { timeout: 15_000 });
  return { context, page };
}
const world = (title: string) => ({ ...terrainFixtures().flat, title, timeOfDay: "noon" as const, start: { x: 0, z: 2 } });
const saved = (page: import("@playwright/test").Page) => page.evaluate(() => localStorage.getItem("whistle.world.v2"));

async function walkIntoPortal(page: import("@playwright/test").Page, title: string) {
  await page.bringToFront();
  await expect(page.locator("[data-map-portal]")).toHaveCount(1);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await page.locator(".play-shell canvas").waitFor();
  await expect(page.locator(".play-shell canvas")).toHaveAttribute("data-ready", "true");
  await page.keyboard.down("KeyW");
  try { await expect(page.locator(".portal-visit-status")).toContainText(title, { timeout: 40_000 }); }
  finally { await page.keyboard.up("KeyW"); }
  await expect(page.locator(".play-return")).toBeEnabled({ timeout: 15_000 });
}

test("separate browsers visit worlds without overwriting local work or crossing room links", async ({ browser }, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const a = await member(browser, world("내 풀밭"), "visit"); contexts.push(a.context);
    const b = await member(browser, world("친구의 물가"), "visit"); contexts.push(b.context);
    const c = await member(browser, world("다른 방"), "isolated"); contexts.push(c.context);
    await expect(a.page.locator("[data-map-portal]")).toHaveCount(1);
    await expect(c.page.locator("[data-map-portal]")).toHaveCount(0);
    await c.context.close();
    await a.page.locator('[data-cell="0"]').click();
    await expect.poll(async () => JSON.parse((await saved(a.page))!).terrain.tiles[0].surface).toBe("soft");
    await expect(a.page.locator("main")).toHaveAttribute("data-visited-world", "");
    const before = await saved(a.page);
    await b.page.getByRole("button", { name: "높이기", exact: true }).click();
    await b.page.locator('[data-cell="60"]').click();
    await expect.poll(async () => JSON.parse((await saved(b.page))!).terrain.tiles[60].height).toBeGreaterThan(0);
    await walkIntoPortal(a.page, "친구의 물가");
    await expect(a.page.locator(".portal-visit-status")).toContainText("친구의 물가");
    await expect(a.page.locator(".play-shell canvas")).toBeVisible();
    expect(await saved(a.page)).toBe(before);
    await a.page.screenshot({ path: testInfo.outputPath("visit.png") });
    await a.page.keyboard.press("Escape");
    await expect(a.page.locator(".portal-visit-status")).toHaveCount(0);
    await expect(a.page.locator("main")).toHaveAttribute("data-visited-world", "");
    await expect(a.page.locator(".play-return")).toBeEnabled();
    await a.page.keyboard.press("Escape");
    await expect(a.page.locator(".workspace")).toBeVisible();
    expect(await saved(a.page)).toBe(before);
    await a.page.screenshot({ path: testInfo.outputPath("portals-editor.png") });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test("walking through 3D portals visits and returns without reentering at the restored position", async ({ browser }) => {
  const a = await member(browser, world("집"), "walk");
  const b = await member(browser, world("이웃"), "walk");
  try {
    await a.page.evaluate(() => {
      const state = window as typeof window & { portalSwitches: number[] };
      state.portalSwitches = [];
      new MutationObserver(changes => {
        if (changes.some(change => change.attributeName === "data-visited-world"))
          state.portalSwitches.push(Number(getComputedStyle(document.querySelector(".portal-transition")!).opacity));
      }).observe(document.querySelector("main")!, { attributes: true });
    });
    await walkIntoPortal(a.page, "이웃");
    await expect(a.page.locator(".play-return .visit-dot")).toHaveCount(3);
    await expect.poll(async () => Number(await a.page.locator(".play-shell canvas").getAttribute("data-player-z"))).toBeGreaterThan(1.8);
    await a.page.keyboard.down("KeyW");
    await expect(a.page.locator(".portal-visit-status")).toHaveCount(0, { timeout: 20_000 });
    await a.page.keyboard.up("KeyW");
    const canvas = a.page.locator(".play-shell canvas");
    await expect.poll(async () => Number(await canvas.getAttribute("data-player-z"))).toBeLessThan(.5);
    await a.page.waitForTimeout(1100);
    await expect(a.page.locator("main")).toHaveAttribute("data-visited-world", "");
    expect(JSON.parse((await saved(a.page))!).title).toBe("집");
    await expect(a.page.locator(".play-return")).toBeEnabled();
    await expect(a.page.locator(".play-return .visit-dot")).toHaveCount(0);
    expect(await a.page.evaluate(() => (window as typeof window & { portalSwitches: number[] }).portalSwitches)).toEqual([1, 1]);
  } finally { await a.context.close(); await b.context.close(); }
});

test("different worlds in the same browser survive reloading both tabs", async ({ browser }) => {
  const a = await member(browser, world("첫 번째 탭"), "tabs");
  try {
    const b = await a.context.newPage();
    await b.goto("/whistle/?room=tabs");
    await b.bringToFront();
    await expect(b.getByRole("button", { name: "파일 저장", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨", { timeout: 15_000 });
    const other = world("두 번째 탭");
    other.terrain!.tiles[30].height = 2;
    await b.locator("input[type=file]").setInputFiles({ name: "second.whistle.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(other)) });
    const tabWorld = (page: import("@playwright/test").Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("whistle.world.tab.v1")!));
    await expect.poll(async () => (await tabWorld(b)).title, { timeout: 15_000 }).toBe("두 번째 탭");
    await a.page.bringToFront();
    await a.page.reload();
    await expect(a.page.locator("main")).toHaveAttribute("data-portal-status", "online");
    expect((await tabWorld(a.page)).title).toBe("첫 번째 탭");
    await a.page.getByRole("button", { name: "높이기", exact: true }).click();
    await a.page.locator('[data-cell="40"]').click();
    await expect.poll(async () => (await tabWorld(a.page)).terrain.tiles[40].height).toBe(1);
    await b.bringToFront();
    await b.reload();
    await expect(b.locator("main")).toHaveAttribute("data-portal-status", "online");
    await expect(b.getByRole("button", { name: "파일 저장", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨", { timeout: 15_000 });
    expect((await tabWorld(b)).title).toBe("두 번째 탭");
    expect((await tabWorld(b)).terrain.tiles[30].height).toBe(2);
    expect((await tabWorld(b)).terrain.tiles[40].height).toBe(0);
    expect(JSON.parse((await saved(b))!).title).toBe("두 번째 탭");
    expect((await tabWorld(a.page)).title).toBe("첫 번째 탭");
    await a.page.bringToFront();
    await a.page.locator('[data-cell="41"]').click();
    await a.page.reload();
    await expect(a.page.getByRole("button", { name: "파일 저장", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨", { timeout: 15_000 });
    expect((await tabWorld(a.page)).terrain.tiles[41].height).toBe(1);
  } finally { await a.context.close(); }
});

test("mobile visitors can return after the host disconnects", async ({ browser }, testInfo) => {
  const a = await member(browser, world("내 세계"), "disconnect", true);
  const b = await member(browser, world("잠깐 열린 세계"), "disconnect");
  try {
    const before = await saved(a.page);
    await walkIntoPortal(a.page, "잠깐 열린 세계");
    expect(await a.page.locator(".visit-dot").evaluateAll(dots => dots.map(dot => dot.getAttribute("cy")))).toEqual(["12", "12", "12"]);
    await expect(a.page.locator(".portal-visit-status")).toContainText("잠깐 열린 세계");
    await b.context.close();
    await expect(a.page.locator(".portal-visit-status")).toContainText("접속 종료");
    await a.page.screenshot({ path: testInfo.outputPath("mobile-disconnected-visit.png") });
    await a.page.getByRole("button", { name: "내 세계로 돌아가기", exact: true }).click();
    await expect(a.page.locator("main")).toHaveAttribute("data-visited-world", "");
    await expect(a.page.locator(".play-return")).toBeEnabled({ timeout: 15_000 });
    await expect.poll(async () => Number(await a.page.locator(".play-shell canvas").getAttribute("data-player-z"))).toBeGreaterThan(1);
    await a.page.getByRole("button", { name: "만들기로 돌아가기", exact: true }).click();
    await expect(a.page.locator("[data-map-portal]")).toHaveCount(0);
    expect(await saved(a.page)).toBe(before);
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await a.context.close(); await b.context.close(); }
});
