import { useCallback, useEffect, useMemo, useRef } from "react";

export function usePortalTransition() {
  const veil = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const waiting = useRef<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const fade = useCallback(async (opacity: number, duration: number) => {
    const element = veil.current;
    if (!element) return;
    animation.current?.cancel();
    element.dataset.phase = opacity ? "out" : "in";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const effect = element.animate([{ opacity: getComputedStyle(element).opacity }, { opacity }], {
      duration: reduced ? 0 : duration, easing: "ease-in-out", fill: "forwards",
    });
    animation.current = effect;
    try { await effect.finished; }
    catch { return; }
    element.style.opacity = String(opacity);
    effect.cancel();
    animation.current = null;
    element.dataset.phase = opacity ? "waiting" : "idle";
  }, []);
  const ready = useCallback((success = true) => {
    const pending = waiting.current;
    if (!pending) return;
    waiting.current = null;
    clearTimeout(pending.timer);
    if (success) pending.resolve();
    else pending.reject(new Error("3D 화면을 시작할 수 없습니다."));
  }, []);
  useEffect(() => () => {
    animation.current?.cancel();
    ready(false);
  }, [ready]);
  return useMemo(() => ({
    veil, ready,
    cover: () => fade(1, 200),
    reveal: () => fade(0, 300),
    expectScene: () => new Promise<void>((resolve, reject) => {
      ready(false);
      waiting.current = { resolve, reject, timer: setTimeout(() => ready(false), 12_000) };
    }),
  }), [fade, ready]);
}
