import { createTerrainWorld } from "@/lib/create-world";
import { decodeWorld, encodeWorld } from "@/lib/sharing";
import { uid, validateWorld, type World } from "@/lib/world";
import { generateTerrain } from "@/lib/terrain";

export type Trail = ([number, number] | null)[];
export type Leaf = {
  id: string;
  title: string;
  score: string;
  world: World;
  sourceId?: string;
  trail?: Trail;
};
const prefix = "whistle.zine.leaf.v1.";
export function newLeaf(first = false): Leaf {
  const world = createTerrainWorld();
  if (first) world.terrain = generateTerrain(world.size, 4831);
  return {
    id: uid(),
    title: first ? "물가의 산책" : "이름 없는 면",
    score: "",
    world,
  };
}
function validTrail(data: unknown, size: number): data is Trail {
  return (
    Array.isArray(data) &&
    data.length <= 2400 &&
    data.some((p) => p !== null) &&
    data.every(
      (p) =>
        p === null ||
        (Array.isArray(p) &&
          p.length === 2 &&
          p.every((n) => Number.isFinite(n) && Math.abs(n) <= size + 4)),
    )
  );
}
function leafFrom(value: Leaf): Leaf {
  if (
    !value ||
    !/^[\w-]{1,80}$/.test(value.id) ||
    typeof value.title !== "string" ||
    value.title.length > 80 ||
    typeof value.score !== "string" ||
    value.score.length > 300
  )
    throw Error("면을 읽을 수 없습니다.");
  if (value.sourceId !== undefined && !/^[\w-]{1,80}$/.test(value.sourceId))
    throw Error("원본 면을 찾을 수 없습니다.");
  const world = validateWorld(value.world);
  if (value.trail !== undefined && !validTrail(value.trail, world.size))
    throw Error("걸음 기록을 읽을 수 없습니다.");
  return { ...value, world };
}
export function shelf(): Leaf[] {
  const leaves: { leaf: Leaf; order: number }[] = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(prefix)) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key)!);
      leaves.push({
        leaf: leafFrom(data.leaf ?? data),
        order: Number(data.order) || 0,
      });
    } catch {
      /* Preserve unreadable entries in storage. */
    }
  }
  const items = leaves
    .sort((a, b) => a.order - b.order)
    .map((item) => item.leaf);
  return items.flatMap((leaf) => {
    if (
      leaf.trail &&
      items.some((parent) => parent.id === leaf.sourceId && !parent.trail)
    )
      return [];
    return [
      leaf,
      ...items.filter(
        (reply) =>
          reply.trail && reply.sourceId === leaf.id && reply.id !== leaf.id,
      ),
    ];
  });
}
export function fileLeaf(leaf: Leaf) {
  const key = prefix + leaf.id;
  const prior = localStorage.getItem(key);
  const order = prior ? (JSON.parse(prior).order ?? Date.now()) : Date.now();
  localStorage.setItem(key, JSON.stringify({ leaf, order }));
}
export function isFiled(leaf: Leaf) {
  return localStorage.getItem(prefix + leaf.id) !== null;
}
export async function linkTo(leaf: Leaf) {
  const world = await encodeWorld(leaf.world);
  if (world.length > 500000)
    throw Error("이 면은 링크에 담기에는 큽니다. 이미지 크기를 줄여 주세요.");
  const fields = new URLSearchParams({
    id: leaf.id,
    title: leaf.title,
    score: leaf.score,
    edition: world,
  });
  if (leaf.sourceId) fields.set("source", leaf.sourceId);
  if (leaf.trail) fields.set("walk", JSON.stringify(leaf.trail));
  const url = new URL(location.href);
  url.hash = fields.toString();
  return url.href;
}
export async function readLink(hash: string) {
  if (hash.length > 700000) throw Error("면 링크가 너무 깁니다.");
  const fields = new URLSearchParams(hash.slice(1));
  const world = await decodeWorld(fields.get("edition") ?? "");
  return leafFrom({
    id: fields.get("id") ?? "",
    title: fields.get("title") ?? "",
    score: fields.get("score") ?? "",
    world,
    sourceId: fields.get("source") ?? undefined,
    trail: fields.has("walk") ? JSON.parse(fields.get("walk")!) : undefined,
  });
}
export function sectors(trail: Trail, size: number) {
  const visited = new Set<string>();
  for (const p of trail) {
    if (!p) continue;
    const [x, z] = p.map((n) =>
      Math.max(0, Math.min(2, Math.floor(((n + 0.5) * 3) / size))),
    );
    visited.add("ABC"[x] + (z + 1));
  }
  return [...visited].join(" → ");
}
