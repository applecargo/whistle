import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { effectRegions } from "@/lib/effect-regions";
import { initialEffectPresentation, updateEffectPresentation, finishEffectAnimation } from "@/lib/effect-feedback";

export function useEffectFeedback(regions: ReturnType<typeof effectRegions>, size: number, feedbackId: number | null) {
  const input = useRef({ regions, size, feedbackId });
  const [presentation, setPresentation] = useState(() => initialEffectPresentation(regions));
  useLayoutEffect(() => {
    const previousInput = input.current;
    input.current = { regions, size, feedbackId };
    if (previousInput.regions === regions && previousInput.size === size) return;
    const animate = previousInput.size === size && feedbackId !== null && feedbackId !== previousInput.feedbackId;
    setPresentation(previous => !animate ? initialEffectPresentation(regions)
      : updateEffectPresentation(previous, regions, performance.now()));
  }, [regions, size, feedbackId]);
  useEffect(() => {
    const pending = presentation.markers.filter(marker => marker.phase !== "idle");
    if (!pending.length) return;
    const until = Math.min(...pending.map(marker => marker.until));
    const timer = setTimeout(() => setPresentation(previous => {
      const now = performance.now();
      return previous.markers.filter(marker => marker.phase !== "idle" && marker.until <= now)
        .reduce((state, marker) => finishEffectAnimation(state, marker.id), previous);
    }), Math.max(1, Math.ceil(until - performance.now())));
    return () => clearTimeout(timer);
  }, [presentation]);
  const finish = useCallback((id: number) => setPresentation(previous => finishEffectAnimation(previous, id)), []);
  return { markers: presentation.markers, finish };
}
