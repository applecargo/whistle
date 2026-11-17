import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { randomSequence } from "../../lib/terrain.ts";
import { treeAppearance } from "../../lib/vegetation.ts";

type Joint = [number, number, number, number];

export function trunkTreeGeometry(profile: ReturnType<typeof treeAppearance>) {
  const random = randomSequence(profile.seed);
  const height = 2 + profile.height * .65;
  const girth = .85 + profile.trunkRadius * .7;
  const spread = .9 + random() * .25;
  const mirror = random() < .5 ? -1 : 1;
  const parts: THREE.BufferGeometry[] = [];
  const paths: Joint[][] = [];
  const add = (joints: Joint[]) => { paths.push(joints); return joints; };
  const trunk = add([
    [0, 0, 0, .032], [-.025, .12, .012, .026], [-.09, .27, .018, .022],
    [-.13, .43, -.015, .018], [-.15, .59, .01, .014], [-.23, .74, .025, .009],
    [-.34, .87, .04, .005], [-.4, 1.01, .02, .0007],
  ]);
  const right = add([trunk[2], [.025, .4, .045, .017], [.055, .56, .065, .013],
    [.12, .7, .09, .008], [.16, .84, .075, .004], [.15, .94, .09, .0006]]);
  const leader = add([trunk[3], [-.1, .59, -.085, .012], [-.055, .77, -.09, .008],
    [-.045, .93, -.07, .0038], [.02, 1.08, -.09, .0006]]);
  const left = add([trunk[4], [-.29, .69, -.03, .01], [-.42, .76, -.045, .006],
    [-.55, .79, -.02, .0032], [-.65, .81, 0, .0006]]);
  const low = add([trunk[1], [.08, .24, -.025, .015], [.14, .39, -.04, .009],
    [.12, .51, -.055, .005], [.18, .62, -.045, .0008]]);
  add([right[2], [.2, .63, .13, .006], [.25, .75, .15, .0028], [.31, .8, .13, .0005]]);
  add([right[3], [.085, .82, .2, .0045], [.04, .89, .24, .0005]]);
  add([leader[1], [-.025, .7, -.19, .006], [.005, .84, -.22, .003], [-.01, .93, -.2, .0005]]);
  add([left[1], [-.32, .82, -.12, .006], [-.4, .94, -.14, .0025], [-.44, 1.02, -.13, .0005]]);
  add([low[2], [.26, .47, -.09, .005], [.31, .55, -.12, .0023], [.36, .59, -.13, .0005]]);
  add([trunk[2], [-.19, .37, .1, .009], [-.24, .49, .18, .005], [-.22, .62, .22, .0006]]);
  add([trunk[3], [-.24, .48, -.13, .006], [-.31, .56, -.22, .0027], [-.34, .65, -.26, .0005]]);
  add([right[1], [.07, .51, .2, .008], [.04, .65, .27, .004], [.1, .77, .32, .0006]]);
  // Small forks emerge along the limbs, leaving open space between the main stems.
  for (const path of [...paths]) {
    for (let i = 1; i < path.length - 1; i++) {
      if (random() > .65) continue;
      const p = path[i], next = path[i + 1];
      const side = random() < .5 ? -1 : 1;
      const length = .045 + random() * .09;
      const dx = (next[0] - p[0]) * .35 + side * length * .5;
      const dz = (random() - .5) * length * 1.3;
      add([[p[0], p[1], p[2], p[3] * .43],
        [p[0] + dx * .65, p[1] + length * .6, p[2] + dz * .65, p[3] * .19],
        [p[0] + dx, p[1] + length, p[2] + dz, .00035]]);
    }
  }
  for (const [branchIndex, source] of paths.entries()) {
    const path = source.map(joint => [...joint] as Joint);
    const character = random();
    if (branchIndex) path[0][3] = Math.min(path[0][3] * .72, path[1][3] * 1.15);
    const last = path.length - 1;
    if (branchIndex && character < .3) {
      const end = path[last], prev = path[last - 1];
      const length = .35 + random() * .35;
      for (let axis = 0; axis < 3; axis++) end[axis] = THREE.MathUtils.lerp(prev[axis], end[axis], length);
      end[3] = prev[3] * (.4 + random() * .25);
    } else {
      path[last][0] += (random() - .5) * .025;
      path[last][2] += (random() - .5) * .02;
      path[last][3] *= 1.5 + random() * 2.5;
    }
    const phase = random() * Math.PI * 2;
    const knotAt = .25 + random() * .55;
    const oval = .055 + random() * .07;
    const joints: Joint[] = [];
    path.forEach((joint, i) => {
      if (i) {
        const prev = path[i - 1];
        const at = .3 + random() * .4;
        const bend = Math.min(.006, prev[3] * .3);
        joints.push([THREE.MathUtils.lerp(prev[0], joint[0], at) + (random() - .5) * bend,
          THREE.MathUtils.lerp(prev[1], joint[1], at),
          THREE.MathUtils.lerp(prev[2], joint[2], at) + (random() - .5) * bend,
          THREE.MathUtils.lerp(prev[3], joint[3], at)]);
      }
      joints.push(joint);
    });
    const points = joints.map(([x, y, z]) => new THREE.Vector3(
      (x * spread * mirror + profile.lean * y * .09) * height, y * height, z * height));
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", .18 + character * .2);
    const segments = (joints.length - 1) * 5;
    const geometry = new THREE.TubeGeometry(curve, segments, 1, path[0][3] > .012 ? 12 : 8, false);
    const positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    for (let i = 0; i < positions.count; i++) {
      const t = uv.getX(i), angle = uv.getY(i) * Math.PI * 2;
      const section = curve.getUtoTmapping(t, 0) * (joints.length - 1);
      const index = Math.min(joints.length - 2, Math.floor(section));
      const radius = THREE.MathUtils.lerp(joints[index][3], joints[index + 1][3], section - index) * height * girth;
      const knot = Math.exp(-Math.pow((t - knotAt) / .07, 2)) * (.025 + character * .035);
      const ridge = .045 * Math.sin(angle * 5 + Math.sin(t * 17 + phase) * .45 + phase)
        + .018 * Math.sin(angle * 9 - t * 12 + phase);
      const size = radius * (1 + oval * Math.cos(angle * 2 + phase) + ridge + knot)
        * (1 + .012 * Math.sin(t * 15 + phase));
      const center = curve.getPointAt(t);
      const splinter = t > .999 && character < .3 ? curve.getTangentAt(1).multiplyScalar(radius * (.35 * Math.sin(angle * 3 + phase) + .25 * Math.cos(angle * 5))) : new THREE.Vector3();
      positions.setXYZ(i, center.x + (positions.getX(i) - center.x) * size + splinter.x,
        center.y + (positions.getY(i) - center.y) * size + splinter.y,
        center.z + (positions.getZ(i) - center.z) * size + splinter.z);
    }
    // Close the uneven ends so broken limbs have a visible cut face.
    const sides = path[0][3] > .012 ? 12 : 8;
    const capPositions = Array.from(positions.array), capUv = Array.from(uv.array);
    const indices = Array.from(geometry.index!.array);
    for (const end of [0, segments]) {
      const center = new THREE.Vector3();
      for (let j = 0; j < sides; j++) center.add(new THREE.Vector3().fromBufferAttribute(positions, end * (sides + 1) + j));
      center.divideScalar(sides);
      const centerIndex = capPositions.length / 3;
      capPositions.push(center.x, center.y, center.z); capUv.push(.5, .5);
      for (let j = 0; j < sides; j++) {
        const a = end * (sides + 1) + j, b = a + 1;
        indices.push(centerIndex, end ? b : a, end ? a : b);
      }
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(capPositions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(capUv, 2));
    geometry.deleteAttribute("normal");
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const colors: number[] = [];
    for (let i = 0; i < capPositions.length / 3; i++) {
      const t = capUv[i * 2], angle = capUv[i * 2 + 1] * Math.PI * 2;
      const groove = Math.sin(angle * 5 + Math.sin(t * 17 + phase) * .45 + phase);
      const grain = Math.sin(t * 183 + angle * 7 + phase) * Math.sin(t * 67 - angle * 11);
      const heightRatio = THREE.MathUtils.clamp(capPositions[i * 3 + 1] / height, 0, 1);
      const tone = .46 + .45 * Math.pow(heightRatio, .7) + .065 * groove + .025 * grain;
      colors.push(tone, tone, tone);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    parts.push(geometry);
  }
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  geometry.rotateY(profile.rotation);
  geometry.computeBoundingBox();
  return geometry;
}
