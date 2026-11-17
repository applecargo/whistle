import type { SymbolSiteKind } from "@/lib/world";

const colors = ["#a8e600", "#ff36b5", "#00dca0", "#00cfff", "#ff7a28", "#b65cff"];
function colorFor(seed: string) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return colors[(hash >>> 0) % colors.length];
}
export function SiteGlyph({ kind, filled = false, seed }: { kind: SymbolSiteKind; filled?: boolean; seed: string }) {
  return <svg viewBox="0 0 32 32" aria-hidden="true" className="site-glyph" style={{ color: colorFor(seed) }}>
    <g fill={filled ? "currentColor" : "#fff"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      {kind === "cluster" ? <circle cx="16" cy="16" r="10" /> :
        kind === "peak" ? <path d="M16 4 29 27H3Z" /> : <rect x="2" y="11" width="28" height="10" rx="2" />}
    </g>
  </svg>;
}
