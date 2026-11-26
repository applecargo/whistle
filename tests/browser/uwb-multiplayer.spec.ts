// UWB 다중 플레이어: 수신기(가상 태그 4개) → 키오스크가 맵을 보내고 태그를 표시 → 플레이어 페이지가 맵을 받아 스스로 오디오를 켠다.
import { test, expect, chromium } from "@playwright/test";
import { spawn } from "node:child_process";

const WS_PORT = 5294, UDP_PORT = 5295;
const bridgeUrl = `ws://127.0.0.1:${WS_PORT}`;

test.setTimeout(180_000);
test("kiosk sends its map through the bridge, shows four tags, and a player page starts audio on its own", async ({ baseURL }) => {
  const bridge = spawn(process.execPath, ["--experimental-strip-types", "scripts/uwb-bridge.ts", "--simulate",
    "--ws-port", String(WS_PORT), "--udp-port", String(UDP_PORT)], { stdio: "pipe" });
  try {
    await new Promise<void>((resolve, reject) => {
      bridge.stdout.on("data", (d) => { if (String(d).includes("UWB →")) resolve(); });
      bridge.on("exit", (code) => reject(new Error(`bridge exited ${code}`)));
    });
    // 자동 재생 허용으로 띄운다(전시 플레이어 PC의 Chrome 실행과 같은 옵션)
    const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
    try {
      const kiosk = await browser.newPage();
      await kiosk.addInitScript((bridge) => localStorage.setItem("whistle.kiosk.v1",
        JSON.stringify({ bridge, mapping: { originX: 0, originZ: 0, width: 6, depth: 6, rotation: 0 } })), bridgeUrl);
      await kiosk.goto(`${baseURL}kiosk/`);
      await expect(kiosk.locator("[data-kiosk-world]")).toHaveAttribute("data-kiosk-world", "connected", { timeout: 60_000 });
      await expect(kiosk.getByRole("button", { name: "플레이", exact: true })).toBeHidden();
      await expect(kiosk.getByRole("button", { name: "들어가기" })).toHaveCount(0);
      for (const tag of ["0", "1", "2", "3"]) await expect(kiosk.locator(`[data-kiosk-player="${tag}"]`)).toBeVisible({ timeout: 10_000 });

      const player = await browser.newPage();
      const errors: string[] = [];
      player.on("console", (m) => { if (/error:|couldn't create/.test(m.text())) errors.push(m.text()); });
      await player.goto(`${baseURL}player/?tag=1&bridge=${encodeURIComponent(bridgeUrl)}`);
      await expect(player.locator("#player-world")).toContainText("받음", { timeout: 60_000 });
      await expect(player.locator("#audio-status")).toHaveText("오디오 실행 중", { timeout: 120_000 });
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  } finally { bridge.kill(); }
});
