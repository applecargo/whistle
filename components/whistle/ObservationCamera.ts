import * as THREE from "three";
import { chooseSubject, observationSubjects } from "../../lib/observation";
import { terrainSample } from "../../lib/terrain";
import { mapRoomPosition, type RoomMapping } from "../../lib/uwb-position";
import type { DisplayMount } from "../../lib/display-proximity";
import type { WorldDerivation } from "../../lib/world-derivation";
import type { Actor, World } from "../../lib/world";

export function createObservationCamera() {
  let previous: string | undefined;
  let previousWorld: World | undefined, previousActors: Actor[] | undefined, previousMapping: RoomMapping | undefined;
  const focus = new THREE.Vector3(), offset = new THREE.Spherical(), orbit = new THREE.Spherical();
  const goal = new THREE.Vector3(), arm = new THREE.Vector3();
  let first = true, radius = 0, bearing = 0, elevation = 0;
  return {
    update(camera: THREE.PerspectiveCamera, world: World, derivation: WorldDerivation, actors: Actor[],
      mount: DisplayMount, mapping: RoomMapping, yaw: number, tilt: number, elapsed: number) {
      if (previousWorld !== world || previousActors !== actors || previousMapping !== mapping) {
        previousWorld = world; previousActors = actors; previousMapping = mapping;
        const anchor = mapRoomPosition(mount, mapping, world.size, true)!;
        const subject = chooseSubject(observationSubjects(world, derivation.environment, actors), anchor, previous);
        previous = subject?.id;
        const s = subject ?? { ...anchor, height: .3, y: terrainSample(world, anchor.x, anchor.z).height };
        const toScene = (n: number) => n * 2 - world.size + 1;
        goal.set(toScene(s.x), s.y, toScene(s.z));
        const dx = (anchor.x - s.x) * 2, dz = (anchor.z - s.z) * 2;
        const distance = Math.hypot(dx, dz);
        const azimuth = distance > .35 ? Math.atan2(dx, dz) : Math.PI + (mount.facing - mapping.rotation) * Math.PI / 180;
        const reach = Math.max(2.7, s.height * 1.8, distance);
        const sx = Math.sin(azimuth), sz = Math.cos(azimuth);
        let rise = reach * .48 + .65;
        // Keep the sight line above intervening terrain, including raised banks.
        for (let step = 1; step <= 12; step++) {
          const t = step / 12;
          const gx = s.x + sx * reach * t / 2, gz = s.z + sz * reach * t / 2;
          const ground = terrainSample(world, gx, gz).height;
          rise = Math.max(rise, (ground + .45 * t - s.y) / t);
        }
        arm.set(sx * reach, rise, sz * reach);
        offset.setFromVector3(arm);
      }
      const blend = first ? 1 : 1 - Math.exp(-Math.min(elapsed, .2) / .48);
      focus.lerp(goal, blend);
      radius += (offset.radius - radius) * blend;
      elevation += (offset.phi - elevation) * blend;
      const delta = offset.theta - bearing;
      bearing += Math.atan2(Math.sin(delta), Math.cos(delta)) * blend;
      orbit.set(radius, elevation - tilt, bearing + yaw);
      camera.position.setFromSpherical(orbit.makeSafe()).add(focus);
      camera.lookAt(focus);
      first = false;
      return previous ?? "ground";
    },
  };
}
