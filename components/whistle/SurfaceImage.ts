import * as THREE from "three";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
import type { Asset, Placed, World } from "../../lib/world.ts";

export function surfaceImageGeometry(ground: THREE.Mesh, world: World, placed: Placed) {
  ground.updateMatrixWorld(true);
  const center = new THREE.Vector3(placed.x * 2 - world.size + 1, 0, placed.z * 2 - world.size + 1);
  const radius = 1.5 * placed.scale / Math.SQRT2;
  const bounds = new THREE.Box3(
    new THREE.Vector3(center.x - radius, -40, center.z - radius),
    new THREE.Vector3(center.x + radius, 40, center.z + radius),
  ).applyMatrix4(ground.matrixWorld.clone().invert());
  const source = ground.geometry, position = source.getAttribute("position"), index = source.index;
  const indices: number[] = [];
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    if (Math.max(position.getX(a), position.getX(b), position.getX(c)) < bounds.min.x ||
        Math.min(position.getX(a), position.getX(b), position.getX(c)) > bounds.max.x ||
        Math.max(position.getZ(a), position.getZ(b), position.getZ(c)) < bounds.min.z ||
        Math.min(position.getZ(a), position.getZ(b), position.getZ(c)) > bounds.max.z) continue;
    indices.push(a, b, c);
  }
  const patch = new THREE.BufferGeometry();
  patch.setAttribute("position", position);
  patch.setAttribute("normal", source.getAttribute("normal"));
  patch.setIndex(indices);
  const target = new THREE.Mesh(patch);
  target.matrixWorld.copy(ground.matrixWorld);
  const result = new DecalGeometry(target, center,
    new THREE.Euler(-Math.PI / 2, 0, -placed.rotation * Math.PI / 180),
    new THREE.Vector3(1.5 * placed.scale, 1.5 * placed.scale, 80));
  patch.dispose();
  (target.material as THREE.Material).dispose();
  return result;
}

export function makeSurfaceImage(asset: Asset, placed: Placed, world: World, terrain: THREE.Group, onGrass = false) {
  const group = new THREE.Group();
  group.userData.surface = true;
  if (onGrass) return group;
  const ground = terrain.getObjectByName("continuous-ground") as THREE.Mesh | undefined;
  if (!ground || !asset.image) return group;
  const texture = new THREE.TextureLoader().load(asset.image);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, alphaTest: .05, roughness: 1,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
  });
  const picture = new THREE.Mesh(surfaceImageGeometry(ground, world, placed), material);
  picture.name = "surface-image";
  picture.renderOrder = 1;
  picture.receiveShadow = true;
  group.add(picture);
  return group;
}
