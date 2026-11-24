export function renderQuality(
  search = typeof location === "undefined" ? "" : location.search,
  deviceRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
) {
  const high = new URLSearchParams(search).get("quality") === "high";
  return {
    name: high ? "high" : "low",
    pixelRatio: Math.min(deviceRatio, high ? 2 : 1),
    samples: high ? 4 : 0,
  } as const;
}
