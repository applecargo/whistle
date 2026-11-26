import { probePd, pdProbe, probeOutputGain, outputGain } from "./pd-probe";
import { test, expect, type Page } from "@playwright/test";
import { createSocket } from "node:dgram";
import { config, data, messages, setup } from "./uwb-device-fixture";
import { startBridge } from "../../scripts/uwb/bridge";
import { distanceTo } from "../../lib/uwb/solver";
import { createLabWorld } from "../../uwb-lab/world";
import { rectangleConfig } from "../../lib/uwb/rectangle";

test.use({ launchOptions: { args: process.platform === "darwin" ? ["--use-angle=metal"] : [] } });
test.beforeEach(async ({ page }) => { await probeOutputGain(page); });
test.setTimeout(60_000);
test("UDP ranges reach the existing scene and Pd; height, invalid frames and timeouts stay separate", async ({ page }) => {
  await probePd(page);
  const device = await setup(page);
  try {
    await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    await expect(page.locator("#device-status")).toContainText("태그 0 수신 중");
    await expect(page.locator("#device-status")).toContainText("높이 UWB 계산");
    await expect(page.getByLabel("관객 X (m)", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "관객 위치 평면도", exact: true })).toBeDisabled();
    await expect.poll(async () => (await data(page)).metres?.x).toBeCloseTo(1, 4);
    await expect.poll(async () => (await data(page)).pd?.grass).toBeGreaterThan(0);
    await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
    await expect(page.locator("#audio-status")).toHaveText("오디오 실행 중");
    await expect.poll(async () => (await messages(page))["whistle-board-height"]?.[0]).toBeCloseTo(1.2, 4);
    await expect.poll(async () => (await pdProbe(page)).starts).toContain("terrain_soft");
    const ground = (await data(page)).pd.y;
    device.move({ x: 1, z: 3, boardHeight: 2.1 });
    await expect.poll(async () => (await messages(page))["whistle-board-height"]?.[0]).toBeCloseTo(2.1, 4);
    expect((await data(page)).pd.y).toBeCloseTo(ground, 8);
    device.move({ x: 3, z: 3, boardHeight: 2.1 });
    await expect(page.locator("#rough")).toHaveText("1.000");
    await expect.poll(async () => (await pdProbe(page)).starts).toContain("terrain_rough");
    expect((await messages(page))["whistle-player position"]).toHaveLength(3);
    device.invalid();
    await expect(page.locator("#device-status")).toContainText("앵커가 4개 이상");
    await expect.poll(() => outputGain(page)).toBe(0);
    await expect(page.getByTestId("position-marker")).toHaveCount(0);
    device.valid();
    await expect.poll(() => outputGain(page)).toBe(1);
    device.pause();
    await expect(page.locator("#device-status")).toContainText("위치를 1초 이상 수신하지 못했습니다.");
    await expect.poll(() => outputGain(page)).toBe(0);
    device.resume();
    await expect.poll(() => outputGain(page)).toBe(1);
    await page.getByRole("button", { name: "오디오 종료", exact: true }).click();
    device.move({ x: 5, z: 3, boardHeight: 1 });
    await expect(page.locator("#water")).toHaveText("물속");
    await expect(page.locator("#audio-status")).toHaveText("오디오 꺼짐");
    await page.getByRole("radio", { name: "가상 좌표 직접 입력", exact: true }).check();
    await expect(page.getByLabel("관객 X (m)", { exact: true })).toBeEnabled();
    expect((await data(page)).metres).toEqual({ x: 1, z: 3 });
    expect((await data(page)).boardHeight).toBe(0);
  } finally { await device.close(); }
});

test("page rectangle settings turn raw ranges into terrain audio and clear stale positions on recalibration", async ({ page }) => {
  const rectangle = rectangleConfig({ width: 6, depth: 4, anchorHeight: 1.5, tagHeight: 1.2 });
  const device = await setup(page, { sourceConfig: rectangle, rangesOnly: true });
  try {
    device.move({ x: 1, z: 2, boardHeight: 1.2 });
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    await expect(page.locator("#range-data")).toContainText("태그 → 앵커 실측 거리");
    await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
    const apply = page.getByRole("button", { name: "배치 적용 · 위치 연결", exact: true });
    await apply.click();
    await expect(page.locator("#anchor-status")).toContainText("모두 입력");
    for (const [label, value] of [["앵커 배치 가로 (m)", "6"], ["앵커 배치 세로 (m)", "4"],
      ["앵커 공통 높이 (m)", "1.5"], ["태그 높이 (m)", "1.2"]]) {
      await page.getByLabel(label, { exact: true }).fill(value);
    }
    await apply.click();
    await expect.poll(async () => (await data(page)).metres?.x).toBeCloseTo(1, 4);
    await expect.poll(async () => (await data(page)).metres?.z).toBeCloseTo(2, 4);
    await expect(page.getByLabel("세로 (m)", { exact: true })).toHaveValue("4");
    await expect(page.getByTestId("position-marker")).toHaveCount(1);
    await expect(page.locator("#anchor-status")).toContainText("설정 적용됨");
    device.move({ x: 1, z: 5, boardHeight: 1.2 });
    await expect(page.locator("#audio-block-reason")).toContainText("공간 범위를 벗어났습니다.");
    await expect(page.locator("#audio-block-reason")).toContainText("계산된 위치 X");
    await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
    device.move({ x: 1, z: 2, boardHeight: 1.2 });
    await expect(page.locator("#audio-block-reason")).toHaveCount(0);
    await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
    await expect.poll(() => outputGain(page)).toBe(1);
    await expect.poll(async () => (await messages(page))["whistle-board-height"]).toEqual([1.2]);
    await expect.poll(async () => (await data(page)).pd?.rough).toBeCloseTo(0);
    device.move({ x: 3, z: 2, boardHeight: 1.2 });
    await expect(page.locator("#rough")).toHaveText("1.000");
    await expect.poll(async () => (await data(page)).pd?.rough).toBeCloseTo(1);
    device.invalid();
    await expect(page.locator("#device-status")).toContainText("앵커가 3개 이상");
    await expect(page.locator("#range-data")).toContainText("미수신");
    await expect.poll(() => outputGain(page)).toBe(0);
    device.valid();
    await expect.poll(() => outputGain(page)).toBe(1);
    device.pause();
    await page.getByLabel("태그 높이 (m)", { exact: true }).fill("1");
    await apply.click();
    await expect(page.getByTestId("position-marker")).toHaveCount(0);
    await expect.poll(() => outputGain(page)).toBe(0);
    device.move({ x: 1, z: 2, boardHeight: 1 }); device.resume();
    await expect.poll(async () => (await messages(page))["whistle-board-height"]).toEqual([1]);
    device.pause();
    await expect(page.locator("#device-status")).toContainText("1초 동안 거리 수신 없음");
    await expect.poll(() => outputGain(page)).toBe(0);
    device.resume();
    await expect.poll(() => outputGain(page)).toBe(1);
    await page.getByRole("button", { name: "거리만 확인", exact: true }).click();
    await expect(page.locator("#device-status")).toContainText("좌표 계산 안 함");
    await expect(page.getByTestId("position-marker")).toHaveCount(0);
    await expect.poll(() => outputGain(page)).toBe(0);
  } finally { await device.close(); }
});

test("tag selection, saved Whistle world and connection loss do not use another or stale position", async ({ page }) => {
  const device = await setup(page);
  try {
    const world = createLabWorld();
    world.title = "장비 연결 세계";
    const stored = JSON.stringify(world);
    await page.evaluate((stored) => localStorage.setItem("whistle.world.v2", stored), stored);
    await page.getByRole("button", { name: "Whistle 3D", exact: true }).click();
    await expect(page.getByRole("heading", { name: world.title, exact: true })).toBeVisible();
    device.tag("1");
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    await expect(page.locator("#device-status")).toHaveText("태그 0 데이터 대기");
    await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
    await page.getByLabel("관객 태그 ID", { exact: true }).fill("1");
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    await expect(page.locator("#device-status")).toContainText("태그 1 수신 중");
    await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
    await expect.poll(() => outputGain(page)).toBe(1);
    await page.getByRole("button", { name: "연결 종료", exact: true }).click();
    await expect.poll(() => outputGain(page)).toBe(0);
    await expect(page.getByTestId("position-marker")).toHaveCount(0);
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    await expect.poll(() => outputGain(page)).toBe(1);
    device.pause();
    await device.stopBridge();
    await expect(page.locator("#device-status")).toContainText("PC 수신기 연결이 끊겼습니다.");
    await expect.poll(() => outputGain(page)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("whistle.world.v2"))).toBe(stored);
  } finally { await device.close(); }
});

test("centre calibration corrects biased distances, follows movement and resets with geometry", async ({ page }) => {
  const source = rectangleConfig({ width: 1, depth: .37, anchorHeight: .66, tagHeight: .66 });
  const device = await setup(page, { sourceConfig: source, rangesOnly: true, biases: [.45, .55, .8, .5] });
  try {
    device.move({ x: .5, z: .185, boardHeight: .66 });
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    for (const [label, value] of [["앵커 배치 가로 (m)", "1"], ["앵커 배치 세로 (m)", ".37"],
      ["앵커 공통 높이 (m)", ".66"], ["태그 높이 (m)", ".66"]]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "배치 적용 · 위치 연결", exact: true }).click();
    await expect(page.locator("#device-status")).toContainText("위치 수신 중");
    await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "중앙 거리 보정 · 5초", exact: true }).click();
    await expect(page.locator("#correction-status")).toContainText("임시 보정 적용됨", { timeout: 10000 });
    await expect.poll(async () => (await data(page)).metres?.x).toBeCloseTo(.5, 3);
    await expect.poll(async () => (await data(page)).metres?.z).toBeCloseTo(.185, 3);
    await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeEnabled();
    await expect(page.locator("#range-data")).toContainText("원본 거리");
    await expect(page.locator("#range-data")).toContainText("보정 거리");
    device.move({ x: .25, z: .185, boardHeight: .66 });
    await expect.poll(async () => (await data(page)).metres?.x).toBeCloseTo(.25, 2);
    device.pause();
    await expect(page.locator("#device-status")).toContainText("1초 동안 거리 수신 없음");
    device.resume();
    await expect.poll(async () => (await data(page)).metres?.x).toBeCloseTo(.25, 2);
    await page.getByLabel("앵커 배치 세로 (m)", { exact: true }).fill(".4");
    await page.getByRole("button", { name: "배치 적용 · 위치 연결", exact: true }).click();
    await expect(page.locator("#correction-status")).toHaveText("거리 보정 없음");
    await expect(page.locator("#range-data")).not.toContainText("보정 거리");
  } finally { await device.close(); }
});

test("four exhibition tabs follow their own tag and mute independently", async ({ context }) => {
  test.setTimeout(120_000);
  const bridge = await startBridge(config, { wsPort: 0, udpPort: 0, log: () => {} });
  const udp = createSocket("udp4");
  const xs = [1, 3, 5, 2];
  let seq = 0;
  let paused = -1;
  const timer = setInterval(() => {
    seq++;
    xs.forEach((x, id) => {
      if (id === paused) return;
      const point = { x, z: 3, boardHeight: 1.2 };
      udp.send(JSON.stringify({ type: "ranges", tagId: String(id), seq,
        ranges: config.anchors.map(a => ({ anchorId: a.id, distance: distanceTo(point, a) })) }),
      bridge.udpPort, "127.0.0.1");
    });
  }, 100);
  const tabs: Page[] = [];
  try {
    await context.addInitScript(world => localStorage.setItem("whistle.world.v2", JSON.stringify(world)), createLabWorld());
    for (const [id, x] of xs.entries()) {
      const tab = await context.newPage();
      tabs.push(tab);
      await probeOutputGain(tab);
      await tab.goto(`uwb-lab/index.html?tag=${id}`);
      await expect(tab.getByLabel("관객 태그 ID")).toHaveValue(String(id));
      await tab.getByLabel("수신기 주소").fill(`ws://127.0.0.1:${bridge.wsPort}`);
      await tab.getByRole("button", { name: "연결 / 다시 연결" }).click();
      await tab.getByRole("button", { name: "오디오 시작" }).click();
      await expect(tab.locator("#audio-status")).toHaveText("오디오 실행 중", { timeout: 30_000 });
      await expect.poll(async () => (await messages(tab))["whistle-player position"]?.[0]).toBeCloseTo(x / 6, 4);
    }
    const levels = () => Promise.all(tabs.map(outputGain));
    await expect.poll(levels).toEqual([1, 1, 1, 1]);
    paused = 1;
    await expect.poll(levels).toEqual([1, 0, 1, 1]);
    paused = -1;
    await expect.poll(levels).toEqual([1, 1, 1, 1]);
  } finally {
    clearInterval(timer);
    udp.close();
    await bridge.close();
    await Promise.all(tabs.map(tab => tab.close()));
  }
});
