import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { readSettings } from "../components/whistle/Kiosk";
import { SceneLoading } from "../components/whistle/Language";
import { createSimulation, type World } from "../lib/world";
import { createWorldDeriver } from "../lib/world-derivation";
import { useWorldLink } from "../uwb-lab/useWorldLink";

const Scene = lazy(() => import("../components/whistle/Scene"));

export default function KioskOverview() {
  const [bridge, setBridge] = useState(() => readSettings().bridge);
  const [world, setWorld] = useState<World | null>(null);
  const link = useWorldLink(bridge, setWorld);
  const derive = useMemo(createWorldDeriver, []);
  const simulation = useMemo(() => world && createSimulation(world), [world]);
  const derivation = useMemo(() => world && simulation && derive(world, simulation.actors), [derive, world, simulation]);
  useEffect(() => {
    const update = () => setBridge(readSettings().bridge);
    window.addEventListener("storage", update);
    update();
    return () => window.removeEventListener("storage", update);
  }, []);
  return <main className="sector-screen" aria-label="전시장 3D">
    {world && simulation && derivation
      ? <Suspense fallback={<SceneLoading />}><Scene mode="overview" world={world} simulation={simulation} derivation={derivation} /></Suspense>
      : <div role="status">{link.error || "키오스크 맵 수신 대기 중"}</div>}
  </main>;
}
