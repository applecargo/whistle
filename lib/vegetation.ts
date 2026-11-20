import { randomSequence } from "./terrain.ts";

export const TREE_SPECIES = ["pine", "zelkova", "ginkgo", "maple"] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];
const BARK_COLORS = ["#333333", "#626262", "#969696", "#c4c4c4", "#e4e4e4", "#fafafa"];
function hash(seed: number, x: number, z: number) {
  let h = seed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
export function treeAppearance(seed: number, x: number, z: number) {
  const variantSeed = hash(seed ^ 0x71ee, x, z);
  const random = randomSequence(variantSeed);
  const baseSpecies = TREE_SPECIES[Math.floor(random() * TREE_SPECIES.length)];
  const stature = random();
  const girth = random();
  const age = hash(seed ^ 0x36a5, x, z) % 7;
  const growth = age < 2 ? "shrub" : age < 4 ? "sapling" : "mature";
  const species = growth === "shrub" ? (age === 0 ? "maple" : "zelkova") : baseSpecies;
  const foliageRandom=randomSequence(hash(seed ^ 0x5f19,x,z));
  const foliageRoll=foliageRandom();
  const foliage=growth === "shrub" || foliageRoll < .12 ? "bare" : foliageRoll < .38 ? "sparse" : "leafy";
  const leafSize=.42+foliageRandom()*.23;
  const leafDensity=foliage === "bare" ? 0 : foliage === "sparse" ? .12+foliageRandom()*.18 : .45+foliageRandom()*.35;
  return {
    seed: variantSeed,
    species,
    growth,
    foliage,
    leafSize,
    leafDensity,
    scale: 0.72,
    height: growth === "shrub" ? .85 + stature * .9 : growth === "sapling" ? 1.8 + stature * 1.5 : 3.8 + stature * 2.8,
    trunkRadius: (0.07 + Math.pow(girth, 1.35) * 0.35) * (growth === "shrub" ? .4 : growth === "sapling" ? .6 : 1),
    width: (1.0 + stature * 0.65 + girth * 0.45 + random() * 0.45) * (growth === "shrub" ? .65 : growth === "sapling" ? .62 : 1),
    lean: (random() - 0.5) * (species === "pine" ? 1.4 : 0.5),
    rotation: random() * Math.PI * 2,
    tint: random(),
    bark: {
      color: BARK_COLORS[Math.floor(random() * BARK_COLORS.length)],
      texture: Math.floor(random() * 3),
      grain: .75 + random() * 1.5,
      contrast: .08 + random() * .16,
      relief: .001 + random() * .004,
      roughness: .82 + random() * .17,
    },
  };
}

const GRASS_COLORS = [
  [100, 145, 38],
  [158, 167, 61],
  [43, 105, 61],
  [103, 145, 88],
  [151, 139, 68],
  [54, 126, 89],
];

export function grassAppearance(seed: number, x: number, z: number) {
  const gx = x / 2.8,
    gz = z / 2.8,
    ix = Math.floor(gx),
    iz = Math.floor(gz);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const tx = smooth(gx - ix),
    tz = smooth(gz - iz);
  const rgb = [0, 0, 0];
  for (const [dx, dz, weight] of [
    [0, 0, (1 - tx) * (1 - tz)],
    [1, 0, tx * (1 - tz)],
    [0, 1, (1 - tx) * tz],
    [1, 1, tx * tz],
  ]) {
    const c = GRASS_COLORS[hash(seed, ix + dx, iz + dz) % GRASS_COLORS.length];
    c.forEach((v, i) => (rgb[i] += (v / 255) * weight));
  }
  const grain = hash(seed, Math.floor(x * 23), Math.floor(z * 23)) / 0xffffffff;
  const shade = 0.78 + grain * 0.4;
  return {
    r: rgb[0] * shade,
    g: rgb[1] * shade,
    b: rgb[2] * shade,
    height: 0.65 + grain * 0.8,
  };
}
