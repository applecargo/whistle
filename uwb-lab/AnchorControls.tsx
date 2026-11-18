import { useState } from "react";
import { rectangleConfig, type RectangleSetup } from "../lib/uwb/rectangle";

const labels: Record<keyof RectangleSetup, string> = {
  width: "앵커 배치 가로 (m)", depth: "앵커 배치 세로 (m)",
  anchorHeight: "앵커 공통 높이 (m)", tagHeight: "태그 높이 (m)",
};

export default function AnchorControls({ applied, onApply, onClear }: {
  applied: RectangleSetup | null; onApply: (setup: RectangleSetup) => void; onClear: () => void;
}) {
  const [draft, setDraft] = useState<Record<keyof RectangleSetup, string>>(() => applied
    ? { width: String(applied.width), depth: String(applied.depth), anchorHeight: String(applied.anchorHeight), tagHeight: String(applied.tagHeight) }
    : { width: "", depth: "", anchorHeight: "", tagHeight: "" });
  const [error, setError] = useState("");
  const dirty = !!applied && (Object.keys(labels) as (keyof RectangleSetup)[]).some((key) => draft[key] === "" || Number(draft[key]) !== applied[key]);
  return <fieldset><legend>실제 앵커 배치</legend>
    <pre aria-label="앵커 배치도">{"A0 ─── 가로 ─── A1\n│               │\n세로            │\n│               │\nA3 ──────────── A2"}</pre>
    <p>A0: 왼쪽 위 · A1: 오른쪽 위 · A2: 오른쪽 아래 · A3: 왼쪽 아래. +X는 오른쪽, +Z는 아래쪽입니다.</p>
    {(Object.keys(labels) as (keyof RectangleSetup)[]).map((key) => <label key={key}>{labels[key]}
      <input type="number" step="0.01" min={key === "width" || key === "depth" ? "0.01" : "0"}
        max={key === "width" || key === "depth" ? "1000" : "10"} value={draft[key]}
        onChange={(event) => { setDraft({ ...draft, [key]: event.target.value }); setError(""); }} />
    </label>)}
    <div><button onClick={() => {
      try {
        if (Object.values(draft).some((v) => !v.trim())) throw new Error("가로·세로·앵커 높이·태그 높이를 모두 입력하세요.");
        const setup = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value)])) as RectangleSetup;
        rectangleConfig(setup);
        onApply(setup); setError("");
      } catch (e) { setError((e as Error).message); }
    }}>배치 적용 · 위치 연결</button>
    <button disabled={!applied} onClick={() => { onClear(); setError(""); }}>거리만 확인</button></div>
    <p id="anchor-status" role="status">{error || (applied
      ? `설정 적용됨 · ${applied.width} × ${applied.depth}m · 앵커 ${applied.anchorHeight}m · 태그 ${applied.tagHeight}m${dirty ? " · 수정값은 적용 버튼을 눌러 반영하세요." : ""}`
      : "치수를 입력하고 적용하면 실제 위치와 오디오를 연결할 수 있습니다.")}</p>
    <p>가로·세로는 안테나 바로 아래 바닥 지점 사이 거리입니다. 높이는 바닥부터 안테나까지 측정하며 태그 높이는 이동 중 일정하게 유지하세요.</p>
    <p>적용 시 앵커 사각형 전체를 가상 세계에 맞춥니다. 이후 전시장 매핑으로 조정할 수 있습니다.</p>
  </fieldset>;
}
