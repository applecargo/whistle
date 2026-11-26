// 이벤트 소리(공간화 슬롯)와 Pd ↔ JS 공유 값을 실제 엔진으로 확인한다(audio/spatial-sources.md).
// - Pd가 whistle-spawn으로 만들고 whistle-source alive 0으로 끈다(main.pd의 [list trim] 통로 → JS)
// - 디버그 화면의 1 키: 게임이 fallingstar_source를 플레이어 앞 위쪽에 띄운다
// - 영역 슬롯(vK)에 규칙을 보내면 그 패치 이름의 규칙이 된다
import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import { probePd, type PdProbe } from "./pd-probe";

test.setTimeout(120_000);

/** 지금 떠 있는 슬롯: 번호 → [패치, 이름] (whistle-slot on/off를 순서대로) */
const slots = (page: Page) => page.evaluate(() => {
  const live = new Map<number, [string, string]>();
  for (const m of (window as unknown as { pdProbe: PdProbe }).pdProbe.messages) {
    if (m.bus === "whistle-slot on") live.set(Number(m.value[0]), [String(m.value[1]), String(m.value[2])]);
    if (m.bus === "whistle-slot off") live.delete(Number(m.value[0]));
  }
  return [...live.values()];
});
/** Pd 안에서 [s bus]로 보낸 것과 같다: JS → Pd 버스 → main.pd 통로 → JS */
const fromPd = (page: Page, bus: string, name: string, words: (string | number)[]) =>
  page.evaluate(([bus, name, words]) => (window as unknown as { Pd4Web: { sendMessage(t: string, s: string, l: unknown[]): boolean } })
    .Pd4Web.sendMessage(bus as string, name as string, words as unknown[]), [bus, name, words] as const);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(world => {
    if (!localStorage.getItem("whistle.world.v2")) localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, terrainFixtures().flat);
  await probePd(page);
});

test("Pd가 만들고 끄는 이벤트 소리, 1 키의 fallingstar, 영역 패치가 알리는 규칙", async ({ page }) => {
  const logs: string[] = [];
  const pdErrors: string[] = [];
  page.on("console", (m) => {
    if (m.text().startsWith("[Whistle:Audio]")) logs.push(m.text());
    if (/error:|couldn't create|\.\.\. couldn't/.test(m.text())) pdErrors.push(m.text());
  });
  await page.goto(".");
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect.poll(() => logs.some((l) => /오디오 시작/.test(l)), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await slots(page)).some(([patch]) => patch === "terrain_plain"), { timeout: 30_000 }).toBe(true);

  // Pd가 만든다: 이름은 Pd가 정한 그대로 패치의 $1
  expect(await fromPd(page, "whistle-spawn", "star1", ["fallingstar_source", 0.5, 2, 0.5, "range", 8, "curve", "exp"])).toBe(true);
  await expect.poll(() => slots(page)).toContainEqual(["fallingstar_source", "star1"]);
  await expect.poll(() => logs.some((l) => /star1 fallingstar_source 켜짐/.test(l))).toBe(true);
  // Pd가 끈다
  await fromPd(page, "whistle-source", "star1", ["alive", 0]);
  await expect.poll(() => slots(page)).not.toContainEqual(["fallingstar_source", "star1"]);

  // 게임(디버그 1 키)이 만든다
  await page.keyboard.press("Backquote");
  await page.keyboard.press("Digit1");
  await expect.poll(() => slots(page)).toContainEqual(["fallingstar_source", "fallingstar"]);
  await page.keyboard.press("Digit1");
  await expect.poll(() => slots(page)).not.toContainEqual(["fallingstar_source", "fallingstar"]);

  // 영역 슬롯 이름(vK)으로 규칙을 보내면 그 패치(terrain_plain)의 규칙
  const [, region] = (await slots(page)).find(([patch]) => patch === "terrain_plain")!;
  await fromPd(page, "whistle-source", region, ["curve", "exp"]);
  await expect.poll(() => logs.some((l) => /terrain_plain 공간화 규칙: curve exp/.test(l))).toBe(true);
  expect(pdErrors).toEqual([]);
});
