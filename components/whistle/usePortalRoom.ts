import { useCallback, useEffect, useRef, useState } from "react";
import { uid, validateWorld, type World } from "../../lib/world.ts";
import { upgradeTerrain } from "../../lib/terrain.ts";
import { MAX_PORTAL_WORLD_BYTES, portalSocketURL, portalWorld, type PortalMessage, type PortalPeer } from "../../lib/portal-protocol.ts";

export type PortalVisit = { peer: PortalPeer; world: World };
type Pending = { resolve: (visit: PortalVisit) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export function usePortalRoom(world: World, ready: boolean) {
  const [peers, setPeers] = useState<PortalPeer[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [self, setSelf] = useState<{ id: string; label: string } | null>(null);
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [error, setError] = useState("");
  const current = useRef(world);
  current.current = world;
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const publish = useRef<() => void>(() => {});

  useEffect(() => {
    if (!ready) return;
    let disposed = false, delay = 1000;
    let reconnect: ReturnType<typeof setTimeout>;
    let publishTimer: ReturnType<typeof setTimeout>;
    let connecting: ReturnType<typeof setTimeout>;
    const rejectPending = () => {
      for (const request of pending.current.values()) { clearTimeout(request.timer); request.reject(new Error("포털 연결이 끊겼습니다.")); }
      pending.current.clear();
    };
    let ownId = "";
    const sendWorld = () => {
      clearTimeout(publishTimer);
      if (socket.current?.readyState !== WebSocket.OPEN || !ownId) return;
      const message = JSON.stringify({ type: "publish", world: portalWorld(current.current) });
      if (new TextEncoder().encode(message).byteLength > MAX_PORTAL_WORLD_BYTES) {
        setError("세계가 너무 커서 포털을 열 수 없습니다."); return;
      }
      socket.current.send(message);
    };
    publish.current = () => { clearTimeout(publishTimer); publishTimer = setTimeout(sendWorld, 450); };
    let endpoint: string;
    try { endpoint = portalSocketURL(new URL(location.href), import.meta.env.VITE_PORTAL_SERVER_URL); }
    catch { setStatus("offline"); setError("포털에 연결할 수 없습니다."); return; }
    const connect = () => {
      if (disposed) return;
      if (!navigator.onLine) { setStatus("offline"); return; }
      setStatus("connecting");
      let connection: WebSocket;
      try { connection = new WebSocket(endpoint); }
      catch {
        setStatus("offline"); setError("포털에 연결할 수 없습니다.");
        reconnect = setTimeout(connect, 15_000);
        return;
      }
      socket.current = connection;
      ownId = "";
      connecting = setTimeout(() => connection.close(), 8000);
      connection.onmessage = ({ data }) => {
        if (disposed || socket.current !== connection) return;
        try {
          const message = JSON.parse(data) as PortalMessage;
          if (message.type === "welcome") {
            clearTimeout(connecting);
            ownId = message.id;
            delay = 1000;
            setSelf({ id: message.id, label: message.label });
            setStatus("online");
            sendWorld();
          } else if (message.type === "peers") {
            if (!Array.isArray(message.peers) || message.peers.length > 32) return;
            setPeers(message.peers.filter(peer => peer.id !== ownId));
            setCount(Number.isInteger(message.count) && message.count >= 1 && message.count <= 32 ? message.count : null);
          } else if (message.type === "published") setError("");
          else if (message.type === "world") {
            const request = pending.current.get(message.requestId);
            if (!request) return;
            clearTimeout(request.timer);
            pending.current.delete(message.requestId);
            try { request.resolve({ peer: message.peer, world: upgradeTerrain(validateWorld(message.world)) }); }
            catch { request.reject(new Error("세계 데이터를 읽을 수 없습니다.")); }
          } else if (message.type === "error") {
            const request = message.requestId && pending.current.get(message.requestId);
            if (request) {
              clearTimeout(request.timer); pending.current.delete(message.requestId!);
              request.reject(new Error(message.message));
            } else setError(message.message);
          }
        } catch { setError("세계 데이터를 읽을 수 없습니다."); }
      };
      connection.onclose = () => {
        clearTimeout(connecting);
        if (disposed || socket.current !== connection) return;
        socket.current = null;
        ownId = "";
        setPeers([]); setSelf(null); setCount(null); setStatus("offline");
        rejectPending();
        reconnect = setTimeout(connect, delay);
        delay = Math.min(15_000, delay * 2);
      };
      connection.onerror = () => connection.close();
    };
    connect();
    const offline = () => {
      clearTimeout(reconnect);
      setStatus("offline"); setCount(null); setPeers([]); setSelf(null);
      rejectPending();
      socket.current?.close();
    };
    const online = () => {
      clearTimeout(reconnect);
      if (socket.current?.readyState === WebSocket.OPEN || socket.current?.readyState === WebSocket.CONNECTING) return;
      connect();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    const refresh = () => { if (document.visibilityState === "visible") publish.current(); };
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearTimeout(reconnect); clearTimeout(publishTimer); clearTimeout(connecting);
      publish.current = () => {};
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      socket.current?.close(); socket.current = null;
      document.removeEventListener("visibilitychange", refresh);
      rejectPending();
    };
  }, [ready]);

  useEffect(() => { if (ready) publish.current(); }, [world, ready]);

  const visit = useCallback((target: string) => new Promise<PortalVisit>((resolve, reject) => {
    if (socket.current?.readyState !== WebSocket.OPEN) { reject(new Error("포털 연결이 끊겼습니다.")); return; }
    const requestId = uid();
    const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error("세계를 불러오지 못했습니다. 다시 시도해 주세요.")); }, 12_000);
    pending.current.set(requestId, { resolve, reject, timer });
    socket.current.send(JSON.stringify({ type: "visit", target, requestId }));
  }), []);

  return { peers, self, count: status === "online" ? count : null, status, error, visit };
}
