import type { Environment } from "../environment.ts";

export function soundRangeAt(environment: Environment | undefined, x: number, z: number) {
  const cell = environment?.cells[Math.round(z) * environment.size + Math.round(x)];
  if (!cell) return 4;
  if (cell.tree || cell.light < 0.5) return 2;
  if (cell.water !== null) return 6;
  if (cell.grass > 0.1) return 3;
  return 4;
}
