import { waterWeights, waterSupport, WATER_INSET } from "../../lib/water.ts";
import { isHole } from "../../lib/tile.ts";
import * as THREE from "three";
import { deriveEnvironment, type Environment } from "../../lib/environment.ts";
import { makeEnvironment } from "./EnvironmentScene.ts";
import { makeWindField } from "./WindField.ts";
import { makeStoneSurfaces } from "./StoneSurfaces.ts";
import { stoneGeometry, STONE_SHAPES } from "./StoneGeometry.ts";
import { stoneAppearance } from "../../lib/stones.ts";
import type { Actor, Asset, World, Weather } from "@/lib/world";
import {
  LEVEL,
  randomSequence,
  terrainSample,
  type Structure,
} from "../../lib/terrain.ts";


export function makeTerrain(world: World, structures: Structure[], derivedEnvironment?: Environment) {
  const group = new THREE.Group(),
    wind = { value: 0 };
  const environment = derivedEnvironment ?? deriveEnvironment(world, structures);
  const toScene = (n: number) => n * 2 - world.size + 1;
  const random = randomSequence(world.terrain?.seed ?? 0);
  const palette = {
    plain: new THREE.Color("#ffffff"),
    rough: new THREE.Color("#ffffff"),
    slick: new THREE.Color("#ffffff"),
    soft: new THREE.Color("#ffffff"),
  };


  const extent = world.size + 3;
  const resolution = (world.size + 3) * 12,
    stride = resolution + 1;
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [],
    coverage: number[] = [],
    wetness: number[] = [], natural: number[] = [];
  const sampleColor = new THREE.Color();
  for (let z = 0; z <= resolution; z++)
    for (let x = 0; x <= resolution; x++) {
      const gx = x / 12 - 2,
        gz = z / 12 - 2,
        sample = terrainSample(world, gx, gz);
      positions.push(toScene(gx), sample.height, toScene(gz));
      coverage.push(sample.coverage);
      natural.push(sample.naturalHeight);
      let wet = 0;
      if (environment.ponds.length) for (const [level, weight] of waterWeights(world.size, gx, gz, i => environment.cells[i].water, i => environment.cells[i].hole))
        wet = Math.max(wet, weight * waterSupport(sample.naturalHeight, level + WATER_INSET));
      wetness.push(wet);
      sampleColor.setRGB(1, 1, 1);
      colors.push(sampleColor.r, sampleColor.g, sampleColor.b);
    }

  const boundary = new Map<string, [number, number]>();
  const edge = (a: number, b: number) => {
    if (coverage[a] !== 0.5 || coverage[b] !== 0.5) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (boundary.has(key)) boundary.delete(key);
    else boundary.set(key, [a, b]);
  };
  const cuts = new Map<string, number>();
  const cut = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const existing = cuts.get(key);
    if (existing !== undefined) return existing;
    const t = (0.5 - coverage[a]) / (coverage[b] - coverage[a]),
      i = coverage.length;
    for (let axis = 0; axis < 3; axis++) {
      positions.push(
        positions[a * 3 + axis] +
          (positions[b * 3 + axis] - positions[a * 3 + axis]) * t,
      );
      colors.push(
        colors[a * 3 + axis] +
          (colors[b * 3 + axis] - colors[a * 3 + axis]) * t,
      );
    }
    coverage.push(0.5);
    cuts.set(key, i);
    return i;
  };
  const midpoints = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = midpoints.get(key);
    if (cached !== undefined) return cached;
    const x = (positions[a * 3] + positions[b * 3]) / 2;
    const z = (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2;
    const sample = terrainSample(
      world,
      (x + world.size - 1) / 2,
      (z + world.size - 1) / 2,
    );
    const i = coverage.length;
    positions.push(x, sample.height, z);
    for (let k = 0; k < 3; k++)
      colors.push((colors[a * 3 + k] + colors[b * 3 + k]) / 2);
    coverage.push(sample.coverage);
    midpoints.set(key, i);
    return i;
  };
  const triangle = (a: number, b: number, c: number, refine = true) => {

    if (
      refine &&
      Math.min(coverage[a], coverage[b], coverage[c]) < 0.5 &&
      Math.max(coverage[a], coverage[b], coverage[c]) >= 0.5
    ) {
      const ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      triangle(a, ab, ca, false);
      triangle(ab, b, bc, false);
      triangle(ca, bc, c, false);
      triangle(ab, bc, ca, false);
      return;
    }
    const input = [a, b, c],
      polygon: number[] = [];
    for (let i = 0; i < 3; i++) {
      const from = input[i],
        to = input[(i + 1) % 3],
        inside = coverage[from] >= 0.5,
        nextInside = coverage[to] >= 0.5;
      if (inside) polygon.push(from);
      if (inside !== nextInside) polygon.push(cut(from, to));
    }
    for (let i = 1; i < polygon.length - 1; i++) {
      const [x, y, z] = [polygon[0], polygon[i], polygon[i + 1]];
      indices.push(x, y, z);
      edge(x, y);
      edge(y, z);
      edge(z, x);
    }
  };
  // Resolve narrow banks only where a water boundary crosses an elevation slope.
  const detailed = new Set<number>();
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const a = z * stride + x, corners = [a, a + 1, a + stride, a + stride + 1];
    const wet = corners.map(i => wetness[i]), heights = corners.map(i => natural[i]);
    if (Math.max(...wet) > .05 && Math.min(...wet) < .98 && Math.max(...heights) - Math.min(...heights) > .025)
      detailed.add(z * resolution + x);
  }
  const refined = new Map<string, number>();
  const vertex = (x: number, z: number) => {
    if (Number.isInteger(x) && Number.isInteger(z)) return z * stride + x;
    const key = `${x}:${z}`, found = refined.get(key);
    if (found !== undefined) return found;
    const gx = x / 12 - 2, gz = z / 12 - 2, sample = terrainSample(world, gx, gz), i = coverage.length;
    positions.push(toScene(gx), sample.height, toScene(gz)); colors.push(1, 1, 1); coverage.push(sample.coverage);
    refined.set(key, i); return i;
  };
  const fine = (x: number, z: number) => x >= 0 && z >= 0 && x < resolution && z < resolution && detailed.has(z * resolution + x);
  const subdivisions = 4;
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    if (fine(x, z)) {
      for (let iz = 0; iz < subdivisions; iz++) for (let ix = 0; ix < subdivisions; ix++) {
        const xx = x + ix / subdivisions, zz = z + iz / subdivisions, step = 1 / subdivisions;
        const a = vertex(xx, zz), b = vertex(xx + step, zz), c = vertex(xx, zz + step), d = vertex(xx + step, zz + step);
        triangle(a, c, b); triangle(b, c, d);
      }
    } else if (fine(x - 1, z) || fine(x + 1, z) || fine(x, z - 1) || fine(x, z + 1)) {
      // Share boundary vertices with finer neighbours instead of leaving cracks.
      const ring: number[] = [];
      for (const [ax, az, bx, bz, split] of [[x,z,x,z+1,fine(x-1,z)], [x,z+1,x+1,z+1,fine(x,z+1)],
        [x+1,z+1,x+1,z,fine(x+1,z)], [x+1,z,x,z,fine(x,z-1)]] as [number,number,number,number,boolean][]) {
        const steps = split ? subdivisions : 1;
        for (let k = 0; k < steps; k++) ring.push(vertex(ax + (bx-ax)*k/steps, az + (bz-az)*k/steps));
      }
      const center = vertex(x + .5, z + .5);
      for (let k = 0; k < ring.length; k++) triangle(center, ring[k], ring[(k+1)%ring.length]);
    } else {
      const a = z * stride + x;
      triangle(a, a + stride, a + 1); triangle(a + 1, a + stride, a + stride + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.02,
    }),
  );
  ground.receiveShadow = true;
  ground.castShadow = true;
  ground.name = "continuous-ground";
  ground.userData.interactionOccluder = true;
    group.add(ground);

  const apronPositions: number[] = [],
    apronColors: number[] = [],
    apronIndices: number[] = [];
  const rings = [0, .5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 120];
  for (let side = 0; side < 4; side++) {
    const offset = apronPositions.length / 3;
    for (const distance of rings)
      for (let i = 0; i <= resolution; i++) {
        const t = i / resolution,
          ringExtent = extent + distance;
        let x = 0,
          z = 0;
        if (side === 0) {
          x = -ringExtent + 2 * ringExtent * t;
          z = -ringExtent;
        }
        if (side === 1) {
          x = ringExtent;
          z = -ringExtent + 2 * ringExtent * t;
        }
        if (side === 2) {
          x = ringExtent - 2 * ringExtent * t;
          z = ringExtent;
        }
        if (side === 3) {
          x = -ringExtent;
          z = ringExtent - 2 * ringExtent * t;
        }
        const gx = (x + world.size - 1) / 2,
          gz = (z + world.size - 1) / 2;
        const sample = terrainSample(world, gx, gz);
        const f = Math.min(1, distance / 5),
          blend = f * f * (3 - 2 * f);
        apronPositions.push(x, sample.height, z);
        sampleColor.setRGB(0, 0, 0);
        for (const name of ["plain", "rough", "slick", "soft"] as const) {
          sampleColor.r += palette[name].r * sample.weights[name];
          sampleColor.g += palette[name].g * sample.weights[name];
          sampleColor.b += palette[name].b * sample.weights[name];
        }
        if (sample.coverage < 0.5) sampleColor.copy(palette.plain);
        sampleColor.lerp(palette.plain, blend);
        apronColors.push(sampleColor.r, sampleColor.g, sampleColor.b);
      }
    for (let r = 0; r < rings.length - 1; r++)
      for (let i = 0; i < resolution; i++) {
        const a = offset + r * stride + i,
          b = a + 1,
          c = a + stride,
          d = c + 1;
        apronIndices.push(a, b, c, b, d, c);
      }
  }
  const apronGeometry = new THREE.BufferGeometry();
  apronGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(apronPositions, 3),
  );
  apronGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(apronColors, 3),
  );
  apronGeometry.setIndex(apronIndices);
  apronGeometry.computeVertexNormals();
  const apron = new THREE.Mesh(
    apronGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      side: THREE.DoubleSide,
    }),
  );
  apron.receiveShadow = true;
  apron.name = "distant-ground";
  apron.userData.interactionOccluder = true;
    group.add(apron);
  const sides: number[] = [];
  for (const [a, b] of boundary.values()) {
    const ax = positions[a * 3],
      ay = positions[a * 3 + 1],
      az = positions[a * 3 + 2],
      bx = positions[b * 3],
      by = positions[b * 3 + 1],
      bz = positions[b * 3 + 2];
    if (
      (Math.abs(ax) === extent && ax === bx) ||
      (Math.abs(az) === extent && az === bz)
    )
      continue;
    sides.push(
      ax,
      ay,
      az,
      ax,
      -18,
      az,
      bx,
      by,
      bz,
      bx,
      by,
      bz,
      ax,
      -18,
      az,
      bx,
      -18,
      bz,
    );
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute("position", new THREE.Float32BufferAttribute(sides, 3));
  skirt.computeVertexNormals();
  const wallColors: number[] = [];
  for (let i = 0; i < sides.length; i += 3) {
    const shade =
      0.06 + 0.7 * Math.max(0, Math.min(1, (sides[i + 1] + 18) / 20));
    wallColors.push(shade, shade, shade);
  }
  skirt.setAttribute("color", new THREE.Float32BufferAttribute(wallColors, 3));
  const bank = new THREE.Mesh(
    skirt,
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      vertexColors: true,
      roughness: 1,
      side: THREE.DoubleSide,
    }),
  );
  bank.receiveShadow = true;
  bank.name = "terrain-bank";
  bank.userData.interactionOccluder = true;
    group.add(bank);
  if (world.terrain?.tiles.some((t) => isHole(t))) {
    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(world.size * 2, world.size * 2),
      new THREE.MeshStandardMaterial({ color: "#121519", roughness: 1 }),
    );
    bottom.name = "hole-bottom";
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -18;
    group.add(bottom);
  }

  const foundationDepth = 0.35;
  const architecture: {
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
    rotation?: THREE.Quaternion;
    ladder?: boolean;
  }[] = [];
  for (const s of structures) {
    const x = toScene(s.x),
      z = toScene(s.z),
      y = s.height * LEVEL;
    if (s.kind === "stairs") {
      const bottom = new THREE.Vector3(toScene(s.x+s.dx*.16), terrainSample(world,s.x+s.dx*.16,s.z+s.dz*.16).height+.09, toScene(s.z+s.dz*.16));
      const top = new THREE.Vector3(toScene(s.x+s.dx*.84), terrainSample(world,s.x+s.dx*.84,s.z+s.dz*.84).height+.09, toScene(s.z+s.dz*.84));
      const direction = top.clone().sub(bottom);
      const rungCount = Math.max(3,Math.ceil(direction.length()/.46));
      for (let step = 0; step < rungCount; step++) {
        const along = (step+.5)/rungCount, t = .16+.68*along,
          gx = s.x + s.dx * t,
          gz = s.z + s.dz * t;
        architecture.push({
          x: toScene(gx),
          z: toScene(gz),
          y: terrainSample(world,gx,gz).height+.07,
          w: s.dx ? .065 : .5,
          d: s.dz ? .065 : .5,
          h: .035,
          ladder: true,
        });
        for (const side of [-1,1]) {
          const railPoint = (part: number) => {
            const g=.16+.68*part, rx=s.x+s.dx*g-s.dz*.125*side, rz=s.z+s.dz*g+s.dx*.125*side;
            return new THREE.Vector3(toScene(rx),terrainSample(world,rx,rz).height+.065,toScene(rz));
          };
          const a=railPoint(step/rungCount), b=railPoint((step+1)/rungCount);
          const rail=b.clone().sub(a), center=a.clone().add(b).multiplyScalar(.5);
          architecture.push({x:center.x,y:center.y,z:center.z,w:.04,h:rail.length()+.012,d:.04,
            rotation:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),rail.normalize()),ladder:true});
        }

      }
    }
    if (s.kind === "bridge") {
      architecture.push({ x, z, y: y - foundationDepth / 2, w: 2, d: 2, h: foundationDepth });
    }
    if (s.kind === "canopy") {
      architecture.push({ x, z, y: y + 3.25, w: 4.8, d: 4.8, h: 0.16 });
      for (const dx of [-2, 2])
        for (const dz of [-2, 2]) {
          const base = terrainSample(world, s.x + dx / 2, s.z + dz / 2).height;
          architecture.push({
            x: x + dx,
            z: z + dz,
            y: (y + 3.25 + base) / 2,
            w: 0.1,
            d: 0.1,
            h: y + 3.25 - base,
          });
        }
    }
  }
  const matrix = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  for (const ladder of [false,true]) {
    const pieces=architecture.filter(piece=>!!piece.ladder === ladder);
    if (!pieces.length) continue;
    const built = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: ladder ? "#a0a0a0" : "#858585", roughness: 1 }),
      pieces.length,
    );
    pieces.forEach((b, i) => {
      matrix.compose(p.set(b.x, b.y, b.z), b.rotation ?? q, scale.set(b.w, b.h, b.d));
      built.setMatrixAt(i, matrix);
    });
    built.castShadow = built.receiveShadow = true;
    built.name = ladder ? "abstract-ladders" : "lightweight-structures";
    built.userData.interactionOccluder = true;
    group.add(built);
  }


  const pebbles: {
    x: number;
    y: number;
    z: number;
    appearance: ReturnType<typeof stoneAppearance>;
  }[] = [];
  const hasScatter = world.terrain?.tiles.some(
    (t) => !isHole(t) && t.surface === "rough",
  );
  const attempts = hasScatter
    ? Math.min(world.size * world.size * 750, 90000)
    : 0;
  for (let n = 0; n < attempts; n++) {
    const x = random() * world.size - 0.5,
      z = random() * world.size - 0.5,
      sample = terrainSample(world, x, z);
    if (sample.coverage < 0.6) continue;
    const onStairs = structures.some(
      (s) =>
        s.kind === "stairs" &&
        Math.abs(x - (s.x + s.dx * 0.5)) < 0.55 &&
        Math.abs(z - (s.z + s.dz * 0.5)) < 0.55,
    );
    if (onStairs) continue;
    if (sample.weights.rough > 0.5 && random() < 0.035 && pebbles.length < 900)
      pebbles.push({
        x: toScene(x),
        y: sample.height,
        z: toScene(z),
        appearance: stoneAppearance(world.terrain?.seed ?? 0, x, z),
      });
  }
  if (pebbles.length) {
    const grainData = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) {
      const value = 150 + Math.floor(random() * 105);
      grainData.set([value, value, value, 255], i * 4);
    }
    const stoneGrain = new THREE.DataTexture(
      grainData,
      64,
      64,
      THREE.RGBAFormat,
    );
    stoneGrain.wrapS = stoneGrain.wrapT = THREE.RepeatWrapping;
    stoneGrain.magFilter = THREE.LinearFilter;
    stoneGrain.minFilter = THREE.LinearFilter;
    stoneGrain.needsUpdate = true;
    const stoneMaterial = new THREE.MeshStandardMaterial({
      color: "#ffffff", roughness: 0.92, bumpMap: stoneGrain, bumpScale: 0.018,
    });
    stoneMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = "attribute vec3 stoneVariant; varying vec3 vStoneVariant; varying vec3 vStonePoint;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvStoneVariant = stoneVariant; vStonePoint = position;");
      shader.fragmentShader = `varying vec3 vStoneVariant;
        varying vec3 vStonePoint;
        float stoneHash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
        float stoneNoise(vec3 p) {
          vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(stoneHash(i),stoneHash(i+vec3(1,0,0)),f.x),
                         mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),
                         mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        vec3 sp = vStonePoint * vStoneVariant.y + vStoneVariant.z;
        float mottling = stoneNoise(sp * 4.0);
        float grainFade = 1.0-smoothstep(.4,1.6,length(fwidth(sp*37.0)));
        float grain = mix(.5,stoneNoise(sp * 37.0),grainFade);
        float vein = 1.0-smoothstep(0.035,0.13,abs(sin(sp.y*8.0+sp.x*3.0+mottling*4.0)));
        float finish = vStoneVariant.x;
        float tone = finish < 0.5 ? 0.65+mottling*0.5+grain*0.3
          : finish < 1.5 ? 0.8+mottling*0.3+vein*0.26
          : 0.7+mottling*0.4+smoothstep(0.55,0.8,grain)*0.35;
        diffuseColor.rgb *= tone;
      `);
    };
    const stoneCompile = stoneMaterial.onBeforeCompile;
    stoneMaterial.onBeforeCompile = (shader, renderer) => {
      stoneCompile.call(stoneMaterial, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = clamp(.86 + vStoneVariant.x*.035 + (grain-.5)*.04, .8, 1.);
      `);
    };
    for (let shape = 0; shape < STONE_SHAPES.length; shape++) {
      const batch = pebbles.filter(r => r.appearance.shape === shape);
      if (!batch.length) continue;
      const rockGeometry = stoneGeometry(shape);
      const stoneVariants = new Float32Array(batch.length * 3);
      rockGeometry.setAttribute("stoneVariant", new THREE.InstancedBufferAttribute(stoneVariants, 3));
      const rocks = new THREE.InstancedMesh(rockGeometry, stoneMaterial, batch.length);
      batch.forEach((r, i) => {
        const a = r.appearance;
        stoneVariants.set([a.texture, a.grain, a.offset], i * 3);
        const stoneColor = new THREE.Color(a.color);
        stoneColor.setScalar(stoneColor.r * .2126 + stoneColor.g * .7152 + stoneColor.b * .0722);
        rocks.setColorAt(i, stoneColor);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.angle);
        matrix.compose(
          p.set(r.x, r.y + a.size * a.height * .25, r.z),
          q,
          scale.set(a.size, a.size * a.height, a.size * a.depth),
        );
        rocks.setMatrixAt(i, matrix);
      });
      rocks.name = "scattered-stones";
      rocks.castShadow = rocks.receiveShadow = true;
      group.add(rocks);
    }
  }
  const stoneSurfaces = makeStoneSurfaces(world, group.children.filter(child => child.name === "scattered-stones") as THREE.InstancedMesh[]);
  group.add(stoneSurfaces.group);
  const paperField = makeWindField(world, structures, environment, geometry);
  group.add(paperField.group);
  const generated = makeEnvironment(world, environment, wind, geometry);
  group.add(generated.group);
  return {
    group,
    environment,
    setSurfaceImages: (actors: Actor[], assets: Asset[]) => {
      const treeImages = generated.setSurfaceImages(actors, assets);
      const rest = actors.filter(actor => !treeImages.has(actor.id));
      stoneSurfaces.setSurfaceImages(rest, assets);
      paperField.setSurfaceImages(rest, assets);
      return treeImages;
    },
    update: (time: number, camera?: THREE.Camera, mistColor?: THREE.Color, reducedMotion = false, weather: Weather = "clear", daylight = 1) => {
      wind.value = time / 1000;
      paperField.wind.time.value = time / 1000;
      paperField.wind.strength.value = reducedMotion ? 0 : 1;
      generated.update(time, camera, mistColor, reducedMotion, weather, daylight);
    },
  };
}
