import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { attachPortalRelay } from "../scripts/portals/relay.ts";
import { portalRoom, portalSocketURL, portalWorld, type PortalMessage } from "../lib/portal-protocol.ts";
import { placePortals, insidePortal, portalReturnPosition } from "../lib/portals.ts";
import { starterWorld } from "../lib/world.ts";
import { flatTerrain } from "../lib/terrain.ts";
import { createWorldDeriver } from "../lib/world-derivation.ts";

test("room links are independent of query order and fragments, but isolate different rooms", () => {
  assert.equal(portalRoom(new URL("https://a.test/whistle/?room=a&x=1#view")), portalRoom(new URL("https://a.test/whistle?x=1&room=a")));
  assert.notEqual(portalRoom(new URL("https://a.test/whistle/?room=a")), portalRoom(new URL("https://a.test/whistle/?room=b")));
  const endpoint = new URL(portalSocketURL(new URL("https://a.test/whistle/?room=a")));
  assert.equal(endpoint.protocol, "wss:");
  assert.equal(endpoint.pathname, "/whistle/portals");
  assert.equal(endpoint.searchParams.get("room"), "/whistle?room=a");
  assert.equal(new URL(portalSocketURL(new URL("https://a.test/whistle/"), "https://relay.test/whistle/portals")).hostname, "relay.test");
});

test("published worlds omit restoration originals without mutating the author's document", () => {
  const world = starterWorld(); world.assets[0].originalImage = "original"; world.assets[0].image = "rendered";
  const next = portalWorld(world);
  assert.equal(next.assets[0].originalImage, undefined);
  assert.equal(next.assets[0].image, "rendered");
  assert.equal(world.assets[0].originalImage, "original");
});

test("portals use reachable ground, avoid spawn and holes, and require ground-level entry", () => {
  const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size); world.start = { x: 0, z: 3 };
  world.terrain.tiles[0].hole = true;
  const derive = createWorldDeriver();
  const portals = placePortals(world, [{ id: "a", label: "A" }, { id: "b", label: "B" }], derive(world));
  assert.equal(portals.length, 2);
  for (const p of portals) {
    assert.equal(world.terrain.tiles[p.z * world.size + p.x].hole ?? false, false);
    assert.ok(Math.hypot(p.x - world.start.x, p.z - world.start.z) >= 1.5);
  }
  const p = portals[0];
  assert.equal(insidePortal(p, { ...p, yaw: 0 }, p.y), true);
  assert.equal(insidePortal(p, { ...p, yaw: 0, falling: true }, p.y), false);
  assert.equal(insidePortal(p, { ...p, yaw: 0 }, p.y + 3), false);
  for (const tile of world.terrain.tiles) tile.hole = true;
  world.terrain.tiles[world.start.z * world.size + world.start.x].hole = false;
  assert.deepEqual(placePortals(world, [{ id: "a", label: "A" }], derive(world)), []);
});

test("button returns step away from a portal while preserving the viewing direction", () => {
  const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size); world.start = { x: 0, z: 3 };
  const derive = createWorldDeriver();
  const portal = { id: "departed", label: "A", x: 0, z: 0, y: 0, yaw: 0 };
  const player = { x: 0, z: .35, yaw: 0, pitch: -.12 };
  const result = portalReturnPosition(world, player, portal, derive(world));
  assert.equal(result.x, 0);
  assert.equal(result.z, 1.25);
  assert.equal(result.yaw, player.yaw);
  assert.equal(result.pitch, player.pitch);
  assert.equal(insidePortal(portal, result, 0), false);
  assert.equal(player.z, .35);
});

test("button returns avoid holes, large solid objects and neighboring portals", () => {
  const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size); world.start = { x: 0, z: 3 };
  const portal = { id: "departed", label: "A", x: 0, z: 0, y: 0, yaw: 0 };
  const player = { x: 0, z: .35, yaw: 0 };
  world.terrain.tiles[12].hole = true;
  world.assets[0].solid = true;
  world.objects = [{ id: "wall", asset: world.assets[0].id, x: 1, z: 0, scale: 2, rotation: 0 }];
  const result = portalReturnPosition(world, player, portal, createWorldDeriver()(world), [{ ...portal, id: "neighbor", x: 2, z: 0 }]);
  assert.ok(!world.terrain.tiles[Math.round(result.z) * world.size + Math.round(result.x)].hole);
  assert.ok(Math.hypot(result.x - 1, result.z) >= .43 * 2 + .13);
  assert.ok(Math.hypot(result.x - 2, result.z) >= 1);
  assert.ok(Math.hypot(result.x, result.z) >= 1);
});

test("relay publishes presence, returns latest same-room snapshots, isolates rooms and removes disconnected peers", async t => {
  const server = createServer();
  const relay = attachPortalRelay(server);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const clients: WebSocket[] = [];
  t.after(async () => { for (const c of clients) c.terminate(); relay.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  async function connect(room: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${(address as { port: number }).port}/whistle/portals?room=${room}`);
    clients.push(ws);
    const messages: PortalMessage[] = [];
    ws.on("message", data => messages.push(JSON.parse(data.toString())));
    await once(ws, "open");
    const wait = async (predicate: (m: PortalMessage) => boolean) => {
      for (let n = 0; n < 200; n++) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw Error("Missing relay message");
    };
    const welcome = await wait(m => m.type === "welcome"); assert.equal(welcome.type, "welcome");
    return { ws, wait, id: welcome.id, messages, send: (message: unknown) => ws.send(JSON.stringify(message)) };
  }
  const a = await connect("workshop"), b = await connect("workshop"), c = await connect("other");
  await a.wait(m => m.type === "peers" && m.count === 2 && m.peers.length === 0);
  await c.wait(m => m.type === "peers" && m.count === 1);
  const world = starterWorld(); world.title = "B's garden";
  b.send({ type: "publish", world });
  const peers = await a.wait(m => m.type === "peers" && m.peers.some(p => p.id === b.id));
  assert.equal(peers.type, "peers"); assert.equal(peers.peers[0].title, "B's garden");
  world.title = "Updated garden";
  b.send({ type: "publish", world });
  await b.wait(m => m.type === "peers" && m.peers.some(p => p.revision === 2));
  a.send({ type: "visit", target: b.id, requestId: "visit" });
  const visit = await a.wait(m => m.type === "world"); assert.equal(visit.type, "world");
  assert.equal(visit.world.title, "Updated garden");
  assert.equal(visit.peer.id, b.id);
  c.send({ type: "visit", target: b.id, requestId: "private" });
  const denied = await c.wait(m => m.type === "error" && m.requestId === "private"); assert.equal(denied.type, "error");
  b.send({ type: "publish", world: { ...world, sky: "javascript:bad" } });
  await b.wait(m => m.type === "error");
  a.messages.length = 0;
  b.ws.close(); await once(b.ws, "close");
  await a.wait(m => m.type === "peers" && m.count === 1 && !m.peers.some(p => p.id === b.id));
  a.send({ type: "visit", target: b.id, requestId: "gone" });
  await a.wait(m => m.type === "error" && m.requestId === "gone");
  assert.equal(c.messages.some(m => m.type === "peers" && m.peers.some(p => p.id === b.id)), false);
});
