import { test, expect, type Page } from "@playwright/test";

test.setTimeout(90_000);

/** 채널별 최근 1초 peak를 일정 시간 읽어 최대값을 구한다(terrain_clock은 간헐적). */
async function levels(page: Page) {
  let l = 0, r = 0;
  for (let i = 0; i < 16; i++) {
    const text = await page.locator("#meter").textContent() ?? "";
    l = Math.max(l, Number(/L ([\d.]+)/.exec(text)?.[1] ?? 0));
    r = Math.max(r, Number(/R ([\d.]+)/.exec(text)?.[1] ?? 0));
    await page.waitForTimeout(250);
  }
  return { l, r };
}

async function open(page: Page, query = "") {
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

  await page.goto(`audio-lab/soundscape.html${query}`);
  await page.getByRole("button", { name: "오디오 시작" }).click();
  await expect(page.locator("#status")).toContainText("running");
  return errors;
}

/** 평면도 320px = 24m, 가운데가 리스너. (80, 160)px = x −6m, z 0m → 리스너의 정확히 왼쪽(−Z를 바라볼 때). */
const LEFT = { x: 80, y: 160 };
async function turn(page: Page, degrees: number) {
  await page.locator("#yaw").evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input"));
  }, degrees);
  await page.waitForTimeout(1200); // 이전 방향의 peak 표시 유지 시간(1초)이 지나도록
}

test("기하: equalpower에서 정확히 왼쪽의 소리는 R이 무음, 뒤로 돌면 L이 무음", async ({ page }) => {
  const errors = await open(page); // 기본값 equalpower
  await page.locator("#map").click({ position: LEFT });
  await expect(page.locator("#sources")).toContainText("active");
  const facingNorth = await levels(page);
  expect(facingNorth.l).toBeGreaterThan(0.001);
  expect(facingNorth.r).toBeLessThan(0.0001);
  await turn(page, 180);
  const facingSouth = await levels(page);
  expect(facingSouth.r).toBeGreaterThan(0.001);
  expect(facingSouth.l).toBeLessThan(0.0001);
  expect(errors).toEqual([]);
});

test("엔진(HRTF): 소스 2개를 같은 컨텍스트에서 돌리며, 끄면 fade 후 정리된다", async ({ page }) => {
  const errors = await open(page, "?panning=hrtf");
  await expect(page.locator("#status")).toContainText("HRTF");

  await page.locator("#map").click({ position: LEFT });
  await expect(page.locator("#sources")).toContainText("active");
  // 방향의 정확성은 위 equalpower 테스트가 본다. HRTF는 저음의 좌우 음량차가 작아
  // peak로는 방향을 판정할 수 없으므로(방향감은 주로 도달 시간차) 소리가 나는지만 본다.
  expect((await levels(page)).l).toBeGreaterThan(0.001);

  // 두 번째 소스(오른쪽 앞)를 더해도 같은 컨텍스트·같은 초기화.
  await page.locator("#map").click({ position: { x: 240, y: 100 } });
  await expect(page.locator("#status")).toContainText("오디오 노드 2개");
  await expect(page.locator("#sources")).not.toContainText("loading");
  expect(await page.evaluate(() => (window as unknown as { probe: object }).probe))
    .toEqual({ contexts: 1, initialize: 1, run: 2 });

  // 둘 다 끄면 fade 후 노드가 정리되고 무음이 된다.
  // 누르면 "켜기"로 바뀌므로 매번 첫 번째 "끄기"를 누른다.
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "끄기" }).first().click();
  await expect(page.locator("#status")).toContainText("오디오 노드 0개");
  await expect(page.locator("#status")).toContainText("등록 2개");
  await page.waitForTimeout(1200);
  expect(await levels(page)).toEqual({ l: 0, r: 0 });

  // 다시 켜면 새로 로드한다.
  await page.getByRole("button", { name: "켜기" }).first().click();
  await expect(page.locator("#status")).toContainText("오디오 노드 1개");

  await page.getByRole("button", { name: "오디오 종료" }).click();
  await expect(page.locator("#status")).toHaveText("시작 전");
  expect(errors).toEqual([]);
});
