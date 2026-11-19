import { expect, test } from "@playwright/test";

test("a reader can return their walk to the author's shelf without sharing browser storage", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const reader = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 640, height: 480 },
  });
  try {
    await page.goto("./?zine");
    await page.getByRole("button", { name: "＋ 새 면", exact: true }).click();
    await page.getByRole("button", { name: "건네기 ↗" }).click();
    await page.getByLabel("면의 이름").fill("산책 면");
    await page
      .getByLabel("연주할 사람에게 남기는 한 줄")
      .fill("물가까지 걸어 주세요.");
    await page.getByRole("button", { name: "이 면의 링크 만들기 ↗" }).click();
    const received = await reader.newPage();
    await received.goto(
      await page.getByLabel("면 링크", { exact: true }).inputValue(),
    );
    await expect(received.getByRole("blockquote")).toHaveText(
      "물가까지 걸어 주세요.",
    );
    await received.getByRole("button", { name: "연주하기 →" }).click();
    await expect(received.locator(".play-shell canvas")).toBeVisible();
    await received
      .locator(".play-shell canvas")
      .click({ position: { x: 100, y: 100 } });
    await received.keyboard.down("w");
    // Wait for movement frames even when headless WebGL compiles slowly.
    await received.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let remaining = 32;
          const tick = () => {
            if (--remaining === 0) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    await received.keyboard.up("w");
    await received.getByRole("button", { name: "연주 마치기" }).click();
    await received.getByRole("button", { name: "흔적 면 돌려주기 ↗" }).click();
    const reply = await received
      .getByLabel("면 링크", { exact: true })
      .inputValue();
    const fields = new URL(reply).hash.slice(1);
    expect(
      JSON.parse(new URLSearchParams(fields).get("walk")!).length,
    ).toBeGreaterThan(1);
    await page.goto(reply);
    await page.getByRole("button", { name: "내 진에 끼우기 ＋" }).click();
    await expect(page.locator(".z-shelf-item")).toHaveCount(3);
    await page.goto(reply);
    await page
      .getByRole("button", { name: "내 진 펼치기", exact: true })
      .click();
    await expect(page.locator(".z-shelf-item")).toHaveCount(3);
  } finally {
    await reader.close();
  }
});
