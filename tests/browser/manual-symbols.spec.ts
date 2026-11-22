import { setPresentation, openPlaced } from "./presentation";
import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";

async function setup(page: Page) {
  const world = terrainFixtures().flat;
  for (let z = 1; z <= 3; z++) for (let x = 1; x <= 3; x++) world.terrain!.tiles[z * world.size + x].surface = "soft";
  world.terrain!.tiles[8 * world.size + 9].height = 2;
  world.terrain!.tiles[3 * world.size + 4].surface = "rough";
  await page.addInitScript(world => {
    if (localStorage.getItem("symbols-ready")) return;
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
    localStorage.setItem("symbols-ready", "1");
  }, world);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("const scene = new THREE.Scene();", "const scene = new THREE.Scene(); globalThis.__testScene = scene;") });
  });
  await page.goto(".");
  await expect(page.getByRole("button", { name: "텍스트 만들기", exact: true })).toBeVisible();
  await expect(page.locator("[data-symbol-site]")).toHaveCount(0);
  return errors;
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("whistle.world.v2")!));
const presentations = (page: Page) => page.evaluate(() => {
  const scene = (globalThis as any).__testScene;
  if (!scene) return [];
  const world = JSON.parse(localStorage.getItem("whistle.world.v2")!);
  return world.objects.map((object: any) => scene.children.find((model: any) => model.userData.placementId === object.id)?.userData.presentation);
});

test("symbols overlap without backgrounds, keep shared colors and erase independently", async ({ page }, testInfo) => {
  const errors = await setup(page);
  const create = async (text: string) => {
    await page.getByRole("button", { name: "텍스트 만들기", exact: true }).click();
    await page.getByRole("textbox", { name: "텍스트 입력" }).fill(text);
    await page.getByRole("button", { name: "저장", exact: true }).click();
  };
  await create("첫 번째");
  await page.locator('[data-cell="78"]').click();
  await page.locator('[data-cell="79"]').click();
  const firstColor = await page.locator('[data-cell="78"] .site-glyph').evaluate(el => getComputedStyle(el).color);
  await expect(page.locator('[data-cell="79"] .site-glyph')).toHaveCSS("color", firstColor);
  await create("두 번째");
  await page.locator('[data-cell="78"]').click();
  await expect(page.locator('[data-cell="78"] [data-symbol-site]')).toHaveCount(2);
  const colors = await page.locator('[data-cell="78"] .site-glyph').evaluateAll(els => els.map(el => getComputedStyle(el).color));
  expect(new Set(colors).size).toBe(2);
  await expect.poll(async () => (await saved(page)).objects.length).toBe(3);
  for (const glyph of await page.locator('[data-cell="78"] .generated-site').all()) {
    await expect(glyph).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(glyph.locator("svg")).toHaveCSS("opacity", "0.8");
  }
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator('[data-cell="78"] [data-symbol-site]')).toHaveCount(1);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-cell="78"] [data-symbol-site]')).toHaveCount(2);
  expect(await page.locator('[data-cell="78"] .site-glyph').evaluateAll(els => els.map(el => getComputedStyle(el).color))).toEqual(colors);
  const second = (await saved(page)).assets.find((asset: any) => asset.text === "두 번째");
  await page.locator(`[data-symbol-asset="${second.id}"]`).click();
  await page.locator('[data-cell="78"]').click();
  await expect(page.locator('[data-cell="78"] [data-symbol-site]')).toHaveCount(1);
  await expect(page.locator('[data-cell="78"] .site-glyph')).toHaveCSS("color", firstColor);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("overlapping-symbols.png") });
  expect(errors).toEqual([]);
});

test("text is created freely, placed repeatedly, erased, undone and edited without generated slots", async ({ page }, testInfo) => {
  const errors = await setup(page);
  await page.getByRole("button", { name: "텍스트 만들기", exact: true }).click();
  await expect(page.getByRole("dialog").locator(".media-tabs, .shape-options, [title], [data-display]")).toHaveCount(0);
  await expect(page.locator("[data-placement]")).toHaveText("세우기");
  await expect(page.locator(".cycle-mark")).toHaveCount(1);
  await expect(page.locator('.asset-size-options button[aria-pressed="true"]')).toHaveCSS("text-decoration-line", "underline");
  await page.getByRole("textbox", { name: "텍스트 입력" }).fill("어디에나 놓는 글");
  await page.getByLabel("글자 색", { exact: true }).fill("#ff36b5");
  await setPresentation(page, "placement", "floating");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await saved(page)).assets.some((asset: any) => asset.text)).toBe(true);
  expect((await saved(page)).objects).toHaveLength(0);
  for (const cell of [78, 79, 80, 81, 82]) await page.locator(`[data-cell="${cell}"]`).click();
  await expect.poll(async () => (await saved(page)).objects.length).toBe(5);
  await page.locator('[data-cell="78"]').click();
  await expect.poll(async () => (await saved(page)).objects.length).toBe(4);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect.poll(async () => (await saved(page)).objects.length).toBe(5);
  const world = await saved(page), object = world.objects.find((o: any) => o.x === 6);
  expect(world.assets.find((asset: any) => asset.text).display).toBeUndefined();
  await openPlaced(page, object.id);
  await expect(page.getByLabel("글자 색", { exact: true })).toHaveValue("#ff36b5");
  await page.getByRole("textbox", { name: "텍스트 입력" }).fill("이 자리만 수정");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await saved(page)).objects.find((o: any) => o.id === object.id).asset).not.toBe(object.asset);
  expect((await saved(page)).objects.filter((o: any) => o.asset === object.asset)).toHaveLength(4);
  await page.reload();
  await openPlaced(page, object.id);
  await expect(page.getByRole("textbox", { name: "텍스트 입력" })).toHaveValue("이 자리만 수정");
  await expect(page.locator("[data-placement]")).toHaveAttribute("data-placement", "floating");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("manual-symbols-desktop.png") });
  expect(errors).toEqual([]);
});

test("image creation and placement work on mobile with one placement control", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await setup(page);
  await page.getByRole("button", { name: "이미지 만들기", exact: true }).click();
  await expect(page.locator(".photo-canvas-wrap canvas")).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator("[data-symbol-asset]")).toHaveCount(0);
  await page.getByRole("button", { name: "이미지 만들기", exact: true }).click();
  const canvas = page.locator(".photo-canvas-wrap canvas"), box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 30, box.y + box.height - 30, { steps: 8 }); await page.mouse.up();
  await setPresentation(page, "placement", "surface");
  await expect(page.locator("[data-display]")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("manual-image-mobile.png") });
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.locator('[data-cell="26"]').click();
  await expect.poll(async () => (await saved(page)).objects.length).toBe(1);
  const world = await saved(page), asset = world.assets.find((a: any) => a.id === world.objects[0].asset);
  expect(asset.image).toMatch(/^data:image/);
  expect(asset.text).toBeUndefined(); expect(asset.placement).toBe("surface"); expect(asset.display).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath("manual-symbols-mobile.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("the same content keeps its chosen placement while visibility follows each environment and terrain edits", async ({ page }) => {
  const errors = await setup(page);
  await page.getByRole("button", { name: "텍스트 만들기", exact: true }).click();
  await page.getByRole("textbox", { name: "텍스트 입력" }).fill("환경에 반응하는 글");
  await setPresentation(page, "placement", "floating");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  for (const cell of [78, 105, 39]) await page.locator(`[data-cell="${cell}"]`).click();
  await expect.poll(() => presentations(page)).toEqual([
    { placement: "floating", display: "steady" }, { placement: "floating", display: "nearby" }, { placement: "floating", display: "pulse" },
  ]);
  await page.getByRole("button", { name: "낮추기", exact: true }).click();
  for (let n = 0; n < 2; n++) await page.locator('[data-cell="105"]').click({ position: { x: 2, y: 2 } });
  await expect.poll(async () => (await presentations(page))[1]).toEqual({ placement: "floating", display: "steady" });
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect.poll(async () => (await presentations(page))[1].display).toBe("nearby");
  await page.reload();
  await expect.poll(async () => (await presentations(page))?.length).toBe(3);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect.poll(async () => (await presentations(page))?.length).toBe(3);
  const opacity = () => page.evaluate(() => {
    const model = (globalThis as any).__testScene.children.find((o: any) => o.userData.presentation?.display === "pulse");
    return model?.getObjectByName("symbol-content")?.material.opacity;
  });
  const initial = await opacity();
  await expect.poll(async () => Math.abs(await opacity() - initial), { timeout: 12_000 }).toBeGreaterThan(.2);
  expect(errors).toEqual([]);
});
