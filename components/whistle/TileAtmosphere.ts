import * as THREE from "three";
import type { Environment } from "../../lib/environment.ts";
import type { World, Weather } from "../../lib/world.ts";
import { LEVEL, randomSequence, terrainSample } from "../../lib/terrain.ts";

export function makeTileAtmosphere(world: World, env: Environment, clock: { value: number }) {
  const group = new THREE.Group(); group.name = "tile-atmosphere";
  const random = randomSequence((world.terrain?.seed ?? 0) ^ 0x47aa);
  const positions: number[] = [], kinds: number[] = [], seeds: number[] = [], strengths: number[] = [];
  const budgets = [240, 120, 80];
  const fields = ["rain", "dust", "lift"] as const;
  for (let kind = 0; kind < fields.length; kind++) {
    const field = fields[kind];
    const regions = env.regions.map(region => region.cells.filter(i => env.cells[i][field] > .05)).filter(cells => cells.length);
    if (!regions.length) continue;
    const count = Math.min(budgets[kind], regions.reduce((sum, cells) => sum + cells.length * (kind === 0 ? 28 : 10), 0));
    for (let n = 0; n < count; n++) {
      const cells = regions[n % regions.length], i = cells[Math.floor(random() * cells.length)];
      const x = i % world.size + (random() - .5) * .75, z = Math.floor(i / world.size) + (random() - .5) * .75;
      const cell = env.cells[i];
      const base = kind === 2 ? cell.liftCeiling - 1.7 : Math.max(terrainSample(world, x, z).height, cell.water ?? -Infinity);
      positions.push(x * 2 - world.size + 1, base, z * 2 - world.size + 1);
      kinds.push(kind); seeds.push(random(), random()); strengths.push(cell[field]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("particleKind", new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setAttribute("seed", new THREE.Float32BufferAttribute(seeds, 2));
  geometry.setAttribute("strength", new THREE.Float32BufferAttribute(strengths, 1));
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), effectTime: clock,
      motion: { value: 1 }, globalRain: { value: 0 }, daylight: { value: 1 } },
    vertexShader: `attribute float particleKind, strength; attribute vec2 seed;
      uniform float effectTime, motion, globalRain; varying float kind, opacity;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        kind=particleKind; float t=effectTime*motion; vec3 p=position;
        float phase=fract(seed.x+t*(kind<.5?-1.1:kind<1.5?.09:.23));
        p.y+=kind<.5?phase*3.4:kind<1.5?.16+phase*.65:phase*2.0;
        p.x+=sin(t*.6+seed.y*6.28)*(kind<.5?.06:.16);
        p.z+=cos(t*.4+seed.x*6.28)*.1;
        vec4 mvPosition=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mvPosition;
        gl_PointSize=clamp((kind<.5?28.:kind<1.5?14.:20.)/max(1.,-mvPosition.z),1.,7.);
        opacity=strength*sin(phase*3.14159)*motion*(kind<.5?1.-globalRain:1.);
        #include <fog_vertex>
      }`,
    fragmentShader: `varying float kind, opacity; uniform float daylight;
      #include <common>
      #include <fog_pars_fragment>
      void main(){vec2 uv=gl_PointCoord-.5; if(kind<.5)uv.x*=3.;
        float alpha=(1.-smoothstep(.1,.5,length(uv)))*opacity*.36;
        gl_FragColor=vec4(vec3(kind<1.5?.65: .9)*(.35+daylight*.65),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }` });
  const particles = new THREE.Points(geometry, material); particles.name = "tile-particles";
  particles.frustumCulled = false; particles.userData.budget = budgets.reduce((a, b) => a + b, 0);
  group.add(particles);
  const beams: { mesh: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>; light?: THREE.PointLight; strength: number; flicker: number }[] = [];
  for (const region of env.regions.filter(r => r.kind === "hole")) {
    const candidates = region.cells.filter(i => env.cells[i].focus > 0).sort((a, b) => env.cells[b].focus - env.cells[a].focus);
    if (!candidates.length || beams.length >= 4) continue;
    const i = candidates[0], cell = env.cells[i];
    const height = 3.2, base = (world.terrain?.tiles[i].height ?? 0) * LEVEL - .6;
    const beamMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, uniforms: { strength: { value: cell.focus } },
      vertexShader: `varying vec2 vBeam;void main(){vBeam=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 vBeam;uniform float strength;void main(){float fade=sin(vBeam.y*3.14159);gl_FragColor=vec4(vec3(.9,.94,1.),fade*strength*.09);}` });
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(.85, height, 16, 1, true), beamMaterial);
    mesh.geometry.rotateZ(Math.PI); mesh.position.set(i % world.size * 2 - world.size + 1, base + height / 2, Math.floor(i / world.size) * 2 - world.size + 1);
    mesh.name = "tile-focus-beam"; group.add(mesh);
    let light: THREE.PointLight | undefined;
    if (beams.length < 2) {
      light = new THREE.PointLight("#eef3ff", cell.focus * .6, 6, 2);
      light.position.copy(mesh.position); light.castShadow = false; group.add(light);
    }
    beams.push({ mesh, light, strength: cell.focus, flicker: cell.flicker });
  }
  return { group, update(time: number, weather: Weather, reducedMotion: boolean, daylight: number) {
    material.uniforms.motion.value = reducedMotion ? 0 : 1;
    material.uniforms.globalRain.value = weather === "rain" ? 1 : 0;
    material.uniforms.daylight.value = daylight;
    beams.forEach((beam, i) => {
      const pulse = reducedMotion || !beam.flicker ? 1 : .86 + .14 * Math.sin(time * .0017 + i * 2.3);
      beam.mesh.material.uniforms.strength.value = beam.strength * pulse;
      if (beam.light) beam.light.intensity = beam.strength * pulse * .6;
    });
  } };
}
