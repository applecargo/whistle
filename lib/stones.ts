import { randomSequence } from "./terrain.ts";

const COLORS = ["#8a8a8a", "#aeaeae", "#6b6b6b", "#7f7f7f", "#9c9c9c", "#5a5a5a"];

export function stoneAppearance(seed: number, x: number, z: number) {
  const random = randomSequence(seed ^ Math.imul(Math.floor(x * 997), 73856093) ^ Math.imul(Math.floor(z * 997), 19349663));
  const sizeRoll = random();
  const size = sizeRoll < 0.65
    ? 0.055 + random() * 0.13
    : sizeRoll < 0.93
      ? 0.2 + random() * 0.17
      : 0.4 + random() * 0.22;
  return {
    size,
    color: COLORS[Math.floor(random() * COLORS.length)],
    height: 0.55 + random() * 0.7,
    depth: 0.65 + random() * 0.65,
    angle: random() * Math.PI * 2,
    texture: Math.floor(random() * 3),
    grain: 0.7 + random() * 1.8,
    offset: random() * 100,
    shape: random() < .75 ? 0 : 1,
  };
}
