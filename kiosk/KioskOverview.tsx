import { useEffect, useMemo, useState } from "react";
import { readSettings } from "../components/whistle/Kiosk";
import { EditorPreview } from "../components/whistle/EditorPreview";
import { useEditorPreview } from "./useEditorPreview";
import { createSimulation, type World } from "../lib/world";
import { createWorldDeriver } from "../lib/world-derivation";
import { useWorldLink } from "../uwb-lab/useWorldLink";

export default function KioskOverview() {
  const [bridge, setBridge] = useState(() => readSettings().bridge);
  const [world, setWorld] = useState<World | null>(null);
  const editor = useEditorPreview();
  const link = useWorldLink(editor ? undefined : bridge, setWorld);
  const derive = useMemo(createWorldDeriver, []);
  const simulation = useMemo(() => world && createSimulation(world), [world]);
  const derivation = useMemo(() => world && simulation && derive(world, simulation.actors), [derive, world, simulation]);
  useEffect(() => {
    const update = () => setBridge(readSettings().bridge);
    window.addEventListener("storage", update);
    update();
    return () => window.removeEventListener("storage", update);
  }, []);
  const preview = editor ?? (world && simulation && derivation ? { world, simulation, derivation } : null);
  return <main className="sector-screen" aria-label={editor ? "편집기 미리보기" : "전시장 3D"}>
    {preview ? <EditorPreview {...preview} exhibition />
      : <div role="status">{link.error || "키오스크 맵 수신 대기 중"}</div>}
  </main>;
}
