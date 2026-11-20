import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { makeWaterSurface } from "./WaterSurface.ts";
import { fogPatches } from "../../lib/environment-effects.ts";
import { waterWeights, waterSupport, WATER_INSET } from "../../lib/water.ts";
import { makeTileAtmosphere } from "./TileAtmosphere.ts";
import type { World, Weather } from "../../lib/world.ts";
import { randomSequence, terrainSample } from "../../lib/terrain.ts";
import { environmentAt, type Environment } from "../../lib/environment.ts";
import { makeTreeSurfaces } from "./TreeSurfaces.ts";

export function makeEnvironment(
  world: World,
  env: Environment,
  clock: { value: number },
  ground: THREE.BufferGeometry,
) {
  const group = new THREE.Group();
  group.name = "generated-environment";
  const trees = makeTreeSurfaces(world, env, clock);
  group.add(trees.group);
  const effects = makeTileAtmosphere(world, env, clock);
  group.add(effects.group);
  const waters: ReturnType<typeof makeWaterSurface>[] = [];
  const sceneCoord = (n: number) => n * 2 - world.size + 1;
  let floodGround: THREE.BufferGeometry | undefined;
  const neighbours: number[][] = [];
  if (env.ponds.some(pond => pond.level > 0)) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", ground.getAttribute("position").clone());
    geometry.setIndex(ground.index!.clone());
    floodGround = mergeVertices(geometry, .0001);
    geometry.dispose();
    for (let i = 0; i < floodGround.getAttribute("position").count; i++) neighbours.push([]);
    const indices = floodGround.index!;
    for (let i = 0; i < indices.count; i += 3) {
      const a = indices.getX(i), b = indices.getX(i+1), c = indices.getX(i+2);
      neighbours[a].push(b,c); neighbours[b].push(a,c); neighbours[c].push(a,b);
    }
  }

  for (const pond of [...env.ponds].sort(
    (a, b) => b.cells.length - a.cells.length,
  )) {

    const minX = Math.min(...pond.cells.map((i) => i % world.size)) - 1.5,
      maxX = Math.max(...pond.cells.map((i) => i % world.size)) + 1.5;
    const minZ = Math.min(...pond.cells.map((i) => Math.floor(i / world.size))) - 1.5,
      maxZ = Math.max(...pond.cells.map((i) => Math.floor(i / world.size))) + 1.5;
    const positions: number[] = [],
      depths: number[] = [],
      indices: number[] = [],
      signed: number[] = [],
      constraints: number[][] = [];
    const surfaceGround = pond.level > 0 ? floodGround! : ground;
    const groundPositions = surfaceGround.getAttribute("position");
    const flooded = new Uint8Array(groundPositions.count);
    if (pond.level > 0) {
      const members = new Set(pond.cells);
      const sources = new Set(pond.cells.filter(i => world.terrain?.tiles[i].surface === "slick"));
      const reachable = new Uint8Array(groundPositions.count);
      const pending: number[] = [];
      for (let i = 0; i < groundPositions.count; i++) {
        const x = (groundPositions.getX(i) + world.size - 1) / 2;
        const z = (groundPositions.getZ(i) + world.size - 1) / 2;
        const edgeX = Math.max(0, Math.min(world.size-1, Math.round(x)));
        const edgeZ = Math.max(0, Math.min(world.size-1, Math.round(z)));
        const outside = x < -.5 || z < -.5 || x > world.size-.5 || z > world.size-.5;
        if ((!outside || members.has(edgeZ*world.size+edgeX)) && groundPositions.getY(i) < pond.level-.002) reachable[i] = 1;
        if (x < 0 || z < 0 || x >= world.size || z >= world.size) continue;
        if (Math.abs(x-Math.round(x)) > .1 || Math.abs(z-Math.round(z)) > .1) continue;
        if (!sources.has(Math.round(z)*world.size+Math.round(x)) || groundPositions.getY(i) >= pond.level-.002) continue;
        flooded[i] = 1; pending.push(i);
      }
      for (let cursor = 0; cursor < pending.length; cursor++) for (const n of neighbours[pending[cursor]]) {
        if (flooded[n] || !reachable[n]) continue;
        flooded[n] = 1; pending.push(n);
      }
    }
    const vertices = new Map<number, number>();
    const vertex = (source: number) => {
      const found = vertices.get(source);
      if (found !== undefined) return found;
      const sx = groundPositions.getX(source), sz = groundPositions.getZ(source);
      const gx = (sx + world.size - 1) / 2, gz = (sz + world.size - 1) / 2;
      const depth = pond.level - groundPositions.getY(source), index = depths.length;
      positions.push(sx, pond.level, sz); depths.push(Math.max(0, depth));
      const edge = [depth - .002];
      if (pond.level > 0) {
        if (!flooded[source]) edge[0] = Math.min(edge[0], -.002);
      } else {
        const natural = terrainSample(world, gx, gz, false).height;
        const weight = waterWeights(env.size, gx, gz, i => env.cells[i].water, i => env.cells[i].hole).get(pond.level) ?? 0;
        edge.push((weight * waterSupport(natural, pond.level + WATER_INSET) - .25) * .2);
      }
      constraints.push(edge); signed.push(Math.min(...edge)); vertices.set(source, index);
      return index;
    };
    const cuts = new Map<string, number>();
    const cut = (a: number, b: number) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`,
        found = cuts.get(key);
      if (found !== undefined) return found;
      let low = 0,
        high = 1;
      for (let n = 0; n < 16; n++) {
        const mid = (low + high) / 2;
        const inside = constraints[a].every(
          (value, k) => value + (constraints[b][k] - value) * mid >= 0,
        );
        if (inside === signed[a] >= 0) low = mid;
        else high = mid;
      }
      const f = (low + high) / 2,
        i = depths.length;
      for (let n = 0; n < 3; n++)
        positions.push(
          positions[a * 3 + n] +
            (positions[b * 3 + n] - positions[a * 3 + n]) * f,
        );
      depths.push(0);
      signed.push(0);
      constraints.push([0, 0, 0]);
      cuts.set(key, i);
      return i;
    };
    const triangle = (a: number, b: number, c: number) => {
      const points = [a, b, c],
        out: number[] = [];
      for (let k = 0; k < 3; k++) {
        const a = points[k],
          b = points[(k + 1) % 3];
        if (signed[a] >= 0) out.push(a);
        if (signed[a] >= 0 !== signed[b] >= 0) out.push(cut(a, b));
      }
      for (let k = 1; k < out.length - 1; k++)
        indices.push(out[0], out[k], out[k + 1]);
    };
    const groundIndices = surfaceGround.index!;
    for (let n = 0; n < groundIndices.count; n += 3) {
      const ids = [groundIndices.getX(n), groundIndices.getX(n + 1), groundIndices.getX(n + 2)];
      if (pond.level > 0) {
        if (!ids.some(i => flooded[i])) continue;
      } else if (ids.every(i => groundPositions.getX(i) < sceneCoord(minX)) || ids.every(i => groundPositions.getX(i) > sceneCoord(maxX)) ||
        ids.every(i => groundPositions.getZ(i) < sceneCoord(minZ)) || ids.every(i => groundPositions.getZ(i) > sceneCoord(maxZ))) continue;
      triangle(vertex(ids[0]), vertex(ids[1]), vertex(ids[2]));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "waterDepth",
      new THREE.Float32BufferAttribute(depths, 1),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const waterPositions = geometry.getAttribute("position"), currents = new Float32Array(waterPositions.count * 2);
    for (let i = 0; i < waterPositions.count; i++) {
      const cell = environmentAt(env, (waterPositions.getX(i) + world.size - 1) / 2, (waterPositions.getZ(i) + world.size - 1) / 2);
      currents[i * 2] = cell.windX + cell.flowX; currents[i * 2 + 1] = cell.windZ + cell.flowZ;
    }
    geometry.setAttribute("surfaceCurrent", new THREE.Float32BufferAttribute(currents, 2));
    const water = makeWaterSurface(
      geometry,
      pond.level,
      clock,
    );
    waters.push(water);
    group.add(water);
  }
  floodGround?.dispose();

  const mist: {
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    x: number;
    z: number;
    phase: number;
    strength: number;
  }[] = [];
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5),
        i = (y * 32 + x) * 4;
      pixels.set(
        [255, 255, 255, Math.round(Math.pow(Math.max(0, 1 - d * d), 3) * 255)],
        i,
      );
    }
  const patches = fogPatches(env);
  if (patches.length) {
    const texture = new THREE.DataTexture(pixels, 32, 32);
    texture.needsUpdate = true;
    const random = randomSequence((world.terrain?.seed ?? 0) ^ 0x517a);
    for (const patch of patches) {
      const {x,z,radius,strength}=patch;
      const material = new THREE.MeshBasicMaterial({map:texture,color:"#ffffff",transparent:true,
        opacity:0,depthWrite:false,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);
      mesh.name="generated-fog";
      mesh.scale.set(radius*4,1.3+random()*.6,1);
      mesh.position.set(sceneCoord(x), Math.max(terrainSample(world,x,z).height,
        env.cells[Math.max(0,Math.min(env.cells.length-1,Math.round(z)*env.size+Math.round(x)))].water ?? -Infinity)+.65,sceneCoord(z));
      group.add(mesh);
      mist.push({mesh,x:mesh.position.x,z:mesh.position.z,phase:random()*6.28,strength});
    }
  }
  let firstTime: number | undefined;
  return {
    group,
    setSurfaceImages: trees.setSurfaceImages,
    update: (time: number, camera?: THREE.Camera, mistColor?: THREE.Color, reducedMotion = false, weather: Weather = "clear", daylight = 1) => {
      effects.update(time, reducedMotion, daylight);
      for (const water of waters) {
        const rain = weather === "rain" ? 1 : 0;
        water.material.uniforms.rainPower.value = reducedMotion ? 0 : rain;
        water.material.uniforms.waveStrength.value = reducedMotion ? 1 : 1 + rain * .5;
        water.material.uniforms.waterMotion.value = reducedMotion ? 0 : 1;
      }
      trees.update(time, reducedMotion);
      firstTime ??= time;
      const appear = Math.min(1,(time-firstTime)/650);
      for (const fog of mist) {
        fog.mesh.material.opacity = .26 * fog.strength * appear;
        if (mistColor) fog.mesh.material.color.copy(mistColor);
        if (camera) fog.mesh.quaternion.copy(camera.quaternion);
        fog.mesh.position.x =
          fog.x + Math.sin(time * 0.00025 + fog.phase) * 0.3;
        fog.mesh.position.z =
          fog.z + Math.cos(time * 0.00019 + fog.phase) * 0.2;
      }
    },
  };
}
