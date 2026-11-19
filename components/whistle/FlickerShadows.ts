import * as THREE from "three";
import type { Environment } from "../../lib/environment.ts";
import type { World } from "../../lib/world.ts";
import { terrainSample } from "../../lib/terrain.ts";
import { PIXEL_PALETTE_GLSL } from "./PixelPalette.ts";

export function makeFlickerShadows(world: World, env: Environment, clock: { value: number }) {
  const group = new THREE.Group(); group.name = "flicker-shadows";
  const motion = { value: 1 }, daylight = { value: 1 };
  env.cells.forEach((cell, i) => {
    if (!cell.flicker || cell.hole) return;
    const x = i % world.size, z = Math.floor(i / world.size);
    const geometry = new THREE.PlaneGeometry(1.7, 1.7, 8, 8); geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute("position");
    for (let n = 0; n < position.count; n++) {
      const gx = x + position.getX(n) / 2, gz = z + position.getZ(n) / 2;
      position.setXYZ(n, gx * 2 - world.size + 1, terrainSample(world, gx, gz).height + .015, gz * 2 - world.size + 1);
    }
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), effectTime: clock, motion, daylight,
        strength: { value: cell.flicker }, phase: { value: i * 2.3 } },
      vertexShader: `varying vec2 patchUv;
        #include <common>
        #include <fog_pars_vertex>
        void main(){patchUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `${PIXEL_PALETTE_GLSL}
        varying vec2 patchUv; uniform float effectTime, motion, daylight, strength, phase;
        #include <common>
        #include <fog_pars_fragment>
        void main(){
          float t=effectTime*motion;
          vec2 p=patchUv+vec2(sin(t*.4+phase),cos(t*.32+phase))*.08;
          float leaves=smoothstep(-.3,.6,sin(p.x*21.+phase)*cos(p.y*17.+phase));
          float edge=1.-smoothstep(.3,.5,length(patchUv-.5));
          float shade=leaves*edge*(.25+.18*sin(t*1.7+phase))*strength*daylight;
          vec2 a=mod(floor(gl_FragCoord.xy),2.), b=mod(floor(gl_FragCoord.xy/2.),2.);
          float threshold=(4.*(2.*a.x+3.*a.y-4.*a.x*a.y)+2.*b.x+3.*b.y-4.*b.x*b.y+.5)/16.;
          if(shade<threshold)discard;
          gl_FragColor=vec4(vec3(pixelLinear(.2)),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = "tile-flicker-shadow"; group.add(mesh);
  });
  return { group, update(reducedMotion: boolean, light: number) { motion.value = reducedMotion ? 0 : 1; daylight.value = light; } };
}
