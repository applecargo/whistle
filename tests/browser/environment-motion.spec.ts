import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import type { World } from "../../lib/world";

async function enter(page: Page, world: World) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(world => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await page.goto(".");
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await page.locator(".play-shell canvas").waitFor();
  return errors;
}
const motion = (page: Page) => page.locator(".play-shell canvas").getAttribute("data-motion");

test("hold jump from raised rough ground to glide, release to land", async ({ page }) => {
  const world = terrainFixtures().flat; world.start = { x: 3, z: 3 };
  for (let z = 2; z <= 4; z++) for (let x = 2; x <= 4; x++) world.terrain!.tiles[z * world.size + x] = { height: 2, surface: "rough", hole: false };
  const errors = await enter(page, world);
  await page.keyboard.down("KeyW"); await page.keyboard.down("Space");
  await expect.poll(() => motion(page), { timeout: 5000 }).toBe("glide");
  await page.keyboard.up("Space"); await page.keyboard.up("KeyW");
  await expect.poll(() => motion(page), { timeout: 5000 }).toBe("walk");
  expect(errors).toEqual([]);
});

test("raised ground beside a hole supports floating, crouch releases it", async ({ page }, testInfo) => {
  const world = terrainFixtures().flat; world.start = { x: 4, z: 5 };
  world.terrain!.tiles[5 * world.size + 4] = { height: 1, surface: "plain", hole: false };
  world.terrain!.tiles[4 * world.size + 4].hole = true;
  const errors = await enter(page, world);
  await page.keyboard.down("KeyW");
  await expect.poll(() => motion(page), { timeout: 5000 }).toBe("float");
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: testInfo.outputPath("floating.png") });
  await page.getByRole("button", { name: "기어가기", exact: true }).click();
  await expect.poll(() => motion(page), { timeout: 5000 }).toBe("fall");
  expect(errors).toEqual([]);
});

test("walking across a plant height transition bounces, crouching suppresses it", async ({ page }) => {
  const world = terrainFixtures().flat; world.start = { x: 4, z: 5 };
  world.terrain!.tiles[5 * world.size + 4].surface = "soft";
  world.terrain!.tiles[4 * world.size + 4] = { height: 1, surface: "soft", hole: false };
  const errors = await enter(page, world);
  await page.keyboard.down("KeyW");
  await expect.poll(() => motion(page), { timeout: 4000 }).toBe("bounce");
  await page.keyboard.up("KeyW");
  await expect.poll(() => motion(page), { timeout: 4000 }).toBe("walk");
  await page.getByRole("button", { name: "기어가기", exact: true }).click();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600);
  expect(await motion(page)).toBe("walk");
  await page.keyboard.up("KeyW");
  expect(errors).toEqual([]);
});
