import type { World } from "./world.ts";

export const PORTAL_PATH = "/whistle/portals";
export const MAX_PORTAL_WORLD_BYTES = 16 * 1024 * 1024;
export type PortalPeer = { id: string; label: string; title: string; revision: number };
export type PortalMessage =
  | { type: "welcome"; id: string; label: string }
  | { type: "peers"; peers: PortalPeer[]; count: number }
  | { type: "published" }
  | { type: "world"; requestId: string; peer: PortalPeer; world: World }
  | { type: "error"; message: string; requestId?: string };

export function portalRoom(url: URL) {
  const query = new URLSearchParams(url.search);
  query.sort();
  return `${url.pathname.replace(/\/$/, "") || "/"}?${query}`;
}

export function portalSocketURL(page: URL, endpoint?: string) {
  const url = new URL(endpoint || PORTAL_PATH, page);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  if (!["ws:", "wss:"].includes(url.protocol)) throw new Error("포털에 연결할 수 없습니다.");
  url.searchParams.set("room", portalRoom(page));
  return url.href;
}

export function portalWorld(world: World): World {
  return { ...world, assets: world.assets.map(({ originalImage: _, ...asset }) => asset) };
}
