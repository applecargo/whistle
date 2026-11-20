import { test, expect } from "@playwright/test";

test.setTimeout(60_000);

test("AudioContext 하나에서 패치 두 개를 동시에 실행하고 믹스한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => {
    const state = window as typeof window & { probe: { contexts: number; initialize: number; run: number } };
    state.probe = { contexts: 0, initialize: 0, run: 0 };
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) { super(options); state.probe.contexts++; }
    };
  });
  // 테스트에서만 런타임을 감싸 호출 횟수를 센다(앱 코드에는 계측을 넣지 않는다).
  await page.route("**/audio-test/webpd-runtime.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const originalInitialize = WebPdRuntime.initialize;
      WebPdRuntime.initialize = (context) => { window.probe.initialize++; return originalInitialize(context); };
      const originalRun = WebPdRuntime.run;
      WebPdRuntime.run = (...args) => { window.probe.run++; return originalRun(...args); };
    ` });
  });

  await page.goto("audio-lab/soundscape.html");
  await page.getByRole("button", { name: "오디오 시작" }).click();
  await expect(page.locator("#status")).toContainText("running");

  const add = page.getByRole("button", { name: "추가" });
  // 채널별 최근 1초 peak를 일정 시간 동안 읽어 최대값을 구한다(terrain_clock은 간헐적).
  const levels = async () => {
    let l = 0, r = 0;
    for (let i = 0; i < 16; i++) {
      const text = await page.locator("#meter").textContent() ?? "";
      l = Math.max(l, Number(/L ([\d.]+)/.exec(text)?.[1] ?? 0));
      r = Math.max(r, Number(/R ([\d.]+)/.exec(text)?.[1] ?? 0));
      await page.waitForTimeout(250);
    }
    return { l, r };
  };

  // 하나만 왼쪽 끝으로: 오른쪽 채널은 무음이어야 한다.
  await page.locator("#pan").fill("-1");
  await add.click();
  await expect(page.locator("#status")).toContainText("패치 1개");
  const left = await levels();
  expect(left.l).toBeGreaterThan(0.001);
  expect(left.r).toBeLessThan(0.0001);

  // 두 번째를 오른쪽 끝에: 양쪽 모두 소리가 난다(하나의 마스터로 믹스).
  await page.locator("#pan").fill("1");
  await add.click();
  await expect(page.locator("#status")).toContainText("패치 2개");
  const both = await levels();
  expect(both.l).toBeGreaterThan(0.001);
  expect(both.r).toBeGreaterThan(0.001);

  const probe = await page.evaluate(() => (window as unknown as { probe: object }).probe);
  expect(probe).toEqual({ contexts: 1, initialize: 1, run: 2 });

  await page.getByRole("button", { name: "제거" }).first().click();
  await expect(page.locator("#status")).toContainText("패치 1개");
  await page.getByRole("button", { name: "오디오 종료" }).click();
  await expect(page.locator("#status")).toHaveText("시작 전");
  expect(errors).toEqual([]);
});
