import type { SymbolSiteKind } from "@/lib/world";

export function SiteGlyph({ kind, filled = false, color }: { kind: SymbolSiteKind; filled?: boolean; color: string }) {
  return <svg viewBox="0 0 32 32" aria-hidden="true" className="site-glyph" style={{ color }}>
    <g fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      {kind === "cluster" ? <circle cx="16" cy="16" r="10" /> :
        kind === "peak" ? <path d="M16 4 29 27H3Z" /> : <rect x="2" y="11" width="28" height="10" rx="2" />}
    </g>
  </svg>;
}
