import type { World, Player } from "./world.ts";
import { floorHeight } from "./terrain.ts";
import type { WorldDerivation } from "./world-derivation.ts";
import { blocksWalkingStep } from "./navigation.ts";
import type { PortalPeer } from "./portal-protocol.ts";

export const HOME_PORTAL = "return-home";
export type WorldPortal = { id: string; label: string; x: number; z: number; y: number; yaw: number };

export function placePortals(world: World, peers: Pick<PortalPeer, "id" | "label">[], derivation: WorldDerivation): WorldPortal[] {
  if (!peers.length) return [];
  const { structures, environment } = derivation;
  const solid = new Set(world.objects.filter(o => world.assets.find(a => a.id === o.asset)?.solid).map(o => o.z * world.size + o.x));
  for (const tree of environment.trees) solid.add(Math.round(tree.z) * world.size + Math.round(tree.x));
  const start = world.start.z * world.size + world.start.x;
  const visited = new Set([start]), reachable = [start];
  for (let i = 0; i < reachable.length; i++) {
    const x = reachable[i] % world.size, z = Math.floor(reachable[i] / world.size);
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, nz = z + dz, index = nz * world.size + nx;
      if (nx < 0 || nz < 0 || nx >= world.size || nz >= world.size || visited.has(index) || solid.has(index)) continue;
      if (floorHeight(world, nx, nz, structures) === null || blocksWalkingStep(world, { x, z }, { x: nx, z: nz }, structures)) continue;
      visited.add(index); reachable.push(index);
    }
  }
  const candidates = reachable.map(i => ({ x: i % world.size, z: Math.floor(i / world.size), i }))
    .filter(p => Math.hypot(p.x - world.start.x, p.z - world.start.z) >= 1.5 && !solid.has(p.i))
    .sort((a, b) => {
      const edge = (p: { x: number; z: number }) => Math.min(p.x, p.z, world.size - 1 - p.x, world.size - 1 - p.z);
      return edge(a) - edge(b) || a.i - b.i;
    });
  const chosen: WorldPortal[] = [];
  for (const peer of peers) {
    const p = candidates.find(p => chosen.every(q => Math.hypot(q.x - p.x, q.z - p.z) >= 1.5));
    if (!p) break;
    chosen.push({ id: peer.id, label: peer.label, x: p.x, z: p.z,
      y: Math.max(floorHeight(world, p.x, p.z, structures) ?? 0, environment.cells[p.i].water ?? -Infinity),
      yaw: Math.atan2(world.start.x - p.x, world.start.z - p.z),
    });
  }
  return chosen;
}

export function insidePortal(portal: WorldPortal, player: Player, feet: number) {
  return !player.falling && Math.abs(feet - portal.y) < .8 && Math.hypot(player.x - portal.x, player.z - portal.z) < .42;
}

export function portalReturnPosition(world: World, player: Player, portal: WorldPortal | undefined, derivation: WorldDerivation, portals: WorldPortal[] = []): Player {
  if (!portal) return { ...player, falling: false };
  const obstacles = world.objects.filter(object => world.assets.find(asset => asset.id === object.asset)?.solid);
  const clear = (x: number, z: number) => x >= 0 && z >= 0 && x <= world.size - 1 && z <= world.size - 1
    && floorHeight(world, x, z, derivation.structures) !== null
    && !derivation.environment.trees.some(tree => Math.hypot(tree.x - x, tree.z - z) < .3)
    && !obstacles.some(object => Math.hypot(object.x - x, object.z - z) < .43 * object.scale + .13);
  const away = (x: number, z: number) => [portal, ...portals].every(p => Math.hypot(p.x - x, p.z - z) >= 1);
  for (const distance of [1.25, 1.75]) for (const turn of [0, -.25, .25, -.5, .5, -.75, .75, 1]) {
    const angle = player.yaw + turn * Math.PI;
    const target = { x: portal.x - Math.sin(angle) * distance, z: portal.z + Math.cos(angle) * distance };
    if (!away(target.x, target.z)) continue;
    const steps = Math.ceil(Math.hypot(target.x - player.x, target.z - player.z) / .12);
    let from = { x: player.x, z: player.z }, safe = true;
    for (let i = 1; i <= steps; i++) {
      const to = { x: player.x + (target.x - player.x) * i / steps, z: player.z + (target.z - player.z) * i / steps };
      if (!clear(to.x, to.z) || blocksWalkingStep(world, from, to, derivation.structures)) { safe = false; break; }
      from = to;
    }
    if (safe) return { ...player, ...target, falling: false };
  }
  if (clear(world.start.x, world.start.z) && away(world.start.x, world.start.z)) return { ...player, ...world.start, falling: false };
  return { ...player, falling: false };
}
