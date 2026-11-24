import { savedWorld } from "./world-storage";
import { test, expect } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";

test("raising connected water floods low ground with one flat surface and lowering restores it", async ({ page }, testInfo) => {
  const world = terrainFixtures().flat;
  world.timeOfDay = "noon";
  for (const tile of world.terrain!.tiles) tile.height = 3;
  for (let z = 2; z <= 8; z++) for (let x = 2; x <= 6; x++) world.terrain!.tiles[z * 12 + x].height = 0;
  for (const i of [52, 53]) world.terrain!.tiles[i].surface = "slick";
  for (let z = 3; z <= 7; z++) for (let x = 7; x <= 9; x++) world.terrain!.tiles[z * 12 + x].height = 3;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("const scene = new THREE.Scene();", "const scene = new THREE.Scene(); globalThis.__testScene = scene;") });
  });
  await page.addInitScript(world => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await page.goto(".");
  await expect.poll(() => page.evaluate(() => !!(globalThis as any).__testScene?.getObjectByName("generated-water"))).toBe(true);
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="52"]').click();
  await expect(page.locator('[data-cell="38"] .result-water')).toHaveCount(1);
  await expect(page.locator('[data-cell="56"] .result-water')).toHaveCount(0);
  await expect(page.locator('[data-cell="53"]')).toHaveAccessibleName(/높이 1/);
  const surface = await page.evaluate(() => {
    const mesh = (globalThis as any).__testScene.getObjectByName("generated-water");
    const p = mesh.geometry.getAttribute("position");
    let min = Infinity, max = -Infinity, extent = 0;
    for (const i of mesh.geometry.index.array) {
      min = Math.min(min, p.getY(i)); max = Math.max(max, p.getY(i));
      extent = Math.max(extent, Math.abs(p.getX(i)));
    }
    return { min, max, extent };
  });
  expect(surface.min).toBeCloseTo(.99, 4);
  expect(surface.max).toBeCloseTo(.99, 4);
  expect(surface.extent).toBeLessThan(world.size);
  await page.locator(".live-preview").screenshot({ path: testInfo.outputPath("raised-water.png") });
  await page.getByRole("button", { name: "낮추기", exact: true }).click();
  await page.locator('[data-cell="38"]').click();
  await expect(page.locator('[data-cell="38"] .result-water')).toHaveCount(0);
  await expect(page.locator('[data-cell="52"]')).toHaveAccessibleName(/높이 0/);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator('[data-cell="38"] .result-water')).toHaveCount(1);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(page.locator('[data-cell="38"] .result-water')).toHaveCount(0);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect(page.locator(".play-shell canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

test("saved raised water on open ground does not cover the board or distant ground", async ({ page }) => {
  const world = terrainFixtures().flat;
  for (const i of [52, 53]) world.terrain!.tiles[i] = { height: 6, surface: "slick" };
  await page.addInitScript(world => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await page.goto(".");
  await expect(page.locator(".result-water")).toHaveCount(2);
  await expect(page.locator('[data-cell="0"] .result-water')).toHaveCount(0);
  await expect(page.locator('[data-cell="52"]')).toHaveAccessibleName(/높이 0/);
  const saved = await savedWorld(page);
  expect(saved.terrain!.tiles[52].height).toBe(6);
  expect(saved.terrain!.tiles[0].surface).toBe("plain");
});
