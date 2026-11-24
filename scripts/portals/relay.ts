import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { validateWorld, type World } from "../../lib/world.ts";
import { MAX_PORTAL_WORLD_BYTES, PORTAL_PATH, type PortalMessage, type PortalPeer } from "../../lib/portal-protocol.ts";

type Member = { socket: WebSocket; peer: PortalPeer; world?: World; bytes: number; alive: boolean; joined: number };
type Room = { members: Map<string, Member>; sequence: number };

export function attachPortalRelay(server: EventEmitter) {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PORTAL_WORLD_BYTES + 1024, perMessageDeflate: false });
  let storedBytes = 0;
  const send = (member: Member, message: PortalMessage) => {
    if (member.socket.readyState !== WebSocket.OPEN) return;
    if (member.socket.bufferedAmount > MAX_PORTAL_WORLD_BYTES * 2) { member.socket.terminate(); return; }
    member.socket.send(JSON.stringify(message));
  };
  const broadcast = (room: Room) => {
    const peers = [...room.members.values()].filter(m => m.world).map(m => m.peer);
    for (const member of room.members.values()) send(member, { type: "peers", peers, count: room.members.size });
  };
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try { url = new URL(request.url || "/", "http://localhost"); } catch { socket.destroy(); return; }
    if (url.pathname !== PORTAL_PATH) return;
    const key = url.searchParams.get("room");
    const existing = key ? rooms.get(key) : undefined;
    if (!key || key.length > 512 || (existing?.members.size ?? 0) >= 32 || (!existing && rooms.size >= 32)) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
    }
    wss.handleUpgrade(request, socket, head, ws => {
      const room = existing ?? { members: new Map<string, Member>(), sequence: 0 };
      rooms.set(key, room);
      const id = randomUUID();
      const member: Member = {
        socket: ws, peer: { id, label: `세계 ${++room.sequence}`, title: "", revision: 0 },
        bytes: 0, alive: true, joined: Date.now(),
      };
      room.members.set(id, member);
      send(member, { type: "welcome", id, label: member.peer.label });
      broadcast(room);
      ws.on("pong", () => { member.alive = true; });
      ws.on("error", () => ws.terminate());
      ws.on("message", (data, binary) => {
        if (binary) { ws.close(1003); return; }
        let requestId: string | undefined;
        try {
          const text = data.toString(), bytes = Buffer.byteLength(text);
          const message = JSON.parse(text);
          if (!message || typeof message !== "object") throw Error();
          if (message.type === "publish") {
            if (bytes > MAX_PORTAL_WORLD_BYTES || storedBytes - member.bytes + bytes > 256 * 1024 * 1024) {
              send(member, { type: "error", message: "세계가 너무 커서 포털을 열 수 없습니다." }); return;
            }
            const world = validateWorld(message.world);
            storedBytes += bytes - member.bytes;
            member.bytes = bytes;
            member.world = world;
            member.peer = { ...member.peer, title: world.title, revision: member.peer.revision + 1 };
            send(member, { type: "published" });
            broadcast(room);
          } else if (message.type === "visit") {
            if (typeof message.requestId !== "string" || message.requestId.length > 80) throw Error();
            requestId = message.requestId;
            const target = typeof message.target === "string" ? room.members.get(message.target) : undefined;
            if (!target?.world || target === member) {
              send(member, { type: "error", requestId, message: "이 세계의 접속이 종료되었습니다." }); return;
            }
            send(member, { type: "world", requestId: requestId!, peer: target.peer, world: target.world });
          } else throw Error();
        } catch {
          send(member, { type: "error", requestId, message: "세계 데이터를 읽을 수 없습니다." });
        }
      });
      ws.on("close", () => {
        if (!room.members.delete(id)) return;
        storedBytes -= member.bytes;
        if (!room.members.size) rooms.delete(key);
        else broadcast(room);
      });
    });
  };
  server.on("upgrade", upgrade);
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) for (const member of room.members.values()) {
      if (!member.alive || (!member.world && Date.now() - member.joined > 30_000)) { member.socket.terminate(); continue; }
      member.alive = false;
      member.socket.ping();
    }
  }, 15_000);
  heartbeat.unref();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    server.off("upgrade", upgrade);
    server.off("close", close);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
  server.once("close", close);
  return { close };
}
