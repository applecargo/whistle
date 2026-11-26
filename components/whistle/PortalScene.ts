import * as THREE from "three";
import { insidePortal, type WorldPortal } from "../../lib/portals.ts";
import type { Player } from "../../lib/world.ts";

function dispose(group: THREE.Object3D) {
  group.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : [];
    for (const material of materials) { (material as THREE.MeshBasicMaterial).map?.dispose(); material.dispose(); }
  });
}

export function createPortalScene(size: number) {
  const group = new THREE.Group();
  group.name = "world-portals";
  const models = new Map<string, { model: THREE.Group; portal: WorldPortal; armed: boolean }>();
  let lastPortals: WorldPortal[] | undefined;
  const sync = (portals: WorldPortal[], player: Player) => {
    if (lastPortals === portals) return;
    lastPortals = portals;
    const ids = new Set(portals.map(p => p.id));
    for (const [id, entry] of models) if (!ids.has(id)) { group.remove(entry.model); dispose(entry.model); models.delete(id); }
    for (const portal of portals) {
      let entry = models.get(portal.id);
      if (!entry) {
        const model = new THREE.Group();
        model.name = `portal-${portal.id}`;
        const outline = new THREE.Mesh(new THREE.TorusGeometry(.82, .08, 6, 48), new THREE.MeshBasicMaterial({ color: "#101d17", fog: false }));
        outline.position.set(0, 1.22, -.04); outline.scale.y = 1.45; model.add(outline);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(.82, .045, 6, 48), new THREE.MeshBasicMaterial({ color: "#e3eee7", fog: false }));
        rim.position.y = 1.22; rim.scale.y = 1.45; model.add(rim);
        const face = new THREE.Mesh(new THREE.CircleGeometry(.77, 48), new THREE.MeshBasicMaterial({ color: "#98c4b4", transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        face.position.y = 1.22; face.scale.y = 1.45; model.add(face);
        entry = { model, portal, armed: Math.hypot(player.x - portal.x, player.z - portal.z) > .9 };
        models.set(portal.id, entry); group.add(model);
      }
      if (entry.portal.x !== portal.x || entry.portal.z !== portal.z) entry.armed = Math.hypot(player.x - portal.x, player.z - portal.z) > .9;
      entry.portal = portal;
      entry.model.position.set(portal.x * 2 - size + 1, portal.y + .03, portal.z * 2 - size + 1);
      entry.model.rotation.y = portal.yaw;
    }
  };
  const enter = (player: Player, feet: number) => {
    for (const entry of models.values()) {
      if (Math.hypot(player.x - entry.portal.x, player.z - entry.portal.z) > .9) entry.armed = true;
      if (entry.armed && insidePortal(entry.portal, player, feet)) { entry.armed = false; return entry.portal.id; }
    }
    return null;
  };
  return { group, sync, enter };
}
