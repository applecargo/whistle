import type { Asset, Placed, SymbolSiteKind, World } from "./world.ts";
import type { Environment } from "./environment.ts";
import { isHole } from "./tile.ts";

export type SymbolSite = { id: string; kind: SymbolSiteKind; x: number; z: number; cells: number[]; placement: "surface" | "upright" };
export const SITE_TYPES = {
  cluster: { name: "군집의 이미지", media: "image", shape: "sphere" },
  peak: { name: "높은 곳의 글", media: "text", shape: "cone" },
  boundary: { name: "경계의 글", media: "text", shape: "bar" },
} as const;

export function deriveSymbolSites(world: World, environment: Environment): SymbolSite[] {
  const tiles = world.terrain?.tiles;
  if (!tiles) return [];
  const size = world.size;
  const placed = world.objects.filter(o => { const a = world.assets.find(a => a.id === o.asset); return !!a?.image || !!a?.text?.trim(); });
  const adjacent = (i: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].flatMap(([dx, dz]) => {
    const x = i % size + dx, z = Math.floor(i / size) + dz;
    return x < 0 || z < 0 || x >= size || z >= size ? [] : [z * size + x];
  });
  const connected = (indices: number[]) => {
    const pending = new Set(indices), groups: number[][] = [];
    while (pending.size) {
      const first = pending.values().next().value!, group = [first]; pending.delete(first);
      for (let n = 0; n < group.length; n++) for (const next of adjacent(group[n])) if (pending.delete(next)) group.push(next);
      groups.push(group.sort((a, b) => a - b));
    }
    return groups;
  };
  const candidates: { kind: SymbolSiteKind; cells: number[]; positions?: number[]; placement: SymbolSite["placement"] }[] = [];
  const raised = tiles.flatMap((tile, i) => !isHole(tile) && tile.height > 0 ? [i] : []);
  for (const cells of connected(raised)) {
    const members = new Set(cells), height = Math.max(...cells.map(i => tiles[i].height));
    const outside = cells.flatMap(adjacent).filter(i => !members.has(i));
    if (height < 2 || !outside.length || height - Math.min(...outside.map(i => tiles[i].height)) < 2) continue;
    candidates.push({ kind: "peak", cells, positions: cells.filter(i => tiles[i].height === height), placement: "upright" });
  }
  const regions = environment.regions.filter(region => region.kind !== "hole" && region.cells.length >= 6);
  for (const region of regions) {
    if (region.kind !== "soft" && region.kind !== "slick") continue;
    const members = new Set(region.cells);
    if (!region.cells.some(i => adjacent(i).filter(n => members.has(n)).length >= 3)) continue;
    candidates.push({ kind: "cluster", cells: [...region.cells].sort((a, b) => a - b), placement: region.kind === "slick" ? "upright" : "surface" });
  }
  const regionAt = new Map<number, number>();
  regions.forEach((region, id) => region.cells.forEach(i => regionAt.set(i, id)));
  const boundaries = new Map<string, { cells: Set<number>; contacts: number }>();
  for (const [i, region] of regionAt) for (const n of adjacent(i)) {
    const other = regionAt.get(n);
    if (other === undefined || other <= region || regions[other].kind === regions[region].kind) continue;
    const key = `${region}:${other}`, boundary = boundaries.get(key) ?? { cells: new Set<number>(), contacts: 0 };
    boundary.cells.add(i); boundary.cells.add(n); boundary.contacts++;
    boundaries.set(key, boundary);
  }
  for (const boundary of boundaries.values()) if (boundary.contacts >= 4) {
    for (const cells of connected([...boundary.cells].sort((a, b) => a - b))) {
      if (cells.length >= 6) candidates.push({ kind: "boundary", cells, placement: "upright" });
    }
  }
  const sites: SymbolSite[] = [], limit = Math.max(0, Math.min(6, Math.max(2, Math.floor(size / 4))) - placed.length);
  for (const candidate of candidates) {
    if (sites.length >= limit) break;
    if (placed.some(object => object.site?.kind === candidate.kind &&
        object.site.cells.some(i => candidate.cells.includes(i)))) continue;
    const cx = candidate.cells.reduce((sum, i) => sum + i % size, 0) / candidate.cells.length;
    const cz = candidate.cells.reduce((sum, i) => sum + Math.floor(i / size), 0) / candidate.cells.length;
    if (candidate.kind === "cluster" && sites.some(site => candidate.cells.includes(site.z * size + site.x))) continue;
    const sorted = [...(candidate.positions ?? candidate.cells)].sort((a, b) => Math.hypot(a % size - cx, Math.floor(a / size) - cz) - Math.hypot(b % size - cx, Math.floor(b / size) - cz) || a - b);
    const cell = sorted.find(i => !isHole(tiles[i]) &&
      !(i % size === world.start.x && Math.floor(i / size) === world.start.z) &&
      !placed.some(o => Math.hypot(o.x - i % size, o.z - Math.floor(i / size)) < 3) &&
      !sites.some(s => Math.hypot(s.x - i % size, s.z - Math.floor(i / size)) < 3));
    if (cell === undefined) continue;
    sites.push({ kind: candidate.kind, cells: candidate.cells, placement: candidate.placement, id: `site:${candidate.kind}:${candidate.cells[0]}`, x: cell % size, z: Math.floor(cell / size) });
  }
  return sites;
}

export function siteAsset(site: SymbolSite, id: string): Asset {
  const type = SITE_TYPES[site.kind];
  return { id, name: type.name, shape: type.shape, color: "#111111", solid: false,
    placement: site.kind === "peak" ? "floating" : site.placement,
    display: site.kind === "peak" ? "nearby" : site.kind === "boundary" ? "pulse" : "steady", ...(type.media === "text" ? { text: "" } : {}) };
}
export function siteMedia(object: Placed, asset: Asset): "image" | "text" {
  return object.site ? SITE_TYPES[object.site.kind].media : asset.text !== undefined ? "text" : "image";
}
