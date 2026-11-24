function PatternMark({ kind }: { kind: string }) {
  switch (kind) {
    case "wind": return <path d="M3 10C6 10 6 6 10 6H13" />;
    case "dust": return <g fill="currentColor" stroke="none">
      <rect x="3" y="4" width="1.4" height="1.4" /><rect x="10" y="3" width="1" height="1" />
      <rect x="7" y="10" width="1.4" height="1.4" /><rect x="12" y="12" width="1" height="1" />
    </g>;
    case "fog": return <path d="M3 6H10M6 10H13" />;
    case "lift": return <path d="M5 12V6M11 9V3" />;
    case "flow": return <path d="M2 8Q5 3 8 8T14 8" />;
    case "flicker": return <path d="M8 5V11M5 8H11" />;
    default: return null;
  }
}

export function EffectPattern({ id, kinds }: { id: string; kinds: string[] }) {
  const columns = Math.min(kinds.length, 2), rows = Math.ceil(kinds.length / columns);
  return <pattern id={id} width={columns * .5} height={rows * .5}
    patternUnits="userSpaceOnUse" viewBox={`0 0 ${columns * 16} ${rows * 16}`}>
    <g fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity=".3">
      {kinds.map((kind, i) => <g key={kind} transform={`translate(${i % columns * 16} ${Math.floor(i / columns) * 16})`}>
        <PatternMark kind={kind} />
      </g>)}
    </g>
  </pattern>;
}
