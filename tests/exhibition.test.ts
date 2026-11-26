import { chooseSubject, observationSubjects } from "../lib/observation.ts";
import { createLabWorld } from "../uwb-lab/world.ts";
import { deriveEnvironment } from "../lib/environment.ts";
import { mapRoomPosition, defaultRoom } from "../lib/uwb-position.ts";
import test from "node:test";
import { cameraOffset, readMount, selectMonitorTag } from "../lib/display-proximity.ts";
import assert from "node:assert/strict";
import { createTrailRecorder, sectorBounds, sectors, trailLifetime } from "../lib/exhibition.ts";

test("nine sector cameras share exact scene-space edges for all supported map sizes", () => {
  for (const size of [8, 12, 20]) {
    const bounds = sectors.map(id => sectorBounds(size, id));
    for (let i = 0; i < bounds.length; i++) {
      const { x, z, span } = bounds[i];
      if (i % 3 < 2) assert.ok(Math.abs(x + span - bounds[i + 1].x) < 1e-9);
      if (i < 6) assert.ok(Math.abs(z + span - bounds[i + 3].z) < 1e-9);
    }
  }
  assert.equal(sectorBounds(12, "B3").z, 7.5 * 2 - 12 + 1);
});

test("a walk across a sector boundary is preserved for late displays and expires after 30 seconds", () => {
  const trail = createTrailRecorder();
  trail.record(5, 7.6, true, 100);
  const crossing = trail.record(5, 7.4, true, 200);
  assert.deepEqual(crossing, { x: 5, z: 7.6, endX: 5, endZ: 7.4, time: 200 });
  assert.deepEqual(trail.recent(200 + trailLifetime - 1), [crossing]);
  assert.deepEqual(trail.recent(200 + trailLifetime), []);
});

test("airborne motion, respawns, and a new play session never draw connecting lines", () => {
  const trail = createTrailRecorder();
  trail.record(4, 8, true, 0);
  trail.record(4, 7.9, false, 80);
  assert.equal(trail.record(4, 7.8, true, 160), undefined);
  assert.equal(trail.record(6, 10, true, 240), undefined);
  assert.ok(trail.record(6, 9.9, true, 320));
  trail.reset();
  assert.equal(trail.record(6, 9.8, true, 400), undefined);
  assert.deepEqual(trail.recent(400), []);
});


test("monitor yaw follows its physical front and local left/right independently of the displayed sector", () => {
  const mount = readMount("B3", new URLSearchParams("mx=1&mz=3&face=90"));
  const pose = (x: number, z: number) => ({ room: { x, z }, at: 1000 });
  assert.ok(cameraOffset(mount, pose(1.4, 2.5), 1100).yaw > 0);
  assert.ok(cameraOffset(mount, pose(1.4, 3.5), 1100).yaw < 0);
  assert.deepEqual(cameraOffset(mount, pose(.5, 3), 1100), { yaw: 0, tilt: 0 });
  assert.equal(cameraOffset(mount, pose(1.4, 2.5), 2800).tilt, 0);
  const center = cameraOffset(mount, pose(1.6, 3.02), 1100);
  assert.ok(center.tilt > 0);
  assert.equal(Math.abs(center.yaw), 0);
  assert.equal(cameraOffset(mount, pose(4, 2.5), 1100).tilt, 0);
});

test("an empty monitor cell frames the nearest visible material; unrelated edits retain the subject", () => {
  const world = createLabWorld();
  const targets = observationSubjects(world, deriveEnvironment(world), []);
  const stone = chooseSubject(targets, { x: 5, z: 4 })!;
  assert.match(stone.id, /^stone-/);
  const nearer = { ...stone, id: "new", z: 4.2 };
  assert.equal(chooseSubject([nearer, stone], { x: 5, z: 4 }, stone.id)?.id, stone.id);
  assert.equal(chooseSubject([nearer], { x: 5, z: 4 }, stone.id)?.id, "new");
  assert.equal(chooseSubject([nearer, stone], { x: 5, z: 3 }, stone.id)?.id, stone.id);
  assert.match(chooseSubject(targets, { x: 9, z: 7 }, stone.id)!.id, /^water-/);
});

test("an installation beside the mapped room can observe its edge without moving the audio listener", () => {
  const setup = { ...defaultRoom, originX: 4, originZ: 2, rotation: 90 };
  assert.equal(mapRoomPosition({ x: 4, z: 10 }, setup, 12), null);
  const edge = mapRoomPosition({ x: 4, z: 10 }, setup, 12, true)!;
  assert.equal(edge.x, 11.5);
  assert.ok(Math.abs(edge.z + .5) < 1e-8);
});

test("each monitor keeps a nearby front-facing tag until it expires or another is clearly closer", () => {
  const mount = { x: 0, z: 0, facing: 0 };
  const pose = (x: number, z: number, at = 1000) => ({ room: { x, z }, at });
  const poses = new Map([["0", pose(.5, .5)], ["1", pose(.4, .5)], ["2", pose(0, -.1)]]);
  assert.equal(selectMonitorTag(mount, poses, undefined, 1000), "1");
  assert.equal(selectMonitorTag(mount, poses, "0", 1000), "0");
  poses.set("1", pose(.1, .1, 1900));
  assert.equal(selectMonitorTag(mount, poses, "0", 1950), "1");
  poses.set("1", pose(0, 2, 2100));
  assert.equal(selectMonitorTag(mount, poses, "0", 2100), undefined);
});
