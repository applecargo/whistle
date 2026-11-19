import * as THREE from "three";
import { GUST_GLSL } from "../../lib/environment-effects.ts";
import { randomSequence } from "../../lib/terrain.ts";
import { environmentAt, type Environment } from "../../lib/environment.ts";
import {
  TREE_SPECIES,
  treeAppearance,
  type TreeSpecies,
} from "../../lib/vegetation.ts";
import type { World } from "../../lib/world.ts";

type Branch = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
  tipRadius: number;
  color: THREE.Color;
};
type Leaf = {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  scale: THREE.Vector3;
  color: THREE.Color;
  wind: THREE.Vector2;
};


function leafGeometry(species: TreeSpecies) {
  const positions = [0,.025,0], colors = [.86,.86,.86], indices: number[] = [];
  const width = species === "pine" ? .095 : species === "maple" ? .15 : .12;
  const length = species === "ginkgo" ? .14 : .18;
  const segments = 16;
  for (let i=0;i<segments;i++) {
    const angle=i/segments*Math.PI*2;
    const lobe=1+.07*Math.sin(angle*3+.4);
    positions.push(Math.cos(angle)*width*lobe,Math.sin(angle)*.012,Math.sin(angle)*length*lobe);
    const tone=.76+.14*(Math.sin(angle)+1)*.5;
    colors.push(tone,tone,tone);
    indices.push(0,i+1,(i+1)%segments+1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function makeTrees(
  world: World,
  env: Environment,
  clock: { value: number },
) {
  const group = new THREE.Group();
  group.name = "generated-trees";
  const branches: Branch[] = [];
  const leaves: Record<TreeSpecies, Leaf[]> = {
    pine: [],
    zelkova: [],
    ginkgo: [],
    maple: [],
  };
  const profiles: ReturnType<typeof treeAppearance>[] = [];
  for (const tree of env.trees) {
    const profile = treeAppearance(world.terrain?.seed ?? 0, tree.x, tree.z);
    profiles.push(profile);
    const { species, height: h, width, lean, rotation } = profile;
    const branchStart = branches.length, leafStart = leaves[species].length;
    const random = randomSequence(profile.seed ^ 0x3b19);
    const foliageRandom=randomSequence(profile.seed ^ 0x6f27);
    const root = new THREE.Vector3(
      tree.x * 2 - world.size + 1,
      tree.height,
      tree.z * 2 - world.size + 1,
    );
    const c = environmentAt(env, tree.x, tree.z),
      wind = new THREE.Vector2(c.windX, c.windZ);
    const bark = new THREE.Color(
      species === "pine"
        ? "#606060"
        : species === "ginkgo"
          ? "#676767"
          : "#626262",
    );
    const base = new THREE.Color(
      species === "pine"
        ? "#5c5c5c"
        : species === "ginkgo"
          ? "#8a8a8a"
          : species === "maple"
            ? "#707070"
            : "#6c6c6c",
    );
    base.lerp(
      new THREE.Color(species === "pine" ? "#777777" : "#9c9c9c"),
      profile.tint * 0.3,
    );
    const trunkAt = (t: number) =>
      root
        .clone()
        .add(
          new THREE.Vector3(
            lean * t * t + Math.sin(t * 4) * 0.08,
            h * t,
            Math.sin(t * 3 + rotation) * 0.13 * t,
          ),
        );
    const branch = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      radius: number,
      curve = 0.12,
    ) => {
      let previous = a;
      for (let step = 1; step <= 5; step++) {
        const t = step / 5,
          end = a.clone().lerp(b, t);
        end.y += Math.sin(t * Math.PI) * curve;
        branches.push({
          a: previous,
          b: end,
          radius: radius * (1 - ((step - 1) / 5) * 0.62),
          tipRadius: radius * (1 - t * 0.62),
          color: bark,
        });
        previous = end;
      }
    };
    const crown = (
      center: THREE.Vector3,
      rx: number,
      ry: number,
      rz: number,
      count: number,
    ) => {


      for (let n = 0; n < Math.ceil(count * .85); n++) {
        const angle = random() * Math.PI * 2,
          y = random() * 2 - 1;
        const radial = Math.sqrt(1 - y * y) * Math.cbrt(random());
        const p = center
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(angle) * rx * radial,
              y * ry,
              Math.sin(angle) * rz * radial,
            ),
          );
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            (random() - 0.5) * 1.9,
            random() * Math.PI * 2,
            (random() - 0.5) * 1.7,
          ),
        );
        const s = (0.65 + random() * 0.65) * profile.leafSize;
        const color = base
          .clone()
          .multiplyScalar(0.7 + random() * 0.55 + (y + 1) * 0.05);
        if (foliageRandom() >= profile.leafDensity) continue;
        leaves[species].push({
          p,
          q,
          scale: new THREE.Vector3(s, s, s),
          color,
          wind,
        });
      }
    };
    const trunkEnd = profile.growth === "shrub" ? .22 :
      species === "zelkova" ? 0.6 : species === "maple" ? 0.58 : 1;
    for (let i = 0; i < 14; i++) {
      const r = profile.trunkRadius;
      branches.push({
        a: trunkAt((i / 14) * trunkEnd),
        b: trunkAt(((i + 1) / 14) * trunkEnd),
        radius: r * (1 - (i / 14) * 0.88),
        tipRadius: r * (1 - ((i + 1) / 14) * 0.88),
        color: bark,
      });
    }
    const limbs = profile.growth === "shrub" ? 7 : 5+(profile.seed%3);
    const crownForm=(profile.seed >>> 4)%3;
    const spread=crownForm === 0 ? 1.2 : crownForm === 1 ? .8 : 1.0;
    for (let k = 0; k < limbs; k++) {
      const t = k / (limbs - 1),
        angle = rotation + k * 2.39996 + (random() - 0.5) * 0.5;
        const y =
        species === "pine" ? .4+t*.38 : .34+t*.25;
      const start = trunkAt(profile.growth === "shrub" ? y * .35 : y);
      const reach =
        width * spread * (.45+random()*.35) * (species === "pine" ? 1-t*.32 : 1);
      const end = start
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(angle) * reach,
            (profile.growth === "shrub" ? .5 : .22+random()*.15) * h,
            Math.sin(angle) * reach,
          ),
        );
      branch(
        start,
        end,
        profile.trunkRadius * 0.27 * (1 - t * 0.5),
        species === "pine" ? -0.18 : 0.18,
      );
      const forks = 2;
      for (let f = 0; f < forks; f++) {
        const theta = angle + (f - (forks - 1) / 2) * 0.65;
        const tip = end
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(theta) * (width*(.12+random()*.15)),
              h*(.04+random()*.09),
              Math.sin(theta) * (width*(.12+random()*.15)),
            ),
          );
        branch(start.clone().lerp(end, 0.65 + f * 0.07), tip, profile.trunkRadius * 0.09, 0.08);
        crown(
          tip,
          width*spread*(.4+random()*.18),
          h*(crownForm === 1 ? .23 : .15),
          width*(.4+random()*.18),
          85,
        );
      }
    }
    crown(
      trunkAt(species === "pine" ? .86 : .72),
      width*spread*.62,
      h*(crownForm === 1 ? .28 : .21),
      width*.64,
      300,
    );

    const shrink = (p: THREE.Vector3) => p.sub(root).multiplyScalar(profile.scale).add(root);
    for (let i = branchStart; i < branches.length; i++) {
      const b = branches[i];

      b.a = shrink(b.a.clone());
      b.b = shrink(b.b.clone());
      b.radius *= profile.scale;
      b.tipRadius *= profile.scale;
    }
    for (let i = leafStart; i < leaves[species].length; i++) {
      const leaf = leaves[species][i];
      shrink(leaf.p);
      leaf.scale.multiplyScalar(profile.scale);
    }
  }
  group.userData.profiles = profiles;
  const matrix = new THREE.Matrix4(),
    s = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);
  if (branches.length) {
    const material = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      vertexColors: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "varying vec3 barkPosition;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nbarkPosition = position;",
      );
      shader.fragmentShader =
        "varying vec3 barkPosition;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float furrow=sin(barkPosition.x*63.0+barkPosition.z*57.0+sin(barkPosition.y*8.0)*.7);
        diffuseColor.rgb *= .82+.18*smoothstep(-.4,.6,furrow);`,
      );
    };
    const positions: number[] = [],
      normals: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    for (const b of branches) {
      const axis = b.b.clone().sub(b.a).normalize();
      const u = new THREE.Vector3()
        .crossVectors(
          axis,
          Math.abs(axis.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up,
        )
        .normalize();
      const v = new THREE.Vector3().crossVectors(axis, u).normalize();
      const start = positions.length / 3;
      for (let end = 0; end < 2; end++)
        for (let k = 0; k <= 12; k++) {
          const angle = (k / 12) * Math.PI * 2;
          const normal = u
            .clone()
            .multiplyScalar(Math.cos(angle))
            .addScaledVector(v, Math.sin(angle));
          const point = (end ? b.b : b.a)
            .clone()
            .addScaledVector(normal, end ? b.tipRadius : b.radius);
          positions.push(point.x, point.y, point.z);
          normals.push(normal.x, normal.y, normal.z);
          colors.push(b.color.r, b.color.g, b.color.b);
          if (!end && k < 12) {
            const n = start + k;
            indices.push(n, n + 1, n + 13, n + 1, n + 14, n + 13);
          }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const wood = new THREE.Mesh(geometry, material);
    wood.name = "generated-trunks";
    wood.castShadow = wood.receiveShadow = true;
    group.add(wood);
  }
  for (const species of TREE_SPECIES) {
    const instances = leaves[species];
    if (!instances.length) continue;
    const geometry = leafGeometry(species);
    geometry.setAttribute(
      "fieldWind",
      new THREE.InstancedBufferAttribute(
        new Float32Array(instances.flatMap((l) => [l.wind.x, l.wind.y])),
        2,
      ),
    );
    const material = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.environmentTime = clock;
      shader.vertexShader =
        "uniform float environmentTime; attribute vec2 fieldWind;\n" + GUST_GLSL +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float phase=environmentTime*1.4+instanceMatrix[3].x*.7+instanceMatrix[3].z;
        transformed.y+=sin(phase)*(.035+length(fieldWind)*(.02+.24*corridorGust(environmentTime)))*position.z;
      #endif`,
      );
    };
    const foliage = new THREE.InstancedMesh(
      geometry,
      material,
      instances.length,
    );
    instances.forEach((l, i) => {
      matrix.compose(l.p, l.q, l.scale);
      foliage.setMatrixAt(i, matrix);
      foliage.setColorAt(i, l.color);
    });
    foliage.name = `generated-leaves-${species}`;
    foliage.castShadow = foliage.receiveShadow = true;
    const shadowMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide,
    });
    shadowMaterial.onBeforeCompile = material.onBeforeCompile;
    foliage.customDepthMaterial = shadowMaterial;
    material.addEventListener("dispose", () => shadowMaterial.dispose());
    foliage.computeBoundingSphere();
    group.add(foliage);
  }
  return group;
}
