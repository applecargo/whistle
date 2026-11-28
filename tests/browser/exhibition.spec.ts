import { test, expect } from "@playwright/test";
import { createSocket } from "node:dgram";
import { startBridge } from "../../scripts/uwb/bridge";
import { distanceTo } from "../../lib/uwb/solver";
import { config, data, setup } from "./uwb-device-fixture";
import { outputGain, probeOutputGain } from "./pd-probe";
import { PREVIEW_CHANNEL } from "../../kiosk/useEditorPreview";
import { LIVE_WORLD_CHANNEL } from "../../lib/live-world";
import { createLabWorld } from "../../uwb-lab/world";

test.use({
  viewport: { width: 480, height: 300 },
  launchOptions: { args: [
    ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
    "--enable-unsafe-swiftshader", "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  ] },
});

test("the exhibition picker offers four views and matching UWB placements", async ({ page }) => {
  await page.goto("./?display=monitors");
  const views = ["M1", "M2", "M3", "M4"];
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
  await probeOutputGain(lab);
  const device = await setup(lab, { exhibition: true });
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
    await expect.poll(() => outputGain(lab)).toBe(1);
    device.move({ x: 1.5, z: 2.45, boardHeight: 1.2 });
    await expect.poll(yaw, { timeout: 20000 }).toBeLessThan(-2);
    expect(await canvas.getAttribute("data-subject")).toBe(initialSubject);
    device.pause();
    await expect(lab.locator("#device-status")).toContainText("1초 이상");
    await expect.poll(async () => Math.abs(await yaw()), { timeout: 15000 }).toBeLessThan(.45);
    await expect.poll(() => outputGain(lab)).toBe(0);
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

test("all nine fragments render and both sides of a crossed boundary show the visitor trail", async ({ page, context }) => {
  test.setTimeout(120_000);
  const world = createLabWorld();
  world.timeOfDay = "noon";
  await page.addInitScript(world => localStorage.setItem("whistle.world.v2", JSON.stringify(world)), world);
  await page.goto("./kiosk/");
  const picker = page.getByRole("link", { name: "전시 화면" });
  await expect(picker).toHaveAttribute("href", /\/whistle\/\?display=monitors&bridge=/);

  const screen = await context.newPage();
  const errors: string[] = [];
  screen.on("pageerror", error => errors.push(error.message));
  screen.on("console", message => {
    if (/shader error|VALIDATE_STATUS.*false|context lost/i.test(message.text())) errors.push(message.text());
  });
  const canvas = screen.locator("canvas");
  const open = async (display: string) => {
    await screen.goto(`./?display=${display}`);
    await expect(canvas).toHaveAttribute("data-ready", "true");
  };
  const colors = async () => {
    const png = await canvas.screenshot();
    return screen.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      let trail = 0, landscape = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 130 && data[i] > data[i + 1] * 1.8 && data[i] > data[i + 2] * 2) trail++;
        if (Math.abs(data[i] - data[0]) > 12) landscape++;
      }
      image.close();
      return { trail, landscape };
    }, png.toString("base64"));
  };

  for (const id of ["A1", "B1", "C1", "A2", "B2", "C2", "A3", "B3", "C3"]) {
    await open(id);
    await expect(screen.getByRole("img", { name: id, exact: true })).toBeVisible();
    const pixels = await colors();
    expect(pixels.landscape, id).toBeGreaterThan(100);
    expect(pixels.trail, id).toBe(0);
  }
  for (const id of ["M1", "M2", "M3", "M4"]) {
    await open(id);
    await expect(canvas).toHaveAttribute("data-subject", /.+/);
  }

  const lab = await context.newPage();
  await lab.goto("./uwb-lab/index.html?exhibition=1");
  await expect(lab.locator("#live-status")).toContainText("연결되었습니다");
  await lab.getByLabel("관객 X (m)").fill("3");
  const z = lab.getByLabel("관객 Z (m)");
  await z.fill("4.2");
  await z.fill("3.8");
  for (const id of ["B3", "B2"]) {
    await open(id);
    await expect.poll(async () => (await colors()).trail, { message: id }).toBeGreaterThan(5);
  }
  expect(errors).toEqual([]);
});

test("a walk in the main game reaches the matching tile in a late fragment window", async ({ page, context }) => {
  await page.addInitScript(world => localStorage.setItem("whistle.world.v2", JSON.stringify(world)), createLabWorld());
  await page.goto("./");
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  const player = page.locator(".play-shell canvas");
  await expect(player).toHaveAttribute("data-ready", "true");
  await page.keyboard.down("KeyW");
  try {
    await expect.poll(async () => Number(await player.getAttribute("data-player-z"))).toBeLessThan(9);
  } finally { await page.keyboard.up("KeyW"); }
  const screen = await context.newPage();
  await screen.goto("./?display=B3");
  await expect(screen.getByRole("img", { name: "B3" }).locator("canvas")).toHaveAttribute("data-ready", "true");
  const segments = await screen.evaluate(channelName => new Promise<{ x: number; z: number; endZ: number }[]>(resolve => {
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = ({ data }) => {
      if (data.type !== "world") return;
      channel.close();
      resolve(data.trail);
    };
    channel.postMessage({ type: "request" });
  }), LIVE_WORLD_CHANNEL);
  expect(segments.some(s => Math.abs(s.x - 6) < .1 && s.z <= 10 && s.endZ < s.z && s.endZ > 7.5)).toBe(true);
});

test("a separate M1 profile follows kiosk edits and UDP positions and restores the latest map on restart", async ({ page, browser, baseURL }) => {
  test.setTimeout(60_000);
  const bridge = await startBridge(config, { wsPort: 0, udpPort: 0, log: () => {} });
  const address = `ws://127.0.0.1:${bridge.wsPort}`;
  const udp = createSocket("udp4");
  const display = await browser.newContext({ baseURL, locale: "ko-KR", viewport: { width: 480, height: 300 } });
  const world = createLabWorld();
  world.assets.push(
    { id: "caption", name: "Hidden caption", text: "caption", shape: "bar", color: "#333333", solid: false },
    { id: "recording", name: "Hidden recording", shape: "sphere", color: "#333333", solid: false,
      sound: { data: "data:audio/wav;base64,AAAA", duration: 1, radius: 4, volume: 1, mode: "loop" } },
  );
  world.objects = [
    { id: "caption-1", asset: "caption", x: 2, z: 1, scale: 1, rotation: 0 },
    { id: "sound-1", asset: "recording", x: 3, z: 1, scale: 1, rotation: 0 },
  ];
  world.connectionFootings = [{ id: "old-connection", side: 1, row: 4, built: true, created: 1 }];
  for (const tile of world.terrain!.tiles) tile.surface = "plain";
  world.terrain!.tiles[0].surface = "rough";
  let seq = 0, x = 1.6;
  const timer = setInterval(() => {
    const point = { x, z: 1.3, boardHeight: 1.2 };
    udp.send(JSON.stringify({ type: "ranges", tagId: "0", seq: ++seq,
      ranges: config.anchors.map(a => ({ anchorId: a.id, distance: distanceTo(point, a) })) }), bridge.udpPort, "127.0.0.1");
  }, 100);
  try {
    await page.addInitScript(({ world, address }) => {
      localStorage.setItem("whistle.world.v2", JSON.stringify(world));
      localStorage.setItem("whistle.kiosk.v1", JSON.stringify({ bridge: address, mapping: { originX: 0, originZ: 0, width: 6, depth: 6, rotation: 0 } }));
    }, { world, address });
    await page.goto("./kiosk/");
    await expect(page.locator("[data-kiosk-world]")).toHaveAttribute("data-kiosk-world", "connected");
    await expect(page.locator("[data-symbol-site], [data-connection], [data-approach]")).toHaveCount(0);
    await expect(page.locator('[data-cell="14"]')).not.toHaveAccessibleName(/Hidden caption/);
    await page.locator('[data-cell="15"]').click({ button: "right" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const broadcast = await page.evaluate(address => new Promise<{ world: typeof world }>(resolve => {
      const socket = new WebSocket(new URL("/world", address));
      socket.onmessage = event => { socket.close(); resolve(JSON.parse(event.data)); };
    }), address);
    expect(broadcast.world.objects).toEqual(world.objects);
    expect(broadcast.world.assets.find(asset => asset.id === "recording")?.sound).toEqual(world.assets.at(-1)!.sound);
    const menu = await page.getByRole("link", { name: "전시 화면" }).getAttribute("href");
    const screen = await display.newPage();
    await screen.goto(menu!);
    const m1 = await screen.getByRole("link", { name: "M1", exact: true }).getAttribute("href");
    const url = new URL(m1!, screen.url());
    expect(url.searchParams.get("bridge")).toBe(address);
    await screen.goto(url.href);
    const canvas = screen.locator("canvas");
    await expect(canvas).toHaveAttribute("data-subject", "stone-0");
    const yaw = () => canvas.getAttribute("data-sector-yaw").then(Number);
    await expect.poll(yaw).toBeGreaterThan(2);
    x = .4;
    await expect.poll(yaw).toBeLessThan(-2);
    await page.getByRole("button", { name: "흐름", exact: true }).click();
    // M1 at (1, .8) metres is nearest to grid cell (2, 1).
    await page.locator('[data-cell="14"]').click();
    await expect(canvas).toHaveAttribute("data-subject", "water-14");
    const calibrated = new URL("./monitor-proximity/", url);
    calibrated.search = url.search;
    for (const [key, value] of Object.entries({ framing: "default", mx: "4", mz: ".8", face: "0" }))
      calibrated.searchParams.set(key, value);
    await screen.goto(calibrated.href);
    await expect(canvas).toHaveAttribute("data-subject", "water-14");
    await expect.poll(async () => Math.abs(await yaw())).toBeLessThan(.45);
    x = 4.6;
    await expect.poll(yaw).toBeGreaterThan(2);
    expect(await canvas.getAttribute("data-subject")).toBe("water-14");
    clearInterval(timer);
    await expect.poll(async () => Math.abs(await yaw()), { timeout: 15000 }).toBeLessThan(.45);
    await screen.close();
    const reopened = await display.newPage();
    await reopened.goto(url.href);
    await expect(reopened.locator("canvas")).toHaveAttribute("data-subject", "water-14");
    await page.locator('[data-cell="14"]').click();
    await expect(reopened.locator("canvas")).toHaveAttribute("data-subject", "stone-0");
  } finally {
    clearInterval(timer);
    udp.close();
    await display.close();
    await bridge.close();
  }
});

test("Windows kiosk channels show the editor and its live 3D overview separately", async ({ page, context }) => {
  const bridge = await startBridge(config, { wsPort: 0, udpPort: 0, log: () => {} });
  try {
    await context.addInitScript(port => {
      localStorage.setItem("whistle.kiosk.v1", JSON.stringify({ bridge: `ws://127.0.0.1:${port}`,
        mapping: { originX: 0, originZ: 0, width: 6.8, depth: 7.2, rotation: 0 } }));
    }, bridge.wsPort);
    await page.setViewportSize({ width: 1280, height: 720 });
    const scene = await context.newPage();
    await scene.goto("./kiosk/?channel=scene");
    await expect(scene.getByRole("status")).toHaveText("키오스크 맵 수신 대기 중");
    await page.goto("./kiosk/?channel=editor");
    await expect(page.locator(".world-grid [data-cell]")).toHaveCount(144);
    await expect(page.locator(".kiosk-panel")).toBeHidden();
    await expect(page.locator("[data-kiosk-positions]")).toHaveAttribute("data-kiosk-positions", "connected");
    const point = { x: 1, z: 2, boardHeight: 1.2 };
    const udp = createSocket("udp4");
    try {
      const ranges = config.anchors.map(a => ({ anchorId: a.id, distance: distanceTo(point, a) }));
      await new Promise<void>((resolve, reject) => udp.send(JSON.stringify({ type: "ranges", tagId: "0", seq: 1, ranges }),
        bridge.udpPort, "127.0.0.1", err => err ? reject(err) : resolve()));
      await expect(page.locator('[data-kiosk-player="0"]')).toBeVisible();
    } finally { udp.close(); }
    for (const viewport of [{ width: 2560, height: 1600 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(viewport);
      const grid = (await page.locator(".world-grid").boundingBox())!;
      expect(Math.abs(grid.x + grid.width / 2 - viewport.width / 2)).toBeLessThan(1);
      expect(Math.abs(grid.y + grid.height / 2 - viewport.height / 2)).toBeLessThan(1);
    }
    await expect(page.locator(".topbar, .live-preview, canvas")).toHaveCount(0);
    await expect(scene.locator("canvas")).toHaveAttribute("data-ready", "true");
    await expect(scene.getByRole("button")).toHaveCount(0);
    await expect(scene.getByRole("main", { name: "편집기 미리보기" })).toBeVisible();
    const reaction = scene.evaluate(name => new Promise<number[]>(resolve => {
      const channel = new BroadcastChannel(name);
      channel.onmessage = ({ data }) => {
        if (data.type === "preview" && data.state?.feedback) {
          channel.close();
          resolve(data.state.feedback.cells.map((cell: { index: number }) => cell.index));
        }
      };
    }), PREVIEW_CHANNEL);
    await page.getByRole("button", { name: "흐름", exact: true }).click();
    await page.locator('[data-cell="65"]').click();
    expect(await reaction).toContain(65);
    await scene.reload();
    await expect(scene.getByRole("main", { name: "편집기 미리보기" })).toBeVisible();
    await expect(scene.locator("canvas")).toHaveAttribute("data-ready", "true");
    await page.close();
    await expect(scene.getByRole("main", { name: "전시장 3D" })).toBeVisible();
    await expect(scene.locator("canvas")).toHaveAttribute("data-ready", "true");
  } finally { await bridge.close(); }
});

test("M2 grass speeds up near either side of the screen and settles after departure or signal loss", async ({ page }) => {
  test.setTimeout(60000);
  const world = createLabWorld();
  const mapping = { originX: 0, originZ: 0, width: 6, depth: 6, rotation: 0 };
  let x = 5, active = true, seq = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  await page.routeWebSocket("ws://127.0.0.1:5299/**", socket => {
    if (new URL(socket.url()).pathname === "/world") {
      socket.send(JSON.stringify({ type: "world", world, mapping }));
      return;
    }
    timer = setInterval(() => {
      if (!active) return;
      socket.send(JSON.stringify({ type: "position", tagId: "1", x, z: 2.9, boardHeight: 1.2,
        anchors: 3, heightSource: "fixed", residual: 0, receivedAt: Date.now(), seq: ++seq }));
    }, 80);
  });
  try {
    for (const tile of world.terrain!.tiles) tile.surface = "soft";
    await page.goto("./monitor-proximity/?display=M2&mx=2&mz=3&face=0&bridge=ws://127.0.0.1:5299");
    const canvas = page.locator("canvas");
    await expect(canvas).toHaveAttribute("data-subject", /^grass-/);
    const speed = () => canvas.getAttribute("data-grass-speed").then(Number);
    await expect.poll(speed).toBe(1);
    x = 2.2;
    await expect.poll(speed).toBeGreaterThan(1.28);
    x = 5;
    await expect.poll(speed, { timeout: 10000 }).toBeLessThan(1.02);
    x = 2.2;
    await expect.poll(speed).toBeGreaterThan(1.28);
    active = false;
    await expect.poll(speed, { timeout: 12000 }).toBeLessThan(1.02);
  } finally { clearInterval(timer); }
});
