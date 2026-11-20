export const MAX_PHOTO_BYTES = 64 * 1024;

export function optimizedImage(canvas: HTMLCanvasElement, maxBytes = MAX_PHOTO_BYTES): string {
  let source = canvas;
  const bytes = (url: string) => Math.ceil((url.length - url.indexOf(",") - 1) * 3 / 4);
  for (;;) {
    let best = source.toDataURL("image/png");
    for (const quality of [0.85, 0.7, 0.5]) {
      const candidate = source.toDataURL("image/webp", quality);
      if (candidate.length < best.length) best = candidate;
      if (bytes(best) <= maxBytes) return best;
    }
    if (bytes(best) <= maxBytes) return best;
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.floor(source.width * 0.75));
    smaller.height = Math.max(1, Math.floor(source.height * 0.75));
    const ctx = smaller.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, smaller.width, smaller.height);
    source = smaller;
  }
}
