import test from "node:test";
import assert from "node:assert/strict";
import { deriveEnvironment } from "../lib/environment.ts";
import { EFFECT_RULES, limitEffectAreas } from "../lib/effect-limits.ts";
import { effectRegions } from "../lib/effect-regions.ts";
import { effectFixture } from "./effect-fixtures.ts";
import { randomSequence, type Surface } from "../lib/terrain.ts";

for (const rule of EFFECT_RULES) {
  test(`${rule.kind}: a spatial recipe works and breaking its structure removes the effect`, () => {
    const { world, breakIndex } = effectFixture(rule.kind);
    const env = deriveEnvironment(world), regions = effectRegions(env);
    const active = regions.filter(region => region.kind === rule.kind);
    assert.ok(active.length > 0, rule.kind);
    assert.ok(active.every(region => region.cells.length <= rule.maxCells));
    assert.deepEqual([...new Set(regions.map(region => region.kind))].sort(), ["dust", "glide", "flicker"].includes(rule.kind) ? [rule.kind, "wind"].sort() : [rule.kind]);
    assert.deepEqual(deriveEnvironment(JSON.parse(JSON.stringify(world))), env);
    world.terrain!.tiles[breakIndex] = { surface: "plain", height: 0 };
    assert.equal(effectRegions(deriveEnvironment(world)).some(region => region.kind === rule.kind), false);
  });
}

test("painting a whole flat surface does not reward tile counts with effects", () => {
  for (const surface of ["plain", "soft", "rough", "slick"] as const) for (const height of [0, 1, 2]) {
    const { world } = effectFixture("wind");
    world.terrain!.tiles.forEach(tile => { tile.surface = surface; tile.height = height; tile.hole = false; });
    assert.deepEqual(effectRegions(deriveEnvironment(world)), [], `${surface} at ${height}`);
  }
});

test("flat mixed boundaries and a single raised tile do not produce automatic rewards", () => {
  const { world } = effectFixture("fog");
  world.terrain!.tiles.forEach(tile => { tile.height = 0; });
  assert.deepEqual(effectRegions(deriveEnvironment(world)), []);
  const { world: hole } = effectFixture("lift");
  hole.terrain!.tiles[3 * hole.size + 4].height = 0;
  assert.equal(effectRegions(deriveEnvironment(hole)).some(region => region.kind === "lift"), false);
});

test("connected effect fields are capped in simulation and stay connected", () => {
  for (const rule of EFFECT_RULES) {
    const { world } = effectFixture("wind"), env = deriveEnvironment(world);
    for (const cell of env.cells) {
      for (const other of EFFECT_RULES) for (const field of other.fields) cell[field] = 0;
      cell[rule.fields[0]] = 1;
    }
    limitEffectAreas(env.size, env.cells, [rule.kind]);
    const active = effectRegions(env).filter(region => region.kind === rule.kind);
    assert.equal(active.length, 1);
    assert.equal(active[0].cells.length, rule.maxCells);
    const before = structuredClone(env);
    limitEffectAreas(env.size, env.cells, [rule.kind]);
    assert.deepEqual(env, before);
  }
});

test("varied layouts respect every effect limit without mutating the placed terrain", () => {
  const random = randomSequence(3927), surfaces: Surface[] = ["plain", "rough", "soft", "slick"];
  for (let n = 0; n < 80; n++) {
    const { world } = effectFixture("wind");
    world.terrain!.tiles.forEach(tile => {
      tile.surface = surfaces[Math.floor(random() * surfaces.length)];
      tile.height = Math.floor(random() * 3); tile.hole = random() < .12;
    });
    const before = JSON.stringify(world), env = deriveEnvironment(world);
    assert.equal(JSON.stringify(world), before);
    for (const region of effectRegions(env)) {
      const rule = EFFECT_RULES.find(rule => rule.kind === region.kind)!;
      assert.ok(region.cells.length <= rule.maxCells, `${region.kind}: ${region.cells.length}`);
    }
  }
});

test("a local downhill current does not animate an entire connected pond", async () => {
  const THREE = await import("three");
  const { makeTerrain } = await import("../components/whistle/TerrainScene.ts");
  const { disposeTerrain } = await import("./terrain-fixtures.ts");
  const { world } = effectFixture("flow");
  for (let z = 3; z <= 8; z++) for (let x = 5; x <= 10; x++) world.terrain!.tiles[z * world.size + x] = { height: 0, surface: "slick" };
  const terrain = makeTerrain(world, []);
  let moving = 0, distant = 0;
  terrain.group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.name !== "generated-water") return;
    const position = object.geometry.getAttribute("position"), current = object.geometry.getAttribute("surfaceCurrent");
    assert.ok(current);
    for (let i = 0; i < current.count; i++) {
      const strength = Math.hypot(current.getX(i), current.getY(i));
      if (strength > .1) moving++;
      const x = (position.getX(i) + world.size - 1) / 2, z = (position.getZ(i) + world.size - 1) / 2;
      if (x > 8 && z > 6) { distant++; assert.equal(strength, 0); }
    }
  });
  assert.ok(moving > 0 && distant > 0);
  disposeTerrain(terrain.group);
});

test("wind is playable: gusts push more in the air and crouching resists them", async () => {
  const { environmentalDrift, environmentalFlight } = await import("../lib/environment-motion.ts");
  const air = { windX: 1, windZ: 0, flowX: 0, flowZ: 0 };
  const time = Math.PI / 2 / .63;
  const standing = environmentalDrift(air, time, false, false).x;
  assert.ok(standing > environmentalDrift(air, 0, false, false).x);
  assert.ok(environmentalDrift(air, time, true, false).x > standing);
  assert.equal(environmentalDrift(air, time, false, true).x, standing * .2);
  assert.deepEqual(environmentalDrift({ windX: 0, windZ: 0, flowX: .5, flowZ: 0 }, 0, true, false), { x: 0, z: 0 });
  assert.equal(environmentalFlight("bounce", 0, 0, 0, 7).vy, 7);
});

test("dust follows wind and sheltering the passage removes it", () => {
  const { world } = effectFixture("dust");
  assert.ok(deriveEnvironment(world).cells[4 * world.size + 4].dust > 0);
  world.terrain!.tiles[4 * world.size + 2].height = 1;
  assert.equal(deriveEnvironment(world).cells[4 * world.size + 4].dust, 0);
});

test("flicker is a moving leaf shadow, with no beam or point light", async () => {
  const THREE = await import("three");
  const { makeTileAtmosphere } = await import("../components/whistle/TileAtmosphere.ts");
  const { world } = effectFixture("flicker"), env = deriveEnvironment(world);
  assert.equal(env.cells.some(cell => "focus" in cell), false);
  const atmosphere = makeTileAtmosphere(world, env, { value: 0 });
  let shadows = 0;
  atmosphere.group.traverse(object => {
    assert.notEqual(object.name, "tile-focus-beam");
    assert.equal(object instanceof THREE.PointLight, false);
    if (object.name === "tile-flicker-shadow") shadows++;
  });
  assert.ok(shadows > 0);
  atmosphere.update(1000, true, .8);
  const shadow = atmosphere.group.getObjectByName("tile-flicker-shadow") as import("three").Mesh<import("three").BufferGeometry, import("three").ShaderMaterial>;
  assert.equal(shadow.material.uniforms.motion.value, 0);
  assert.equal(shadow.material.uniforms.daylight.value, .8);
  atmosphere.group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) { object.geometry.dispose(); (object.material as import("three").Material).dispose(); }
  });
});

test("a steeper water channel increases current without widening its area", () => {
  const { world } = effectFixture("flow"), index = 4 * world.size + 4;
  const gentle = deriveEnvironment(world);
  world.terrain!.tiles[4 * world.size + 3].height = 4;
  const steep = deriveEnvironment(world);
  assert.ok(steep.cells[index].flowX > gentle.cells[index].flowX);
  assert.deepEqual(effectRegions(steep).filter(r => r.kind === "flow").map(r => r.cells), effectRegions(gentle).filter(r => r.kind === "flow").map(r => r.cells));
});
