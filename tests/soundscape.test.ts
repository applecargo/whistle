import assert from "node:assert/strict";
import test from "node:test";
import { comparisonRoute, createSoundscapeWorld, habitatAt, listeningZone, locatePhraseSources, phraseMix, phraseRoute, resonanceAt, resonanceListeningPoint, routeIntervalMs, visitRoute } from "../lib/audio/soundscape.ts";
import { roomPositionAt, sampleTrackedPosition } from "../lib/uwb-position.ts";
import { createWorldDeriver } from "../lib/world-derivation.ts";
import { validateWorld } from "../lib/world.ts";

test("the two reference worlds differ only in the arrangement of six water tiles", () => {
  const connected = validateWorld(createSoundscapeWorld("connected"));
  const scattered = validateWorld(createSoundscapeWorld("scattered"));
  const derive = createWorldDeriver();
  assert.deepEqual(derive(connected).environment.ponds.map(p => p.cells.length), [6]);
  assert.deepEqual(derive(scattered).environment.ponds.map(p => p.cells.length), [1, 1, 1, 1, 1, 1]);
  for (const world of [scattered, connected]) {
    const water = world.terrain!.tiles.filter(tile => tile.surface === "slick");
    assert.equal(water.length, 6);
    for (const tile of water) tile.surface = "plain";
  }
  assert.deepEqual(scattered, connected);
});

test("the fixed route matches local grass and water while exposing different pond sizes", () => {
  const derive = createWorldDeriver();
  const connected = derive(createSoundscapeWorld("connected")).environment;
  const scattered = derive(createSoundscapeWorld("scattered")).environment;
  const route = comparisonRoute();
  assert.equal((route.length - 1) * routeIntervalMs, 12000);
  assert.ok(habitatAt(connected, {x: 5, z: 7}).grass > .5);
  assert.ok(habitatAt(connected, route.at(-1)!).water > .2);
  for (const point of route) {
    const a = habitatAt(connected, point), b = habitatAt(scattered, point);
    assert.ok(Math.abs(a.water - b.water) < 1e-12);
    assert.equal(a.grass, b.grass);
    assert.equal(a.extent, a.water > 0 ? 1 : 0);
    assert.equal(b.extent, 0);
  }
});

test("rotated UWB metre inputs reproduce each game habitat sample", () => {
  const mapping = { originX: -2, originZ: 7, width: 6, depth: 3, rotation: 30 };
  for (const layout of ["connected", "scattered"] as const) {
    const world = createSoundscapeWorld(layout), derived = createWorldDeriver()(world);
    for (const point of comparisonRoute()) {
      const metres = roomPositionAt((point.x + .5) / world.size, (point.z + .5) / world.size, mapping);
      const frame = sampleTrackedPosition(world, derived, metres, mapping).frame!;
      const a = habitatAt(derived.environment, point), b = habitatAt(derived.environment, frame);
      for (const key of ["grass", "water", "extent"] as const) assert.ok(Math.abs(a[key] - b[key]) < 1e-10);
    }
  }
});

test("phrase routes hear the same first phrase, then change only the listener location", () => {
  const world = createSoundscapeWorld();
  const derived = createWorldDeriver()(world);
  const sources = locatePhraseSources(derived.environment);
  const stay = phraseRoute("stay"), follow = phraseRoute("follow");
  assert.deepEqual(stay.slice(0, 13), follow.slice(0, 13));
  assert.deepEqual(stay[0], sources.grass);
  assert.ok(stay.every(point => point.x === stay[0].x && point.z === stay[0].z));
  assert.equal(follow.length, stay.length);
  const bank = follow[32];
  assert.equal(derived.environment.cells[Math.round(bank.z) * world.size + Math.round(bank.x)].water, null);
  assert.ok(phraseMix(sources, bank).water > .8);
  assert.ok(sources.travelMs > 3200);
  const mapping = { originX: 3, originZ: -2, width: 7, depth: 4, rotation: 50 };
  for (const point of [...stay, ...follow]) {
    const metres = roomPositionAt((point.x + .5) / world.size, (point.z + .5) / world.size, mapping);
    const mapped = sampleTrackedPosition(world, derived, metres, mapping).frame!;
    const a = phraseMix(sources, point), b = phraseMix(sources, mapped);
    assert.ok(Math.abs(a.grass - b.grass) < 1e-10 && Math.abs(a.water - b.water) < 1e-10);
  }
});

test("a world needs grass to call and a pond to answer", () => {
  const world = createSoundscapeWorld();
  const derive = createWorldDeriver();
  for (const tile of world.terrain!.tiles) if (tile.surface === "slick") tile.surface = "plain";
  const dry = locatePhraseSources(derive(world).environment);
  assert.ok(dry.grass);
  assert.equal(phraseMix(dry, world.start).water, 0);
  for (const tile of world.terrain!.tiles) tile.surface = "plain";
  assert.deepEqual(phraseMix(locatePhraseSources(derive(world).environment), world.start), { grass: 0, water: 0 });
});

test("visit comparisons share the bank, departure and UWB zone transitions", () => {
  const world = createSoundscapeWorld(), derived = createWorldDeriver()(world);
  const sources = locatePhraseSources(derived.environment);
  const mapping = { originX: -3, originZ: 3, width: 4, depth: 7, rotation: 33 };
  assert.deepEqual(visitRoute("pass").slice(20), visitRoute("listen").slice(20));
  for (const kind of ["pass", "listen"] as const) {
    let zone: ReturnType<typeof listeningZone> = "away";
    const transitions: [number, ReturnType<typeof listeningZone>][] = [];
    for (const [tick, point] of visitRoute(kind).entries()) {
      const metres = roomPositionAt((point.x + .5) / world.size, (point.z + .5) / world.size, mapping);
      const frame = sampleTrackedPosition(world, derived, metres, mapping).frame!;
      const next = listeningZone(sources, point, zone);
      assert.equal(listeningZone(sources, frame, zone), next);
      if (next !== zone) transitions.push([tick, next]);
      zone = next;
    }
    assert.deepEqual(transitions.map(([, name]) => name), ["grass", "away", "bank", "away"]);
    assert.equal(transitions[2][0], 33);
    assert.ok(kind === "pass" ? transitions[1][0] < 10 : transitions[1][0] > 11);
  }
});

test("a fixed virtual UWB listener and game listener hear the same instrument as the world changes", () => {
  const derive = createWorldDeriver();
  const point = resonanceListeningPoint;
  const mapping = { originX: -1, originZ: 3, width: 5, depth: 7, rotation: 28 };
  for (const layout of ["connected", "scattered"] as const) {
    const world = createSoundscapeWorld(layout), derived = derive(world);
    const metres = roomPositionAt((point.x + .5) / world.size, (point.z + .5) / world.size, mapping);
    const frame = sampleTrackedPosition(world, derived, metres, mapping).frame!;
    const game = resonanceAt(derived.environment, point), uwb = resonanceAt(derived.environment, frame);
    assert.equal(game.extent, layout === "connected" ? 1 : 0);
    assert.ok(Math.abs(game.grass - uwb.grass) < 1e-10);
    assert.equal(game.water, game.grass);
    assert.ok(Math.abs(game.water - uwb.water) < 1e-10);
    for (const tile of world.terrain!.tiles) if (tile.surface === "slick") tile.surface = "plain";
    const dry = resonanceAt(createWorldDeriver()(world).environment, point);
    assert.ok(dry.grass > 0 && dry.water === 0);
    for (const tile of world.terrain!.tiles) tile.surface = "plain";
    assert.equal(resonanceAt(createWorldDeriver()(world).environment, point).grass, 0);
  }
});
