import * as THREE from "three";
import type { treeAppearance } from "../../lib/vegetation.ts";

export function addNeutralGrain(material: THREE.MeshStandardMaterial, kind: "grass" | "bark", seed: number,
  bark?: ReturnType<typeof treeAppearance>["bark"]) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const variation = { value: ((seed >>> 0) % 997) / 997 };
  const barkStyle = { value: new THREE.Vector4(bark?.texture ?? 1, bark?.grain ?? 1, bark?.contrast ?? .08, bark?.relief ?? .0018) };
  material.userData.neutralGrain = { kind, seed: variation.value };
  material.customProgramCacheKey = () => key + `|neutral-grain-${kind}`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.neutralSeed = variation;
    if (kind === "bark") shader.uniforms.barkStyle = barkStyle;
    shader.vertexShader = "uniform float neutralSeed; varying vec2 neutralUv; varying float neutralVariation;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      neutralUv = uv;
      neutralVariation = neutralSeed;
      #ifdef USE_INSTANCING
        neutralVariation = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898,78.233))+neutralSeed)*43758.5453);
      #endif
    `);
    shader.fragmentShader = (kind === "bark" ? "uniform vec4 barkStyle;\n" : "") + "varying vec2 neutralUv; varying float neutralVariation;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      float neutralPhase = neutralVariation * 6.2831853;
      float neutralGrain = sin(neutralUv.x*63.0+neutralPhase)*sin(neutralUv.y*71.0-neutralPhase);
      float neutralVein = ${kind === "bark"
        ? "sin(neutralUv.y*(37.0+neutralVariation*19.0)+sin(neutralUv.x*15.0+neutralPhase)*.6)"
        : "sin(neutralUv.x*18.0+sin(neutralUv.y*5.0+neutralPhase)*.3)"};
      float neutralTone = neutralVariation < .33 ? .97+.025*neutralGrain
        : neutralVariation < .66 ? .94+.045*neutralVein+.015*neutralGrain
        : .95+.035*neutralGrain+.015*sin(neutralUv.y*19.0+neutralPhase);
      diffuseColor.rgb *= neutralTone;
    `);
    if (kind === "bark") shader.fragmentShader = shader.fragmentShader.replace("diffuseColor.rgb *= neutralTone;", `
      vec2 barkUv = neutralUv * barkStyle.y;
      float barkFurrow = sin(barkUv.y*58.0 + sin(barkUv.x*13.0+neutralPhase)*.9 + neutralPhase);
      float barkPores = sin(barkUv.x*171.0+neutralPhase)*sin(barkUv.y*137.0-neutralPhase);
      float barkPatch = sin(barkUv.x*23.0+sin(barkUv.y*17.0+neutralPhase)*1.7)
        * sin(barkUv.y*31.0+sin(barkUv.x*11.0)*1.2);
      float barkPattern = barkStyle.x < .5 ? .25*barkPores + .18*barkPatch
        : barkStyle.x < 1.5 ? .85*barkFurrow + .15*barkPores
        : .75*barkPatch + .25*barkPores;
      diffuseColor.rgb *= 1.0 + barkStyle.z*barkPattern;
    `);
    if (kind === "bark") shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      float barkRelief = barkPattern*barkStyle.w;
      vec3 barkDx = dFdx(-vViewPosition), barkDy = dFdy(-vViewPosition);
      vec3 barkR1 = cross(barkDy, normal), barkR2 = cross(normal, barkDx);
      float barkDet = dot(barkDx, barkR1);
      vec3 barkGradient = sign(barkDet)*(dFdx(barkRelief)*barkR1 + dFdy(barkRelief)*barkR2);
      normal = normalize(max(abs(barkDet), 1.e-8)*normal - barkGradient);
    `);
    if (kind === "bark") shader.fragmentShader = shader.fragmentShader.replace("#include <dithering_fragment>", `#include <dithering_fragment>
      #ifndef USE_MAP
        gl_FragColor.rgb = vec3(dot(gl_FragColor.rgb, vec3(.2126,.7152,.0722)));
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor - .08*neutralVariation + .025*neutralGrain, .78, 1.);
    `);
  };
}
