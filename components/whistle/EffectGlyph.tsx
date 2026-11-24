export function EffectGlyph({ kind }: { kind: string }) {
  return <svg viewBox="0 0 32 32" fill="currentColor" stroke="none" aria-hidden="true">
    {kind === "wind" && <>
      <path d="M8 13a.8.8 0 0 1 0-1.6H21a2.2 2.2 0 1 0-2.2-2.2.8.8 0 0 1-1.6 0A3.8 3.8 0 1 1 21 13Z" />
      <path d="M8 18a.8.8 0 0 1 0-1.6H18a3.8 3.8 0 1 1-3.8 3.8.8.8 0 0 1 1.6 0A2.2 2.2 0 1 0 18 18Z" />
    </>}
    {kind === "dust" && <>
      <circle cx="10" cy="21" r="1.7" /><circle cx="20" cy="22" r="1.3" />
      <circle cx="23" cy="13" r="1.5" /><circle cx="15" cy="15" r="1.2" />
      <circle cx="12" cy="8" r="1" />
    </>}
    {kind === "fog" && <>
      <rect x="8" y="9" width="13" height="1.8" rx=".9" />
      <rect x="11" y="15" width="14" height="1.8" rx=".9" />
      <rect x="7" y="21" width="13" height="1.8" rx=".9" />
    </>}
    {kind === "lift" && <>
      <ellipse cx="16" cy="10" rx="3.8" ry="2.5" />
      <path d="M11 16a.8.8 0 0 1 1.5.5c-.8 2.5-.8 4.6.1 6.8a.8.8 0 0 1-1.5.6C10 21.3 10 18.9 11 16ZM19.5 16a.8.8 0 0 1 1.5.5c-.8 2.5-.8 4.6.1 6.8a.8.8 0 0 1-1.5.6C18.5 21.3 18.5 18.9 19.5 16Z" />
    </>}
    {kind === "flow" && <>
      {[0, 7].map(y => <path key={y} transform={`translate(0 ${y})`}
        d="M6.5 12.5C9.5 8.5 13 8.5 16.5 12S23 15.5 25.5 12a.8.8 0 0 1 1.3.9C23.7 17.2 20 17.2 15.4 13.2S9.2 11.5 7.8 13.4a.8.8 0 0 1-1.3-.9Z" />)}
    </>}
    {kind === "flicker" && <>
      <circle cx="16" cy="16" r="3" />
      <rect x="15.2" y="6" width="1.6" height="4" rx=".8" />
      <rect x="15.2" y="22" width="1.6" height="4" rx=".8" />
      <rect x="6" y="15.2" width="4" height="1.6" rx=".8" />
      <rect x="22" y="15.2" width="4" height="1.6" rx=".8" />
    </>}
  </svg>;
}
