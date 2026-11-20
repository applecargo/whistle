import type { Asset, World } from "./world.ts";

export const MAX_CONTENT_COUNT = 20;
export type ContentKind = "image" | "text" | "sound";
export function contentKind(asset?: Asset): ContentKind | null {
  if (asset?.sound) return "sound";
  if (asset?.text !== undefined) return "text";
  return asset?.image ? "image" : null;
}
export const contentLimitMessage = {
  image: "이미지는 최대 20개까지 사용할 수 있습니다.",
  text: "텍스트는 최대 20개까지 사용할 수 있습니다.",
  sound: "사운드는 최대 20개까지 사용할 수 있습니다.",
};
export function validateContentCounts(world: World) {
  const kinds = new Map(world.assets.map(asset => [asset.id, contentKind(asset)]));
  for (const kind of ["image", "text", "sound"] as const) {
    if (world.assets.filter(asset => contentKind(asset) === kind).length > MAX_CONTENT_COUNT ||
        world.objects.filter(object => kinds.get(object.asset) === kind).length > MAX_CONTENT_COUNT) {
      throw new Error(contentLimitMessage[kind]);
    }
  }
}
