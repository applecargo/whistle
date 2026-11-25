import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { monitors, type Monitor } from "@/lib/observation";
import { defaultRoom, type RoomMapping } from "@/lib/uwb-position";
import { sectors, trailLifetime, type Sector, type SectorSnapshot, type TrailSegment } from "@/lib/exhibition";
import { LIVE_WORLD_CHANNEL } from "@/lib/live-world";
import { createWorldDeriver } from "@/lib/world-derivation";
import { SceneLoading, useLanguage } from "./Language";

import { exampleMount, readMount, type VisitorPose } from "@/lib/display-proximity";

const Scene = lazy(() => import("./Scene"));

function DisplayScreen({ id }: { id: Sector | Monitor }) {
  const { language } = useLanguage();
  const [state, setState] = useState<Omit<SectorSnapshot, "trail"> | null>(null);
  const sector = sectors.find(s => s === id);
  const [mapping, setMapping] = useState<RoomMapping>(defaultRoom);
  const visitor = useRef<VisitorPose | null>(null);
  const mount = useMemo(() => readMount(id, new URLSearchParams(location.search)), [id]);
  const trail = useRef<TrailSegment[]>([]);
  const derive = useMemo(createWorldDeriver, []);
  const derivation = useMemo(() => state && derive(state.world, state.actors), [state, derive]);
  useEffect(() => {
    const channel = new BroadcastChannel(LIVE_WORLD_CHANNEL);
    let source = "", lastSeen = 0;
    const request = () => channel.postMessage({ type: "request" });
    const clear = () => { source = ""; trail.current = []; visitor.current = null; setState(null); };
    channel.onmessage = ({ data }) => {
      if (!data?.source || (source && source !== data.source)) return;
      if (data.type === "world" && Array.isArray(data.actors) && Array.isArray(data.trail)) {
        source = data.source;
        setMapping(data.mapping ?? defaultRoom);
        trail.current = data.trail;
        visitor.current = data.visitor ?? null;
        setState({ world: data.world, actors: data.actors });
      } else if (!source) return;
      else if (data.type === "mapping") setMapping(data.mapping);
      else if (data.type === "actors") setState(old => old && { ...old, actors: data.actors });
      else if (data.type === "visitor" || data.type === "trail") {
        if (data.type === "visitor") visitor.current = data.visitor;
        if (!data.segment) return;
        const since = Date.now() - trailLifetime;
        trail.current = trail.current.filter(segment => segment.time > since);
        trail.current.push(data.segment);
      } else if (data.type === "closed" || data.type === "unavailable") {
        clear();
        return;
      }
      lastSeen = Date.now();
    };
    request();
    const timer = window.setInterval(() => {
      if (source && Date.now() - lastSeen > 15000) clear();
      if (source) channel.postMessage({ type: "ping", target: source });
      else request();
    }, 3000);
    return () => { clearInterval(timer); channel.close(); };
  }, []);
  return <main className="sector-screen">
    {state && derivation ? <Suspense fallback={<SceneLoading />}>
      <Scene world={state.world} simulation={state} derivation={derivation} mode={sector ? "sector" : "observation"} mapping={mapping} sector={sector} trail={trail} visitor={visitor} mount={mount} />
    </Suspense> : <div role="status">{language === "ko"
      ? `${id} · 같은 브라우저에서 메인 화면을 열면 연결됩니다.`
      : `${id} · Open the main screen in the same browser to connect.`}</div>}
  </main>;
}

export default function SectorDisplay({ display }: { display: string }) {
  const { language } = useLanguage();
  const [selected, setSelected] = useState<Monitor>("M1");
  const id = [...monitors, ...sectors].find(value => value === display);
  const ko = language === "ko";
  useEffect(() => { document.title = `Whistle · ${id ?? (ko ? "전시 화면" : "Exhibition")}`; }, [id, ko]);
  if (id) return <DisplayScreen id={id} />;
  return <main className="sector-picker">
    <h1>{ko ? "오브제 관찰 화면" : "Object views"}</h1>
    <p>{ko ? "메인 편집기를 열어 두고 미니디스플레이에 배정할 화면을 선택하세요." : "Keep the main editor open and select a view for each display."}</p>
    <nav aria-label={ko ? "관찰 화면 선택" : "Choose object view"}>
      {monitors.map(id => <a key={id} href={`?display=${id}`} target="_blank" rel="noopener">{id}</a>)}
    </nav>
    <details><summary>{language === "ko" ? "UWB 모니터 설치 위치" : "UWB monitor placement"}</summary>
      <form method="get" target="_blank" rel="noopener">
        <label>{language === "ko" ? "모니터" : "Monitor"} <select name="display" value={selected} onChange={e => setSelected(e.target.value as Monitor)}>
          {monitors.map(id => <option key={id}>{id}</option>)}
        </select></label>
        <fieldset key={selected}><legend>{language === "ko" ? "전시장 좌표 · 예시 배치 6 × 6 m" : "Room coordinates · example 6 × 6 m"}</legend>
          <label>X (m) <input required type="number" step="any" name="mx" defaultValue={exampleMount(selected).x} /></label>
          <label>Z (m) <input required type="number" step="any" name="mz" defaultValue={exampleMount(selected).z} /></label>
          <label>{language === "ko" ? "화면 정면" : "Screen front"} (0° = +Z, 90° = +X) <input required type="number" step="any" name="face" defaultValue={exampleMount(selected).facing} /></label>
        </fieldset>
        <button>{language === "ko" ? "이 배치로 화면 열기" : "Open this display"}</button>
      </form>
      <a href="uwb-lab/index.html?exhibition=1" target="_blank" rel="noopener">{language === "ko" ? "UWB 관객 위치 테스트" : "Test visitor tracking"}</a>
    </details>
  </main>;
}
