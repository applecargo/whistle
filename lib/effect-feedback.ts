import type { effectRegions } from "./effect-regions.ts";

type Region = ReturnType<typeof effectRegions>[number];
export type EffectMarker = Region & { id: number; phase: "idle" | "enter" | "leave"; until: number };
export type EffectPresentation = { markers: EffectMarker[]; nextId: number };

export function initialEffectPresentation(regions: Region[]): EffectPresentation {
  return { markers: regions.map((region, id) => ({ ...region, id, phase: "idle", until: 0 })), nextId: regions.length };
}

export function updateEffectPresentation(previous: EffectPresentation, regions: Region[], now: number): EffectPresentation {
  const candidates: { old: number; next: number; overlap: number }[] = [];
  regions.forEach((region, next) => {
    const cells = new Set(region.cells);
    previous.markers.forEach((marker, old) => {
      if (marker.kind !== region.kind) return;
      const overlap = marker.cells.filter(cell => cells.has(cell)).length;
      if (overlap) candidates.push({ old, next, overlap });
    });
  });
  candidates.sort((a, b) => b.overlap - a.overlap || a.old - b.old || a.next - b.next);
  const matched = new Map<number, number>(), used = new Set<number>();
  for (const pair of candidates) {
    if (matched.has(pair.next) || used.has(pair.old)) continue;
    matched.set(pair.next, pair.old); used.add(pair.old);
  }
  let nextId = previous.nextId;
  const markers: EffectMarker[] = regions.map((region, index) => {
    const old = matched.get(index);
    if (old === undefined) return { ...region, id: nextId++, phase: "enter", until: now + 360 };
    const marker = previous.markers[old];
    return { ...marker, ...region, ...(marker.phase === "leave" ? { phase: "enter" as const, until: now + 360 } : {}) };
  });
  previous.markers.forEach((marker, index) => {
    if (!used.has(index)) markers.push(marker.phase === "leave" ? marker : { ...marker, phase: "leave", until: now + 230 });
  });
  return { markers, nextId };
}

export function finishEffectAnimation(state: EffectPresentation, id: number): EffectPresentation {
  return { ...state, markers: state.markers.flatMap(marker => marker.id !== id ? [marker]
    : marker.phase === "leave" ? [] : [{ ...marker, phase: "idle" as const, until: 0 }]) };
}
