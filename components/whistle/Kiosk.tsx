// 키오스크(kiosk/index.html): UWB 다중 플레이어 전시에서 맵을 만드는 PC 한 대.
// - 맵이 바뀔 때마다 통째로 UWB 수신기의 맵 길(lib/uwb/world-link.ts)로 보낸다. 플레이어 PC(player/index.html)가 받아 소리를 낸다.
// - 수신기의 위치 길에서 태그 0~3을 받아 편집 격자 위에 표시한다(소리는 내지 않는다).
// - 수신기 주소와 전시장 매핑(현실 m → 격자)은 여기서 정하고 맵과 함께 보낸다. 플레이어는 따로 정하지 않는다.
import { useEffect, useRef, useState } from "react";
import type { World } from "@/lib/world";
import { mapRoomPosition, type RoomMapping } from "@/lib/uwb-position";
import { parseBridgeMessage, TRACKING_TIMEOUT_MS } from "@/lib/uwb/protocol";
import { WORLD_PATH, validMapping } from "@/lib/uwb/world-link";
import { useSocket, type Link } from "./useSocket";
import "./kiosk.css";

const TAGS = ["0", "1", "2", "3"];
const SETTINGS_KEY = "whistle.kiosk.v1";
type Settings = { bridge: string; mapping: RoomMapping };
export type KioskPlayer = { tag: string; state: "none" | "outside" | "tracking"; x?: number; z?: number; metres?: { x: number; z: number } };

/** 이 페이지를 연 주소의 호스트(같은 PC면 127.0.0.1). 수신기 기본 포트 5194 */
const defaultBridge = () => `ws://${["localhost", "[::1]", ""].includes(location.hostname) ? "127.0.0.1" : location.hostname}:5194`;
const defaultSettings = (): Settings => ({ bridge: defaultBridge(), mapping: { originX: 0, originZ: 0, width: 6, depth: 6, rotation: 0 } });
export function readSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    if (saved && typeof saved.bridge === "string" && validMapping(saved.mapping)) return saved;
  } catch { /* 저장소 없음 */ }
  return defaultSettings();
}
const urlOf = (bridge: string, path = "/") => {
  try {
    const url = new URL(path, bridge);
    return ["ws:", "wss:"].includes(url.protocol) ? url : null;
  } catch { return null; }
};

export function useKioskLink(enabled: boolean, world: World, ready: boolean) {
  const [settings, setSettingsState] = useState(readSettings);
  const setSettings = (next: Settings) => {
    setSettingsState(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* 저장소 없음 */ }
  };
  const mappingValid = validMapping(settings.mapping);
  const current = useRef({ world, ready, mapping: settings.mapping, mappingValid });
  current.current = { world, ready, mapping: settings.mapping, mappingValid };
  const send = (ws: WebSocket | null) => {
    const { world, ready, mapping, mappingValid } = current.current;
    if (ws?.readyState === WebSocket.OPEN && ready && mappingValid) ws.send(JSON.stringify({ type: "world", world, mapping }));
  };
  const worldLink = useSocket(enabled ? urlOf(settings.bridge, WORLD_PATH) : undefined, send);
  // 맵·매핑이 바뀌면 보낸다(붓질 중에는 0.1초에 한 번)
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => send(worldLink.socket.current), 100);
    return () => clearTimeout(timer);
  }, [enabled, world, ready, settings.mapping]);

  const seen = useRef(new Map<string, { x: number; z: number; at: number }>());
  const positions = useSocket(enabled ? urlOf(settings.bridge) : undefined, () => {}, (data) => {
    try {
      if (typeof data !== "string") return;
      const message = parseBridgeMessage(data);
      if (message.type === "position") seen.current.set(message.tagId, { x: message.x, z: message.z, at: performance.now() });
    } catch { /* 다른 메시지 */ }
  });
  const [players, setPlayers] = useState<KioskPlayer[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const { world, mapping, mappingValid } = current.current;
      setPlayers(TAGS.map((tag) => {
        const last = seen.current.get(tag);
        if (!last || performance.now() - last.at > TRACKING_TIMEOUT_MS) return { tag, state: "none" };
        const metres = { x: last.x, z: last.z };
        const grid = mappingValid ? mapRoomPosition(metres, mapping, world.size) : null;
        return grid ? { tag, state: "tracking", ...grid, metres } : { tag, state: "outside", metres };
      }));
    }, 100);
    return () => clearInterval(timer);
  }, [enabled]);
  return { settings, setSettings, mappingValid, world: worldLink.state, positions: positions.state, players };
}
export type KioskLink = ReturnType<typeof useKioskLink>;

/** 편집 격자 위 태그 표시 */
export function KioskPlayers({ players, size }: { players: KioskPlayer[]; size: number }) {
  return <div className="kiosk-map-layer">
    {players.filter((p) => p.state === "tracking").map((p) => <span key={p.tag} className={`kiosk-player tag-${p.tag}`}
      style={{ left: `${(p.x! + .5) / size * 100}%`, top: `${(p.z! + .5) / size * 100}%` }}
      role="img" aria-label={`태그 ${p.tag}`} data-kiosk-player={p.tag}>T{p.tag}</span>)}
  </div>;
}

const linkLabel: Record<Link, string> = { off: "꺼짐", connecting: "연결 중", connected: "연결됨", disconnected: "끊김 · 다시 연결 중", invalid: "주소 오류" };
const mappingLabels: Record<keyof RoomMapping, string> = { originX: "원점 X", originZ: "원점 Z", width: "가로", depth: "세로", rotation: "회전°" };

function KioskStatus({ link }: { link: KioskLink }) {
  return <>
    <p role="status" data-kiosk-world={link.world}>맵 보내기: {linkLabel[link.world]}{link.mappingValid ? "" : " · 매핑을 고쳐 주세요"}</p>
    <p role="status" data-kiosk-positions={link.positions}>태그 수신: {linkLabel[link.positions]}</p>
  </>;
}

function KioskTags({ players }: { players: KioskPlayer[] }) {
  return (
    <ul className="kiosk-tags">
      {players.map((p) => <li key={p.tag} data-kiosk-tag={p.tag} data-state={p.state}>
        <b>T{p.tag}</b> {p.state === "none" ? "수신 없음" : `${p.metres!.x.toFixed(2)}, ${p.metres!.z.toFixed(2)} m${p.state === "outside" ? " · 공간 밖" : ""}`}
      </li>)}
    </ul>
  );
}

export function KioskLog({ link }: { link: KioskLink }) {
  return <section className="kiosk-panel" aria-label="수신 로그">
    <h2>수신 로그</h2>
    <KioskStatus link={link} />
    <KioskTags players={link.players} />
  </section>;
}

export function KioskPanel({ link }: { link: KioskLink }) {
  const { settings, setSettings } = link;
  const [bridge, setBridge] = useState(settings.bridge);
  const host = location.host;
  return <section className="kiosk-panel" aria-label="전시장">
    <h2>전시장</h2>
    <form onSubmit={(event) => { event.preventDefault(); setSettings({ ...settings, bridge: bridge.trim() }); }}>
      <label>UWB 수신기 <input value={bridge} onChange={(event) => setBridge(event.target.value)} spellCheck={false} /></label>
      <button type="submit" disabled={bridge.trim() === settings.bridge}>적용</button>
    </form>
    <KioskStatus link={link} />
    <fieldset><legend>전시장 매핑 (m)</legend>
      {(Object.keys(mappingLabels) as (keyof RoomMapping)[]).map((key) => <label key={key}>{mappingLabels[key]}
        <input type="number" step="any" value={Number.isFinite(settings.mapping[key]) ? settings.mapping[key] : ""}
          onChange={(event) => setSettings({ ...settings, mapping: { ...settings.mapping, [key]: event.target.valueAsNumber } })} /></label>)}
    </fieldset>
    <KioskTags players={link.players} />
    <p className="kiosk-hint">플레이어 PC: <code>http://{host}/whistle/player/?tag=0</code> (태그 0~3)</p>
  </section>;
}
