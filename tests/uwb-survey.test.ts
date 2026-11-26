import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { calculateAnchorLayout, type SurveyReading } from "../lib/uwb/anchor-survey.ts";
import { checkAnchorNetwork, runAnchorSurvey, simulatedSurveyTransport, httpSurveyTransport, type SurveyTransport } from "../scripts/uwb/survey.ts";
import { routerNetworkConfig } from "../scripts/uwb/network-config.ts";

const nodes = [0, 1, 2, 3].map(id => ({ id, url: `http://board-${id}` }));
const points = [[0, 0], [4, 0], [4.5, 3], [.3, 2.8]];
const readings = (xy = points): SurveyReading[] => xy.flatMap((a, from) => xy.flatMap((b, to) => {
  if (from === to) return [];
  const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
  return [{ from, to, samples: 1000, median: d, p10: d - .01, p90: d + .01 }];
}));

test("router settings preserve the control key and assign four independent mDNS addresses", () => {
  const key = "a".repeat(48);
  const result = routerNetworkConfig({ ssid: 'Studio "WiFi"', password: 'secret\\123' }, key);
  assert.equal(result.config.key, key);
  assert.equal(result.config.mode, "router");
  assert.equal("password" in result.config, false);
  assert.deepEqual(result.config.nodes.map(n => n.url), [0, 1, 2, 3].map(id => `http://whistle-a${id}.local`));
  assert.ok(result.header.includes('#define WHISTLE_NETWORK_ROUTER 1'));
  assert.ok(result.header.includes(JSON.stringify('Studio "WiFi"')));
  assert.ok(result.header.includes(JSON.stringify('secret\\123')));
  for (const input of [null, {}, { ssid: "room" }, { ssid: "x".repeat(33), password: "12345678" }, { ssid: "room", password: "short" }])
    assert.throws(() => routerNetworkConfig(input));
});

test("an explicit empty password configures open Wi-Fi and preserves the anchor control key", () => {
  const key = "b".repeat(48);
  const result = routerNetworkConfig({ ssid: "room", password: "" }, key);
  assert.equal(result.config.key, key);
  assert.match(result.header, /^#define WHISTLE_WIFI_PASSWORD ""$/m);
});

test("network checks query all four anchors without changing their roles", async () => {
  const events: string[] = [], simulate = simulatedSurveyTransport();
  const statuses = await checkAnchorNetwork(nodes, async (n, path, method, body) => {
    events.push(path); return simulate(n, path, method, body);
  });
  assert.equal(statuses.length, 4);
  assert.deepEqual(events, ["/status", "/status", "/status", "/status"]);
});

test("six pair distances recover an irregular equal-height layout", () => {
  for (const xy of [points, [[0, 0], [4, 0], [2, 3], [1, -2]]]) {
    const result = calculateAnchorLayout(readings(xy));
    result.anchors.forEach((p, i) => {
      assert.ok(Math.abs(p.x - xy[i][0]) < 1e-6);
      assert.ok(Math.abs(p.z - xy[i][1]) < 1e-6);
    });
    assert.ok(result.rms < 1e-6);
  }
});

test("survey rejects movement, jitter, missing data and impossible geometry", () => {
  const raw = readings();
  assert.throws(() => calculateAnchorLayout(raw.slice(1)), /12개/);
  assert.throws(() => calculateAnchorLayout([...raw.slice(1), raw[1]]), /형식/);
  assert.throws(() => calculateAnchorLayout(raw.map((r, i) => i ? r : { ...r, samples: 1 })), /표본/);
  assert.throws(() => calculateAnchorLayout(raw.map((r, i) => i ? r : { ...r, median: NaN })), /형식/);
  assert.throws(() => calculateAnchorLayout(raw.map((r, i) => i ? r : { ...r, p90: r.median + .5 })), /변동/);
  assert.throws(() => calculateAnchorLayout(raw.map((r, i) => i ? r : { ...r, median: r.median + .81, p10: r.p10 + .81, p90: r.p90 + .81 })), /양방향/);
  assert.throws(() => calculateAnchorLayout(readings([[0, 0], [1, 0], [2, 0], [3, 0]])), /일직선/);
  assert.throws(() => calculateAnchorLayout(raw.map(r => r.from + r.to === 5 ? { ...r, median: 20, p10: 19.99, p90: 20.01 } : r)), /일치/);
});

test("centimetre noise yields a stable estimate without forcing a rectangle", () => {
  const noisy = readings().map((r, i) => ({ ...r, median: r.median + (i % 2 ? .01 : -.01) }));
  const result = calculateAnchorLayout(noisy);
  result.anchors.forEach((p, i) => assert.ok(Math.hypot(p.x - points[i][0], p.z - points[i][1]) < .04));
});

test("controller completes four transactions and verifies restoration before advancing", async () => {
  const simulate = simulatedSurveyTransport(); const events: string[] = [];
  const request: SurveyTransport = async (n, path, method, body) => { events.push(`${n.id}${path.split("?")[0]}`); return simulate(n, path, method, body); };
  const result = await runAnchorSurvey(nodes, request, () => {});
  assert.equal(result.readings.length, 12);
  assert.deepEqual(events.slice(4), nodes.flatMap(n => [`${n.id}/measure`, `${n.id}/result`, `${n.id}/status`]));
});

test("failed start responses still trigger restore verification and stop subsequent boards", async () => {
  const simulate = simulatedSurveyTransport(); const events: string[] = [];
  const request: SurveyTransport = async (n, path, method, body) => {
    events.push(`${n.id}${path}`);
    if (path === "/measure") { await simulate(n, path, method, body); throw new Error("connection lost"); }
    return simulate(n, path, method, body);
  };
  await assert.rejects(runAnchorSurvey(nodes, request, () => {}), /connection lost/);
  assert.equal(events.at(-1), "0/status");
  assert.equal(events.filter(e => e.endsWith("/measure")).length, 1);
});

test("wrong identity, stale results and failed restoration cannot advance the survey", async () => {
  for (const fault of ["identity", "session", "restoration", "settings"] as const) {
    const simulate = simulatedSurveyTransport(); let started = false, starts = 0;
    const request: SurveyTransport = async (n, path, method, body) => {
      if (path === "/measure") { started = true; starts++; }
      const value = await simulate(n, path, method, body) as Record<string, unknown>;
      if (fault === "identity" && path === "/status") value.id = 8;
      if (fault === "session" && path.startsWith("/result")) value.session = "old";
      if (started && path === "/status") {
        if (fault === "restoration") value.cfg = "0,0,1,0";
        if (fault === "settings") value.ant = "17000";
      }
      return value;
    };
    await assert.rejects(runAnchorSurvey(nodes, request, () => {}));
    assert.ok(starts <= 1);
  }
});

test("HTTP transport authenticates and carries a complete survey over real local sockets", async () => {
  const simulate = simulatedSurveyTransport();
  const servers = await Promise.all(nodes.map(async n => {
    const server = createServer(async (req, res) => {
      if (req.headers["x-whistle-key"] !== "test-secret") { res.writeHead(401).end(); return; }
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      const value = await simulate(n, req.url!, req.method as "GET" | "POST", Buffer.concat(chunks).toString());
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return { server, node: { id: n.id, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` } };
  }));
  try {
    const real = servers.map(s => s.node);
    await assert.rejects(runAnchorSurvey(real, httpSurveyTransport("wrong"), () => {}), /401/);
    const result = await runAnchorSurvey(real, httpSurveyTransport("test-secret"), () => {});
    assert.equal(result.anchors.length, 4);
    assert.ok(result.rms < .01);
  } finally { await Promise.all(servers.map(({ server }) => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); }
});

test("HTTP result reads recover from a dropped socket without repeating the measurement", async () => {
  let starts = 0, reads = 0;
  const server = createServer((req, res) => {
    assert.equal(req.headers.connection, "close");
    if (req.method === "POST") { starts++; res.end('{"accepted":true}'); return; }
    reads++;
    if (reads === 1) { req.socket.destroy(); return; }
    assert.equal(req.url, "/result?session=same-session");
    res.end('{"session":"same-session","restored":true}');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const node = { id: 0, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
  try {
    const request = httpSurveyTransport("test-secret");
    await request(node, "/measure", "POST", "same-session");
    assert.deepEqual(await request(node, "/result?session=same-session"), { session: "same-session", restored: true });
    assert.equal(starts, 1);
    assert.equal(reads, 2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("HTTP measurement writes are not retried when their response is lost", async () => {
  let starts = 0;
  const server = createServer((req) => { starts++; req.socket.destroy(); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const node = { id: 0, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
    await assert.rejects(httpSurveyTransport("test-secret")(node, "/measure", "POST", "same-session"));
    assert.equal(starts, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
