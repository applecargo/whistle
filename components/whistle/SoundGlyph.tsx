export function SoundGlyph({ color = "currentColor" }: { color?: string }) {
  return <svg viewBox="0 0 32 32" className="site-glyph" aria-hidden="true" style={{ color }}>
    <path d="M6 13v6m5-11v16m5-19v22m5-16v10m5-8v6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>;
}
