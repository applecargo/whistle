import * as THREE from "three";
import { PIXEL_PALETTE_GLSL } from "./PixelPalette.ts";

export function makeDitheredSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { daylight: {value: 1}, cloudAmount: {value: .35} },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        gl_Position.z=gl_Position.w;
      }
    `,
    fragmentShader: `
      ${PIXEL_PALETTE_GLSL}
      uniform float daylight, cloudAmount;
      varying vec3 skyDirection;
      float skyHash(vec3 p) {
        p=fract(p*.1031); p+=dot(p,p.yzx+33.33);
        return fract((p.x+p.y)*p.z);
      }
      float skyNoise(vec3 p) {
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(skyHash(i),skyHash(i+vec3(1,0,0)),f.x),
          mix(skyHash(i+vec3(0,1,0)),skyHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(skyHash(i+vec3(0,0,1)),skyHash(i+vec3(1,0,1)),f.x),
          mix(skyHash(i+vec3(0,1,1)),skyHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float clouds(vec3 p) {
        return skyNoise(p)*.57+skyNoise(p*2.03+7.2)*.28+skyNoise(p*4.11+19.3)*.15;
      }
      void main() {
        vec3 direction=normalize(skyDirection);
        vec3 p=direction*vec3(3.8,5.5,3.8)+vec3(13.2,2.7,6.3);
        float field=clouds(p);
        float mass=smoothstep(.58-cloudAmount*.19,.76-cloudAmount*.12,field);
        float shadow=clamp((clouds(p+vec3(0,.17,0))-field)*5.0,0.0,1.0);
        float elevation=smoothstep(-.06,.42,direction.y);
        float fringe=4.0*mass*(1.0-mass);
        float paper=1.0-(fringe*.52+shadow*mass*.3)*cloudAmount*elevation;
        float veils=clouds(p*.57+vec3(4.1,7.3,1.9));
        float night=.025+elevation*(mass*(.1+veils*.22)+fringe*.055-shadow*mass*.065);
        paper=mix(night,paper,daylight);
        vec2 spherical=vec2(atan(direction.z,direction.x)/6.2831853+.5,asin(direction.y)/3.14159265+.5);
        vec2 cell=floor(spherical*vec2(2048.0,1024.0));
        vec2 a=mod(cell,2.0), b=mod(floor(cell/2.0),2.0);
        float threshold=(4.0*(2.0*a.x+3.0*a.y-4.0*a.x*a.y)+2.0*b.x+3.0*b.y-4.0*b.x*b.y+.5)/16.0;
        vec2 micro=floor(spherical*vec2(4096.0,2048.0));
        float grain=skyHash(vec3(micro,13.0));
        threshold=mix(threshold,grain,.18);
        float tone=pixelTone(paper,threshold,1.0);
        tone=mix(pixelHorizon(daylight),tone,smoothstep(.02,.2,direction.y));
        gl_FragColor=vec4(vec3(pixelLinear(tone)),1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2,64,32),material);
  mesh.name="dithered-sky";
  mesh.frustumCulled=false;
  mesh.renderOrder=-1000;
  return mesh;
}
