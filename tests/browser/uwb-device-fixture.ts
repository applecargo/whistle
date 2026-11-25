import type { Page } from "@playwright/test";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { startBridge } from "../../scripts/uwb/bridge";
import { parseConfig, distanceTo } from "../../lib/uwb/solver";

const config = parseConfig({ ...JSON.parse(readFileSync("config/uwb.example.json", "utf8")), mode: "3d", smoothingMs: 0 });
export const data = async (page: Page) => JSON.parse((await page.locator("#position-data").textContent())!);
export const messages = async (page: Page) => JSON.parse((await page.locator("#pd-messages").textContent())!);

export async function setup(page: Page, exhibition = false) {
  const bridge = await startBridge(config, { wsPort: 0, udpPort: 0, log: () => {} });
  const udp = createSocket("udp4");
  let seq = 0;
  let active = true;
  let tagId = "0";
  let valid = true;
  let point = { x: 1, z: 3, boardHeight: 1.2 };
  const timer = setInterval(() => {
    if (!active) return;
    udp.send(JSON.stringify({ type: "ranges", tagId, seq: ++seq,
      ranges: valid ? config.anchors.map((a) => ({ anchorId: a.id, distance: distanceTo(point, a) })) : [],
    }), bridge.udpPort, "127.0.0.1");
  }, 100);
  await page.addInitScript(() => Object.defineProperty(window, "devicePixelRatio", { value: 0.5 }));
  await page.goto(exhibition ? "uwb-lab/index.html?exhibition=1" : "uwb-lab/index.html");
  await page.getByRole("radio", { name: "실제 데이터 · PC 수신기", exact: true }).check();
  await page.getByLabel("수신기 주소", { exact: true }).fill(`ws://127.0.0.1:${bridge.wsPort}`);
  return {
    move: (p: typeof point) => { point = p; }, pause: () => { active = false; }, resume: () => { active = true; },
    invalid: () => { valid = false; }, valid: () => { valid = true; }, tag: (id: string) => { tagId = id; },
    stopBridge: bridge.close,
    close: async () => { clearInterval(timer); udp.close(); await bridge.close(); },
  };
}
