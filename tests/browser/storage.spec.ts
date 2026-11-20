import { test, expect, type Page } from "@playwright/test";
import { starterWorld, type World } from "../../lib/world";
import { flatTerrain } from "../../lib/terrain";

const STORAGE = "whistle.world.v2";
const LEGACY_STORAGE = "whistle.world.v1";
function savedWorld(): World {
  const world = starterWorld();
  world.title = "보존할 세계";
  world.terrain = flatTerrain(world.size);
  return world;
}
async function open(page: Page, stored?: string, hash = "", key = STORAGE) {
  // Seed only once so a reload cannot hide an accidental overwrite.
  await page.goto(".");
  await expect(page.getByRole("button", { name: "파일 저장", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await page.evaluate(({ key, stored }) => {
    localStorage.clear();
    localStorage.setItem("whistle.language", "ko");
    if (stored !== undefined) localStorage.setItem(key, stored);
  }, { key, stored });
  // Start a new document; changing only the hash would exercise hashchange instead.
  await page.goto("about:blank");
  await page.goto(`./${hash}`);
}
async function storedValue(page: Page, key = STORAGE) {
  return page.evaluate((key) => localStorage.getItem(key), key);
}
async function expectPreserved(page: Page, original: string | null, key = STORAGE) {
  // Observe beyond the 350ms autosave debounce, including subsequent edits.
  await page.waitForTimeout(800);
  expect(await storedValue(page, key)).toBe(original);
}

test("old link data is ignored and cannot replace the saved file", async ({ page }) => {
  const original = JSON.stringify(savedWorld());
  await open(page, original, "#world=invalid");
  await expectPreserved(page, original);
  expect(new URL(page.url()).hash).toBe("");
});

for (const original of ["{broken-json", "", JSON.stringify({ ...savedWorld(), version: 99 })]) {
  test(`unreadable stored data is preserved: ${original.slice(0, 25)}`, async ({ page }) => {
    await open(page, original);
    await expectPreserved(page, original);
    await expect(page.locator(".toast")).toHaveCount(0);
  });
}

test("a failed legacy load preserves the old data and creates no v2 save", async ({ page }) => {
  await open(page, "{broken-legacy", "", LEGACY_STORAGE);
  await expectPreserved(page, "{broken-legacy", LEGACY_STORAGE);
  expect(await storedValue(page)).toBeNull();
});

test("normal loading and editing still autosave", async ({ page }) => {
  await open(page, JSON.stringify(savedWorld()));
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator("[data-cell='0']").click();
  await expect.poll(async () => JSON.parse((await storedValue(page))!).terrain.tiles[0].height).toBe(1);
  expect(JSON.parse((await storedValue(page))!).title).toBe("보존할 세계");
});

test("a first visit creates a save", async ({ page }) => {
  await open(page);
  await expect.poll(() => storedValue(page)).not.toBeNull();
});

test("a valid file import resumes saving after a failed load", async ({ page }) => {
  await open(page, "{broken-json", "#world=invalid");
  const imported = { ...savedWorld(), title: "가져온 세계" };
  await page.locator("input[type=file]").setInputFiles({
    name: "world.whistle.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect.poll(() => storedValue(page)).toBe(JSON.stringify(imported));
  expect(new URL(page.url()).hash).toBe("");
  await page.reload();
  await expect(page.getByRole("button", { name: "파일 저장", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  expect(await storedValue(page)).toBe(JSON.stringify(imported));
});

test("an invalid file import does not unlock autosave after a failed load", async ({ page }) => {
  await open(page, "{broken-json");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{}"),
  });
  await expectPreserved(page, "{broken-json");
});

test("explicitly starting over resumes saving after a failed load", async ({ page }) => {
  await open(page, "{broken-json", "#world=invalid");
  await page.getByRole("button", { name: "다시 시작", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "다시 시작", exact: true }).click();
  await expect.poll(() => storedValue(page)).not.toBe("{broken-json");
  expect(JSON.parse((await storedValue(page))!).terrain).toBeDefined();
  expect(new URL(page.url()).hash).toBe("");
});

test("files larger than 6 MB load without a total size cap", async ({ page }) => {
  await open(page, JSON.stringify(savedWorld()));
  const imported = { ...savedWorld(), title: "큰 파일" };
  await page.locator("input[type=file]").setInputFiles({
    name: "large.whistle.json", mimeType: "application/json",
    buffer: Buffer.from(" ".repeat(6_000_001) + JSON.stringify(imported)),
  });
  await expect.poll(() => storedValue(page)).toBe(JSON.stringify(imported));
});
