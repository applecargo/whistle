import * as THREE from "three";

export function projectSurfaceImage(material: THREE.Material, center: THREE.Vector3, size: number, rotation: number, tree = false) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  const projection = { opacity: { value: 1 }, baseColor: tree ? new THREE.Color("#676767") : undefined, center: { value: center }, size: { value: size }, angle: { value: rotation * Math.PI / 180 } };
  material.userData.surfaceProjection = projection;
  material.customProgramCacheKey = () => key + `|surface-projection-${tree}`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.skinOpacity = projection.opacity;
    shader.uniforms.skinCenter = projection.center;
    shader.uniforms.skinSize = projection.size;
    shader.uniforms.skinAngle = projection.angle;
    shader.vertexShader = "varying vec3 skinPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>
      vec4 skinPoint = vec4(position, 1.);
      #ifdef USE_INSTANCING
        skinPoint = instanceMatrix * skinPoint;
      #endif
      skinPosition = ${tree ? "skinPoint.xyz" : "(modelMatrix * skinPoint).xyz"};
    `);
    shader.fragmentShader = "varying vec3 skinPosition; uniform vec3 skinCenter; uniform float skinSize, skinAngle, skinOpacity;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        vec3 skinOffset = skinPosition - skinCenter;
        ${tree ? "vec2 skinUv = vec2(atan(skinOffset.x,skinOffset.z)/6.2831853+.5+skinAngle/6.2831853, skinOffset.y/skinSize);" : `
          float cs=cos(skinAngle), sn=sin(skinAngle);
          vec2 skinUv = vec2(cs*skinOffset.x+sn*skinOffset.z, sn*skinOffset.x-cs*skinOffset.z)/skinSize+.5;
        `}
        vec4 skinColor = texture2D(map, skinUv);
        ${tree ? "" : "skinColor.a *= step(0.,skinUv.x)*step(skinUv.x,1.)*step(0.,skinUv.y)*step(skinUv.y,1.);"}
        diffuseColor.rgb *= mix(vec3(1.),skinColor.rgb,skinColor.a * skinOpacity);
      #endif
    `);
  };
}
