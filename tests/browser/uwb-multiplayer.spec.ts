// UWB 다중 플레이어: 수신기(가상 태그 4개) → 키오스크가 맵을 보내고 태그를 표시 → 플레이어 페이지가 맵을 받아 스스로 오디오를 켠다.
import { test, expect, chromium, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { HEARTBEAT_FRAME, LINK_TIMEOUT_MS } from "../../lib/uwb/protocol";
import { createLabWorld } from "../../uwb-lab/world";
import { probeOutputGain, outputGain } from "./pd-probe";

const WS_PORT = 5294, UDP_PORT = 5295;
const bridgeUrl = `ws://127.0.0.1:${WS_PORT}`;

test.setTimeout(180_000);
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] } });
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

test("T0 and T1 resume audio after socket closure or silent connection loss, but stay connected across tag silence", async ({ context, baseURL }) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("Missing test server address");
  const bridge = `ws://127.0.0.1:${address.port}`;
  const world = createLabWorld();
  world.weather = "rain";
  const map = JSON.stringify({ type: "world", world, mapping: { originX: 0, originZ: 0, width: 6, depth: 6, rotation: 0 } });
  const positionClients = new Set<WebSocket>();
  let accepting = true, rejected = 0, silentTag = -1;
  const seq = [10000, 10000];
  let silentConnection: WebSocket | undefined;
  const subscriptions = new Map<WebSocket, string>();
  server.on("connection", (socket, req) => {
    if (req.url === "/world") { socket.send(map); return; }
    if (!accepting) { rejected++; socket.terminate(); return; }
    const query = new URL(req.url!, bridge).searchParams;
    if (query.get("heartbeat") === "1") subscriptions.set(socket, query.get("player")!);
    positionClients.add(socket);
    socket.on("close", () => { positionClients.delete(socket); subscriptions.delete(socket); });
  });
  const timer = setInterval(() => {
    for (const tag of [0, 1]) {
      if (tag === silentTag) continue;
      const frame = JSON.stringify({ type: "position", tagId: String(tag), seq: ++seq[tag], receivedAt: Date.now(),
        x: tag ? 5 : 1, z: 3, boardHeight: 1.2, residual: 0, anchors: 4, heightSource: "fixed" });
      for (const ws of positionClients) {
        if (ws !== silentConnection && subscriptions.get(ws) === String(tag) && ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    }
    for (const ws of subscriptions.keys()) {
      if (ws !== silentConnection && ws.readyState === WebSocket.OPEN) ws.send(HEARTBEAT_FRAME);
    }
  }, 100);
  try {
    const players = [];
    for (const tag of [0, 1]) {
      const previous = new Set(positionClients);
      const page = await context.newPage();
      await probeOutputGain(page);
      await page.goto(`${baseURL}player/?tag=${tag}&bridge=${encodeURIComponent(bridge)}`);
      await expect(page.locator("#player-device")).toContainText(`태그 ${tag} 수신 중`);
      await expect(page.locator("#audio-status")).toHaveText("오디오 실행 중", { timeout: 60_000 });
      await expect.poll(() => masterRms(page), { timeout: 15_000 }).toBeGreaterThan(0.00001);
      const socket = [...positionClients].find(ws => !previous.has(ws));
      if (!socket) throw new Error("Missing player position socket");
      players.push({ page, socket, origin: await page.evaluate(() => performance.timeOrigin) });
    }
    for (const [tag, { page, socket, origin }] of players.entries()) {
      const other = players[1 - tag].page;
      accepting = false;
      rejected = 0;
      silentTag = tag;
      if (tag === 0) socket.terminate();
      else {
        await expect(page.locator("#player-device")).toContainText("1초 이상");
        await new Promise(resolve => setTimeout(resolve, LINK_TIMEOUT_MS + 200));
        expect(rejected).toBe(0);
        expect(await outputGain(page)).toBe(0);
        silentConnection = socket;
      }
      await expect(page.locator("#player-device")).toContainText("자동 재연결", { timeout: LINK_TIMEOUT_MS + 4000 });
      await expect.poll(() => outputGain(page)).toBe(0);
      await expect.poll(() => masterRms(page)).toBeLessThan(0.000001);
      await expect.poll(() => rejected, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
      await expect.poll(() => masterRms(other)).toBeGreaterThan(0.00001);
      accepting = true;
      await expect(page.locator("#player-device")).toContainText(`태그 ${tag} 데이터 대기`);
      expect(await outputGain(page)).toBe(0);
      seq[tag] = 0;
      silentTag = -1;
      await expect(page.locator("#player-device")).toContainText(`태그 ${tag} 수신 중`);
      await expect.poll(() => masterRms(page), { timeout: 15_000 }).toBeGreaterThan(0.00001);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
      const reason = tag === 0 ? "PC 수신기 연결 끊김" : "PC 수신기 응답 없음";
      await page.getByText("최근 연결 기록", { exact: true }).click();
      await expect(page.locator("details").first()).toContainText(reason);
      await expect(page.locator("details").first().locator("li").last()).toContainText("첫 좌표 수신");
      await page.reload();
      await expect(page.locator("#player-device")).toContainText(`태그 ${tag} 수신 중`);
      await expect(page.locator("details").first()).toContainText(reason);
    }
  } finally {
    clearInterval(timer);
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

function masterRms(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { outputProbe?: GainNode; masterAnalyser?: AnalyserNode };
    if (!w.outputProbe) return 0;
    if (!w.masterAnalyser) {
      w.masterAnalyser = w.outputProbe.context.createAnalyser();
      w.outputProbe.connect(w.masterAnalyser);
    }
    const wave = new Float32Array(w.masterAnalyser.fftSize);
    w.masterAnalyser.getFloatTimeDomainData(wave);
    return Math.sqrt(wave.reduce((sum, value) => sum + value * value, 0) / wave.length);
  });
}
