import { test, expect } from "@playwright/test";
import { data, messages, setup } from "./uwb-device-fixture";
import { createLabWorld } from "../../uwb-lab/world";

test.use({
  viewport: { width: 480, height: 300 },
  launchOptions: { args: [
    ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
    "--enable-unsafe-swiftshader", "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  ] },
});

test("the exhibition picker offers three views and matching UWB placements", async ({ page }) => {
  await page.goto("./?display=monitors");
  const views = ["M1", "M2", "M3"];
  await expect(page.getByRole("navigation").getByRole("link")).toHaveText(views);
  await page.locator("details summary").click();
  await expect(page.getByRole("combobox").locator("option")).toHaveText(views);
});

test("an object monitor follows its visitor while sound samples the virtual B2 ground", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.addInitScript(world => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
  }, createLabWorld());
  await page.goto("./");
  const screen = await context.newPage();
  await screen.goto("./?display=M3&mx=2&mz=2&face=0");
  const canvas = screen.locator("canvas");
  await expect(canvas).toBeAttached({ timeout: 30000 });
  const lab = await context.newPage();
  const device = await setup(lab, true);
  try {
    await expect(lab.locator("#live-status")).toContainText("연결되었습니다");
    await lab.getByRole("button", { name: "연결 / 다시 연결", exact: true }).press("Enter");
    const initialSubject = await canvas.getAttribute("data-subject");
    expect(initialSubject).toBeTruthy();
    const yaw = () => canvas.getAttribute("data-sector-yaw").then(Number);
    device.move({ x: 2.5, z: 2.45, boardHeight: 1.2 });
    await expect.poll(yaw, { timeout: 20000 }).toBeGreaterThan(2);
    await expect.poll(async () => (await data(lab)).grid?.x).toBeCloseTo(4.5, 2);
    await expect.poll(async () => (await data(lab)).grid?.z).toBeCloseTo(4.4, 2);
    await lab.getByRole("button", { name: "오디오 시작", exact: true }).click();
    await expect.poll(async () => (await messages(lab))["whistle-gate"]).toEqual([1]);
    device.move({ x: 1.5, z: 2.45, boardHeight: 1.2 });
    await expect.poll(yaw, { timeout: 20000 }).toBeLessThan(-2);
    expect(await canvas.getAttribute("data-subject")).toBe(initialSubject);
    device.pause();
    await expect(lab.locator("#device-status")).toContainText("1초 이상");
    await expect.poll(async () => Math.abs(await yaw()), { timeout: 15000 }).toBeLessThan(.45);
    await expect.poll(async () => (await messages(lab))["whistle-gate"]).toEqual([0]);
  } finally { await device.close(); }
});

test("painting a nearby pond in the main editor reframes an open observation window", async ({ page, context }) => {
  const world = createLabWorld();
  for (const tile of world.terrain!.tiles) tile.surface = "plain";
  world.terrain!.tiles[0].surface = "rough";
  await page.addInitScript(world => localStorage.setItem("whistle.world.v2", JSON.stringify(world)), world);
  await page.goto("./");
  const screen = await context.newPage();
  await screen.goto("./?display=M3");
  const canvas = screen.locator("canvas");
  await expect(canvas).toHaveAttribute("data-subject", "stone-0", { timeout: 20000 });
  await page.getByRole("button", { name: "흐름", exact: true }).click();
  await page.locator('[data-cell="65"]').click();
  await expect(canvas).toHaveAttribute("data-subject", "water-65");
  await page.locator('[data-cell="65"]').click();
  await expect(canvas).toHaveAttribute("data-subject", "stone-0");
});

test("room calibration reaches existing and newly opened observation windows", async ({ page, context }) => {
  await page.addInitScript(world => localStorage.setItem("whistle.world.v2", JSON.stringify(world)), createLabWorld());
  await page.goto("./");
  const screen = await context.newPage();
  await screen.goto("./?display=M3");
  const canvas = screen.locator("canvas");
  await expect(canvas).toHaveAttribute("data-subject", /^stone-/);
  const lab = await context.newPage();
  await lab.goto("./uwb-lab/index.html?exhibition=1");
  await expect(lab.locator("#live-status")).toContainText("연결되었습니다");
  await lab.getByLabel("원점 X (m)").fill("2");
  await expect(canvas).toHaveAttribute("data-subject", /^grass-/);
  const subject = await canvas.getAttribute("data-subject");
  const late = await context.newPage();
  await late.goto("./?display=M3");
  await expect(late.locator("canvas")).toHaveAttribute("data-subject", subject!);
});
