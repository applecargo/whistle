import { test, expect } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";

test("water at different heights stays seated in its own basin", async ({ page }, testInfo) => {
  const world = terrainFixtures().flat;
  world.timeOfDay = "noon";
  world.start = { x: 6, z: 10 };
  for (let z = 2; z <= 9; z++) for (let x = 3; x <= 8; x++) world.terrain!.tiles[z * 12 + x] = { height: z < 6 ? 4 : 0, surface: "slick" };
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
  await page.locator(".live-preview").screenshot({ path: testInfo.outputPath("water-terraces-overview.png") });
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect(page.locator(".play-shell canvas")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("water-terraces-play.png") });
  expect(errors).toEqual([]);
});
