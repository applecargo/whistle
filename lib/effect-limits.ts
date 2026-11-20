import type { EnvironmentCell } from "./environment.ts";

type EffectField = "windX" | "windZ" | "dust" | "fog" | "lift" | "bounce" | "glide" | "flowX" | "flowZ" | "flicker";
export const EFFECT_RULES = [
  { kind: "wind", label: "바람", fields: ["windX", "windZ"], threshold: .1, maxCells: 5 },
  { kind: "dust", label: "먼지", fields: ["dust"], threshold: 0, maxCells: 3 },
  { kind: "fog", label: "안개", fields: ["fog"], threshold: .05, maxCells: 4 },
  { kind: "lift", label: "부유", fields: ["lift"], threshold: .12, maxCells: 1 },
  { kind: "bounce", label: "튕기기", fields: ["bounce"], threshold: .1, maxCells: 1 },
  { kind: "glide", label: "활공", fields: ["glide"], threshold: .5, maxCells: 2 },
  { kind: "flow", label: "물결", fields: ["flowX", "flowZ"], threshold: .01, maxCells: 3 },
  { kind: "flicker", label: "깜박임", fields: ["flicker"], threshold: 0, maxCells: 1 },
] as const satisfies readonly { kind: string; label: string; fields: readonly EffectField[]; threshold: number; maxCells: number }[];

export function effectStrength(cell: EnvironmentCell, fields: readonly EffectField[]) {
  return Math.hypot(...fields.map(field => cell[field]));
}

export function limitEffectAreas(size: number, cells: EnvironmentCell[], kinds?: readonly string[]) {
  const neighbors = (i: number) => [
    ...(i % size > 0 ? [i - 1] : []), ...(i % size < size - 1 ? [i + 1] : []),
    ...(i >= size ? [i - size] : []), ...(i < cells.length - size ? [i + size] : []),
  ];
  for (const rule of EFFECT_RULES) {
    if (kinds && !kinds.includes(rule.kind)) continue;
    const remaining = new Set(cells.flatMap((cell, i) => effectStrength(cell, rule.fields) > rule.threshold ? [i] : []));
    while (remaining.size) {
      const first = remaining.values().next().value!;
      const group = [first]; remaining.delete(first);
      for (let n = 0; n < group.length; n++)
        for (const next of neighbors(group[n])) if (remaining.delete(next)) group.push(next);
      if (group.length <= rule.maxCells) continue;
      const cx = group.reduce((sum, i) => sum + i % size, 0) / group.length;
      const cz = group.reduce((sum, i) => sum + Math.floor(i / size), 0) / group.length;
      const distance = (i: number) => (i % size - cx) ** 2 + (Math.floor(i / size) - cz) ** 2;
      const sorted = [...group].sort((a, b) => effectStrength(cells[b], rule.fields) - effectStrength(cells[a], rule.fields) || distance(a) - distance(b) || a - b);
      const selected = [sorted[0]], available = new Set(group); available.delete(selected[0]);
      for (let n = 0; n < selected.length && selected.length < rule.maxCells; n++) {
        for (const next of neighbors(selected[n]).sort((a, b) => distance(a) - distance(b) || a - b)) {
          if (selected.length >= rule.maxCells) break;
          if (available.delete(next)) selected.push(next);
        }
      }
      for (const i of available) {
        for (const field of rule.fields) cells[i][field] = 0;
        if (rule.kind === "lift") cells[i].liftCeiling = 0;
      }
    }
  }
}
