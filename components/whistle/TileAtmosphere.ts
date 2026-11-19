import * as THREE from "three";
import { environmentAt, type Environment } from "../../lib/environment.ts";
import type { World } from "../../lib/world.ts";
import { randomSequence, terrainSample } from "../../lib/terrain.ts";
import { makeFlickerShadows } from "./FlickerShadows.ts";
import { PIXEL_PALETTE_GLSL } from "./PixelPalette.ts";

export function makeTileAtmosphere(world: World, env: Environment, clock: { value: number }) {
  const group = new THREE.Group(); group.name = "tile-atmosphere";
  const random = randomSequence((world.terrain?.seed ?? 0) ^ 0x47aa);
  const positions: number[] = [], kinds: number[] = [], seeds: number[] = [], strengths: number[] = [], winds: number[] = [];
  const fields = [{ field: "dust", kind: 1, budget: 120 }, { field: "lift", kind: 2, budget: 80 }] as const;
  for (const { field, kind, budget } of fields) {
    const regions = env.regions.map(region => region.cells.filter(i => env.cells[i][field] > .05)).filter(cells => cells.length);
    if (!regions.length) continue;
    const count = Math.min(budget, regions.reduce((sum, cells) => sum + cells.length * (kind === 2 ? 32 : 10), 0));
    for (let n = 0; n < count; n++) {
      const cells = regions[n % regions.length], i = cells[Math.floor(random() * cells.length)];
      let x = 0, z = 0, inside = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const spread = kind === 2 ? .56 : .75;
        x = i % world.size + (random() - .5) * spread;
        z = Math.floor(i / world.size) + (random() - .5) * spread;
        inside = kind !== 2 || [-.04, 0, .04].every(dx => [-.04, 0, .04].every(dz =>
          terrainSample(world, x + dx, z + dz).coverage < .5 && environmentAt(env, x + dx, z + dz).lift > .12));
        if (inside) break;
      }
      if (!inside) continue;
      const cell = env.cells[i];
      const base = kind === 2 ? environmentAt(env, x, z).liftCeiling - 1.3 : Math.max(terrainSample(world, x, z).height, cell.water ?? -Infinity);
      positions.push(x * 2 - world.size + 1, base, z * 2 - world.size + 1);
      kinds.push(kind); seeds.push(random(), random()); strengths.push(cell[field]); winds.push(cell.windX, cell.windZ);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("particleWind", new THREE.Float32BufferAttribute(winds, 2));
  geometry.setAttribute("particleKind", new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setAttribute("seed", new THREE.Float32BufferAttribute(seeds, 2));
  geometry.setAttribute("strength", new THREE.Float32BufferAttribute(strengths, 1));
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), effectTime: clock,
      motion: { value: 1 }, daylight: { value: 1 } },
    vertexShader: `attribute float particleKind, strength; attribute vec2 seed, particleWind;
      uniform float effectTime, motion; varying float kind, opacity, grain;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        kind=particleKind; grain=seed.y; float t=effectTime*motion; vec3 p=position;
        float phase=fract(seed.x+t*(kind<1.5?.09:mix(.045,.065,seed.y)));
        p.y+=kind<1.5?.16+phase*.65:phase*3.2;
        p.x+=sin(t*(kind>1.5?.22:.6)+seed.y*6.28)*(kind<1.5?.16:.07);
        p.z+=cos(t*(kind>1.5?.18:.4)+seed.x*6.28)*(kind>1.5?.07:.1);
        if(kind<1.5)p.xz+=particleWind*(phase-.5)*.5;
        vec4 mvPosition=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mvPosition;
        gl_PointSize=clamp((kind<1.5?14.:20.)/max(1.,-mvPosition.z),1.,7.);
        if(kind>1.5)gl_PointSize=clamp(mix(13.,20.,seed.y)/max(1.,-mvPosition.z),1.,4.);
        opacity=strength*sin(phase*3.14159)*(kind>1.5?1.:motion);
        #include <fog_vertex>
      }`,
    fragmentShader: `${PIXEL_PALETTE_GLSL}
      varying float kind, opacity, grain; uniform float daylight;
      #include <common>
      #include <fog_pars_fragment>
      void main(){vec2 uv=gl_PointCoord-.5;
        if(kind>1.5){
          vec2 cell=floor(gl_PointCoord*4.0), a=mod(cell,2.0), b=mod(floor(cell/2.0),2.0);
          float threshold=(4.0*(2.0*a.x+3.0*a.y-4.0*a.x*a.y)+2.0*b.x+3.0*b.y-4.0*b.x*b.y+.5)/16.0;
          float coverage=opacity*(1.-smoothstep(.28,.6,length(uv)));
          if(coverage<threshold)discard;
          float tone=mix(grain<.5?.7:.85,grain<.5?.15:.3,daylight);
          gl_FragColor=vec4(vec3(pixelLinear(tone)),1.);
        }else{
          float alpha=(1.-smoothstep(.1,.5,length(uv)))*opacity*.36;
          gl_FragColor=vec4(vec3(.65)*(.35+daylight*.65),alpha);
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }` });
  const particles = new THREE.Points(geometry, material); particles.name = "tile-particles";
  particles.frustumCulled = false; particles.userData.budget = fields.reduce((sum, field) => sum + field.budget, 0);
  group.add(particles);
  const shadows = makeFlickerShadows(world, env, clock);
  if (shadows.group.children.length) group.add(shadows.group);
  return { group, update(_time: number, reducedMotion: boolean, daylight: number) {
    material.uniforms.motion.value = reducedMotion ? 0 : 1;
    material.uniforms.daylight.value = daylight;
    shadows.update(reducedMotion, daylight);
  } };
}
