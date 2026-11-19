import type { Environment } from "./environment.ts";

import { EFFECT_RULES, effectStrength } from "./effect-limits.ts";

export function effectRegions(environment: Environment) {
  const { size, cells } = environment;
  const regions: { kind: string; label: string; cells: number[]; anchor: number }[] = [];
  const occupied = new Map<number, number>();
  for (const effect of EFFECT_RULES) {
    const remaining = new Set(cells.flatMap((cell, i) => effectStrength(cell, effect.fields) > effect.threshold ? [i] : []));
    while (remaining.size) {
      const first = remaining.values().next().value!;
      const connected = [first]; remaining.delete(first);
      for (let n = 0; n < connected.length; n++) {
        const x = connected[n] % size, z = Math.floor(connected[n] / size);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz, index = nz * size + nx;
          if (nx >= 0 && nx < size && nz >= 0 && nz < size && remaining.delete(index)) connected.push(index);
        }
      }
      const x = connected.reduce((sum, i) => sum + i % size, 0) / connected.length;
      const z = connected.reduce((sum, i) => sum + Math.floor(i / size), 0) / connected.length;
      const distance = (i: number) => (i % size - x) ** 2 + (Math.floor(i / size) - z) ** 2;
      const anchor = [...connected].sort((a, b) => (occupied.get(a) ?? 0) - (occupied.get(b) ?? 0) || distance(a) - distance(b) || a - b)[0];
      occupied.set(anchor, (occupied.get(anchor) ?? 0) + 1);
      regions.push({ kind: effect.kind, label: effect.label, cells: connected.sort((a, b) => a - b), anchor });
    }
  }
  return regions;
}
