import { createSocket } from "node:dgram";
import { WebSocketServer, WebSocket } from "ws";
import { MAX_PACKET_BYTES, TRACKING_TIMEOUT_MS, parseRanges, type BridgeMessage, type PositionMessage, type RangePacket } from "../../lib/uwb/protocol.ts";
import { parseMakerfabs } from "./input.ts";
import { solvePosition, type BridgeConfig } from "../../lib/uwb/solver.ts";
import { MAX_WORLD_BYTES, WORLD_PATH, parseWorldLink } from "../../lib/uwb/world-link.ts";

export function createProcessor(config: BridgeConfig, publish: (message: BridgeMessage) => void, rangesOnly = false) {
  const states = new Map<string, { inputSeq: number; lastInput: number; point: PositionMessage | null }>();
  let seq = 0;
  return (packet: RangePacket, orderedSerial = false, now = Date.now()) => {
    if (!config.tags.includes(packet.tagId)) return;
    const previous = states.get(packet.tagId);
    const fresh = previous && now - previous.lastInput < TRACKING_TIMEOUT_MS;
    if (fresh && (orderedSerial ? packet.seq === previous.inputSeq : packet.seq <= previous.inputSeq)) {
      previous.lastInput = now;
      return;
    }
    const state = { inputSeq: packet.seq, lastInput: now,
      point: previous?.point && now - previous.point.receivedAt < TRACKING_TIMEOUT_MS ? previous.point : null };
    states.set(packet.tagId, state);
    if (rangesOnly) {
      publish({ type: "ranges", tagId: packet.tagId, seq: ++seq, receivedAt: now, ranges: packet.ranges });
      return;
    }
    try {
      const point = solvePosition(packet.ranges, config);
      const alpha = state.point && config.smoothingMs ? 1 - Math.exp(-(now - state.point.receivedAt) / config.smoothingMs) : 1;
      const message: PositionMessage = { type: "position", tagId: packet.tagId, seq: ++seq, receivedAt: now,
        ...point, heightSource: config.mode === "2d" ? "fixed" : "uwb" };
      if (state.point) for (const axis of ["x", "z", "boardHeight"] as const) message[axis] = state.point[axis] + alpha * (point[axis] - state.point[axis]);
      state.point = message;
      publish(message);
    } catch (error) {
      state.point = null;
      publish({ type: "invalid", tagId: packet.tagId, seq: ++seq, error: (error as Error).message });
    }
  };
}

export async function startBridge(config: BridgeConfig, options: {
  wsPort?: number; wsHost?: string; udpPort?: number; udpHost?: string; log?: (message: string) => void; rangesOnly?: boolean;
} = {}) {
  const log = options.log ?? console.log;
  // wsHost: 기본은 이 PC만(127.0.0.1). 0.0.0.0이면 공유기의 다른 PC(플레이어)도 붙는다.
  // 페이지 출처는 이 PC(localhost) 또는 수신기에 접속한 주소와 같은 호스트(키오스크 PC의 개발 서버)만 받는다.
  const server = new WebSocketServer({ host: options.wsHost ?? "127.0.0.1", port: options.wsPort ?? 5194, maxPayload: MAX_WORLD_BYTES,
    verifyClient: ({ origin, req }: { origin: string; req: { headers: { host?: string } } }) => {
      if (!origin) return true;
      try {
        const from = new URL(origin).hostname, host = new URL(`http://${req.headers.host ?? ""}`).hostname;
        return ["127.0.0.1", "localhost", "[::1]"].includes(from) || from === host;
      } catch { return false; }
    },
  });
  // 맵 길(WORLD_PATH, lib/uwb/world-link.ts): 키오스크가 보낸 마지막 맵을 들고 있다가 다른 접속에 돌린다
  const worldClients = new Set<WebSocket>();
  let lastWorld: string | undefined;
  const udp = createSocket("udp4");
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const client of server.clients) client.terminate();
    await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => { try { udp.close(() => resolve()); } catch { resolve(); } })]);
  };
  try {
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    await new Promise<void>((resolve, reject) => {
      udp.once("error", reject);
      udp.bind(options.udpPort ?? 5195, options.udpHost ?? "127.0.0.1", resolve);
    });
  } catch (error) { await close(); throw error; }
  server.on("connection", (client, req) => {
    client.on("error", () => client.terminate());
    if (new URL(req.url ?? "/", "http://x").pathname !== WORLD_PATH) {
      // 위치 길: 받는 것만 한다(작은 패킷만)
      client.on("message", () => client.terminate());
      return;
    }
    worldClients.add(client);
    client.on("close", () => worldClients.delete(client));
    if (lastWorld) client.send(lastWorld);
    client.on("message", (data, binary) => {
      try {
        const text = data.toString();
        if (binary) throw new Error("글자 메시지만 받습니다.");
        parseWorldLink(text);
        lastWorld = text;
        for (const other of worldClients) if (other !== client && other.readyState === WebSocket.OPEN) other.send(text);
      } catch (error) { log(`맵 무시: ${(error as Error).message}`); }
    });
  });
  server.on("error", (error) => log(`WebSocket 오류: ${error.message}`));
  udp.on("error", (error) => log(`UDP 오류: ${error.message}`));
  const receive = createProcessor(config, (message) => {
    const json = JSON.stringify(message);
    for (const client of server.clients) {
      if (worldClients.has(client)) continue;
      if (client.bufferedAmount > MAX_PACKET_BYTES * 4) { client.terminate(); continue; }
      if (client.readyState === WebSocket.OPEN) client.send(json);
    }
  }, options.rangesOnly);
  const lastRaw = new Map<string, { seq: number; time: number }>();
  let lastWarning = -Infinity;
  udp.on("message", (buffer) => {
    try {
      if (buffer.length > MAX_PACKET_BYTES) throw new Error("UDP 패킷이 너무 큽니다.");
      const text = buffer.toString().trimEnd();
      if (!text.startsWith("AT+RANGE=")) {
        receive(parseRanges(text));
        return;
      }
      if (/[\r\n]/.test(text)) throw new Error("한 UDP 패킷에는 거리 보고 한 줄만 허용합니다.");
      const packet = parseMakerfabs(text);
      if (!packet || !config.tags.includes(packet.tagId)) return;
      if (packet.seq > 255) throw new Error("Makerfabs seq 범위 오류");
      const now = Date.now();
      const last = lastRaw.get(packet.tagId);
      if (last && now - last.time < TRACKING_TIMEOUT_MS) {
        const delta = (packet.seq - last.seq + 256) % 256;
        if (delta === 0 || delta >= 128) return;
      }
      lastRaw.set(packet.tagId, { seq: packet.seq, time: now });
      receive(packet, true, now);
    } catch (error) {
      if (Date.now() - lastWarning > 1000) { log(`입력 무시: ${(error as Error).message}`); lastWarning = Date.now(); }
    }
  });
  return { wsPort: (server.address() as { port: number }).port, udpPort: udp.address().port, receive, close };
}
