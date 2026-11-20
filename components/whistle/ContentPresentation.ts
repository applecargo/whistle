import * as THREE from "three";
import type { Actor, Asset } from "../../lib/world.ts";
import { contentOpacity, floatingPose } from "../../lib/content-display.ts";

type Coating = { opacity: { value: number }; baseColor?: THREE.Color };
type Target = { actor: Actor; asset: Asset; model: THREE.Group; materials: THREE.Material[]; coatings: { material: THREE.MeshStandardMaterial; projection: Coating }[] };

export function makeContentPresentation() {
  const targets: Target[] = [];
  const point = new THREE.Vector3(), white = new THREE.Color(1, 1, 1);
  return {
    sync(actors: Actor[], assets: Map<string, Asset>, models: Map<string, THREE.Group>, terrain: THREE.Group) {
      targets.length = 0;
      const byId = new Map<string, Target>();
      for (const actor of actors) {
        const asset = assets.get(actor.id), model = models.get(actor.id);
        if (!asset?.display || !model) continue;
        const target: Target = { actor, asset, model, materials: [], coatings: [] };
        model.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (mesh.material) target.materials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
        });
        targets.push(target);
        byId.set(actor.id, target);
      }
      terrain.traverse(object => {
        const target = byId.get(object.userData.placementId);
        const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        const projection = material?.userData.surfaceProjection as Coating | undefined;
        if (target && material && projection) target.coatings.push({ material, projection });
      });
    },
    update(camera: THREE.Camera, size: number, time: number, overview: boolean, reducedMotion: boolean) {
      for (const { actor, asset, model, materials, coatings } of targets) {
        if (actor.removed) continue;
        const picture = model.getObjectByName("symbol-content");
        if (picture) {
          const floating = asset.placement === "floating";
          const pose = floatingPose(time / 1000, actor.x * 1.7 + actor.z * .9, reducedMotion);
          picture.position.set(floating ? pose.x / actor.scale : 0, .8 + (floating ? pose.y / actor.scale : 0), 0);
          picture.rotation.z = floating ? pose.roll : 0;
          if (floating) model.rotation.y = Math.atan2(camera.position.x - model.position.x, camera.position.z - model.position.z);
          model.updateMatrixWorld(true);
          picture.getWorldPosition(point);
        } else {
          point.set(actor.x * 2 - size + 1, camera.position.y, actor.z * 2 - size + 1);
        }
        const opacity = overview ? 1 : contentOpacity(asset.display, point.distanceTo(camera.position), time / 1000, actor.x * 1.7 + actor.z * .9, reducedMotion);
        for (const material of materials) material.opacity = opacity;
        for (const { material, projection } of coatings) {
          projection.opacity.value = opacity;
          if (projection.baseColor) material.color.copy(projection.baseColor).lerp(white, opacity);
        }
      }
    },
  };
}
