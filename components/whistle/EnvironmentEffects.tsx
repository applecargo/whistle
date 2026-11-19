import { useId } from "react";
import type { EffectMarker } from "@/lib/effect-feedback";
import { EffectGlyph } from "./EffectGlyph";
import { EffectPattern } from "./EffectPattern";

export function EnvironmentEffects({ regions, size, onAnimationEnd }: { regions: EffectMarker[]; size: number; onAnimationEnd: (id: number) => void }) {
  const patternId = useId();
  const coverage = new Map<number, Set<string>>();
  const markers = new Map<number, typeof regions>();
  for (const region of regions) {
    if (region.phase !== "leave") {
      for (const index of region.cells) {
        const kinds = coverage.get(index) ?? new Set<string>();
        kinds.add(region.kind); coverage.set(index, kinds);
      }
    }
    const at = markers.get(region.anchor) ?? [];
    at.push(region); markers.set(region.anchor, at);
  }
  const patterns = new Map([...coverage.values()].map(kinds => {
    const sorted = [...kinds].sort();
    return [sorted.join("-"), sorted] as const;
  }));
  return <div className="environment-effects" aria-hidden="true">
    <svg className="effect-region-patterns" viewBox={`0 0 ${size} ${size}`} fill="none">
      <defs>
        {[...patterns].map(([key, kinds]) => <EffectPattern key={key} id={`${patternId}-${key}`} kinds={kinds} />)}
      </defs>
      {[...coverage].map(([index, kinds]) => <rect key={index} data-effect-pattern={[...kinds].sort().join(" ")}
        x={index % size} y={Math.floor(index / size)} width="1" height="1"
        fill={`url(#${patternId}-${[...kinds].sort().join("-")})`} />)}
    </svg>
    {[...markers].map(([index, effects]) => <span key={index} className="effect-region-icons" data-effect-cell={index}
      style={{ left: `${(index % size) * 100 / size}%`, top: `${Math.floor(index / size) * 100 / size}%`, width: `${100 / size}%`, height: `${100 / size}%`, gridTemplateColumns: `repeat(${effects.length > 1 ? 2 : 1}, minmax(0, 1fr))` }}>
      {effects.map(region => <span key={region.id} className="environment-effect" data-effect={region.kind}
        data-effect-phase={region.phase} data-region-cells={region.cells.join(",")}
        onAnimationEnd={event => { if (event.target === event.currentTarget) onAnimationEnd(region.id); }}>
        <EffectGlyph kind={region.kind} /></span>)}
    </span>)}
  </div>;
}
