import type { World } from "./world.ts";

const neonColors = Array.from({ length: 1530 }, (_, index) => {
  const sector = Math.floor(index / 255), value = index % 255;
  const rgb = [[255, value, 0], [255 - value, 255, 0], [0, 255, value],
    [0, 255 - value, 255], [value, 0, 255], [255, 0, 255 - value]][sector];
  return { hue: index * 360 / 1530, color: "#" + rgb.map(channel => channel.toString(16).padStart(2, "0")).join("") };
}).filter(({ hue }) => (hue >= 20 && hue <= 195) || (hue >= 270 && hue <= 340)).map(({ color }) => color);

export function randomSymbolColor(used: Iterable<string>, random = Math.random) {
  const occupied = new Set([...used].map(color => color.toLowerCase()));
  const available = neonColors.filter(color => !occupied.has(color));
  if (!available.length) throw new Error("기호에 배정할 색상이 부족합니다.");
  const channels = (color: string) => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  const existing = [...occupied].map(channels);
  const distinct = available.filter(color => {
    const rgb = channels(color);
    return existing.every(other => Math.max(...rgb.map((channel, i) => Math.abs(channel - other[i]))) >= 32);
  });
  const choices = distinct.length ? distinct : available;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

export function withSymbolColors(world: World): World {
  const reserved = new Set(world.assets.flatMap(asset => asset.glyphColor ? [asset.glyphColor.toLowerCase()] : []));
  const seen = new Set<string>();
  let changed = false;
  const assets = world.assets.map(asset => {
    if (!asset.image && !asset.text?.trim() && !asset.sound) return asset;
    const color = asset.glyphColor?.toLowerCase();
    if (color && !seen.has(color)) { seen.add(color); return asset; }
    const glyphColor = randomSymbolColor(reserved);
    reserved.add(glyphColor); seen.add(glyphColor); changed = true;
    return { ...asset, glyphColor };
  });
  return changed ? { ...world, assets } : world;
}
