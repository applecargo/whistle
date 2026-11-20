import type { EnvironmentCell } from "@/lib/environment";

export function environmentTileKind(c: EnvironmentCell) {
  if (c.water !== null) return "water";
  if (c.tree) return "tree";
  if (c.grass > 0) return "grass";
  return null;
}


export function EnvironmentTile({ cell }: { cell: EnvironmentCell }) {
  const kind = environmentTileKind(cell);
  if (!kind) return null;
  return (
    <svg
      className={`result-tile result-${kind}`}
      data-result={kind}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect width="32" height="32" fill="#fff" />
      <g
        fill="none"
        stroke="#000"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "water" && (
          <path d="M-4 9Q0 4 4 9T12 9T20 9T28 9T36 9M-4 17Q0 12 4 17T12 17T20 17T28 17T36 17M-4 25Q0 20 4 25T12 25T20 25T28 25T36 25" />
        )}
        {kind === "grass" && (
          <path
            d="M16 24V8M16 24Q14 16 8 14M16 24Q18 16 24 12"
            strokeWidth="1.2"
          />
        )}
        {kind === "tree" && (
          <g strokeWidth="1.2">
            <circle cx="16" cy="12" r="5.5" />
            <path d="M16 17.5V25" />
          </g>
        )}
      </g>
    </svg>
  );
}
