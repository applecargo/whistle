import * as THREE from "three";
import { sectorBounds, trailLifetime, type Sector, type TrailSegment } from "../../lib/exhibition";

export function createSectorSurface(size: number, sector: Sector) {
  const { x, z, span } = sectorBounds(size, sector);
  const bounds = new THREE.Vector4(x, z, x + span, z + span);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  let lastPaint = -Infinity;
  let wasEmpty = true;
  return {
    center: new THREE.Vector3(x + span / 2, 2, z + span / 2),
    span,
    // Called after softenEdges, which supplies world coordinates for instanced meshes as well.
    apply(root: THREE.Object3D) {
      root.traverse(object => {
        const material = (object as THREE.Mesh).material;
        if (!material) return;
        for (const mat of Array.isArray(material) ? material : [material]) {
          if (mat.userData.sectorSurface) continue;
          mat.userData.sectorSurface = true;
          const ground = object.name === "continuous-ground";
          const compile = mat.onBeforeCompile;
          const key = mat.customProgramCacheKey();
          mat.customProgramCacheKey = () => key + "|sector-" + ground;
          mat.onBeforeCompile = (shader, renderer) => {
            compile.call(mat, shader, renderer);
            shader.uniforms.sectorBounds = { value: bounds };
            shader.fragmentShader = "uniform vec4 sectorBounds;\n" + shader.fragmentShader.replace(
              /void\s+main\s*\(\s*\)\s*\{/, `$&
              if (any(lessThan(whistleWorldPosition.xz, sectorBounds.xy)) ||
                  any(greaterThan(whistleWorldPosition.xz, sectorBounds.zw))) discard;`);
            if (ground) {
              shader.uniforms.sectorTrail = { value: texture };
              shader.fragmentShader = "uniform sampler2D sectorTrail;\n" + shader.fragmentShader.replace("#include <dithering_fragment>", `#include <dithering_fragment>
                float band = (whistleWorldPosition.y + .09) / .21;
                float aa = max(fwidth(band), .0001);
                float contour = (1. - smoothstep(.46*aa, 1.38*aa, abs(fract(band+.5)-.5))) * smoothstep(.0001,.001,aa);
                gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(.18,.22,.21), .57*contour);
                vec2 uvTrail = (whistleWorldPosition.xz-sectorBounds.xy)/(sectorBounds.zw-sectorBounds.xy);
                gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(.88,.20,.07), texture2D(sectorTrail,uvTrail).a);`);
            }
          };
          mat.needsUpdate = true;
        }
      });
    },
    paint(trail: TrailSegment[], now: number) {
      const empty = !trail.length || trail[trail.length - 1].time <= now - trailLifetime;
      if ((empty && wasEmpty) || now - lastPaint < 80) return;
      lastPaint = now;
      wasEmpty = empty;
      const scale = canvas.width / span;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      for (const s of trail) {
        const fade = Math.min(1, (trailLifetime - (now - s.time)) / 27000);
        if (fade <= 0) continue;
        ctx.strokeStyle = `rgba(255,255,255,${fade * .94})`;
        ctx.lineWidth = scale * (.085 + fade * .085);
        ctx.beginPath();
        ctx.moveTo((s.x * 2 - size + 1 - x) * scale, (s.z * 2 - size + 1 - z) * scale);
        ctx.lineTo((s.endX * 2 - size + 1 - x) * scale, (s.endZ * 2 - size + 1 - z) * scale);
        ctx.stroke();
      }
      texture.needsUpdate = true;
    },
    dispose() { texture.dispose(); },
  };
}
