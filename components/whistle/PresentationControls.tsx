import { useLanguage } from "./Language";

type Placement = "upright" | "floating" | "surface";
const placements: Placement[] = ["upright", "floating", "surface"];
const placementNames = { upright: "세우기", floating: "띄우기", surface: "붙이기" };

export function PresentationControls({ placement, onPlacement }: {
  placement: Placement; onPlacement: (value: Placement) => void;
}) {
  const { t } = useLanguage();
  const nextPlacement = placements[(placements.indexOf(placement) + 1) % placements.length];
  return <div className="asset-presentation-controls">
    <button type="button" data-placement={placement} aria-label={`${t("배치 방식")}: ${t(placementNames[placement])}`}
      onClick={() => onPlacement(nextPlacement)}>{t(placementNames[placement])}<CycleMark /></button>

  </div>;
}

function CycleMark() {
  return <svg className="cycle-mark" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12.7 5.5A5 5 0 1 0 13 9M10 5.5h3.5V2" />
  </svg>;
}
