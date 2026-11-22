import { useCallback, useEffect, useRef, useState } from "react";
import { type MeetingMessage, type MeetingView, type MeetingPresence, type MeetingPosition, type MeetingWhistle } from "@/lib/meeting";
import { createMeetingCodec } from "@/lib/meeting-wire";
import { meetingSocketURL } from "@/lib/meeting-client";

export function useMeetingRoom(key: string) {
  const [view, setView] = useState<MeetingView | null>(null);
  const [presence, setPresence] = useState<MeetingPresence>({ peers: [], canWhistle: false });
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [error, setError] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const codec = useRef(createMeetingCodec());
  const resetId = useRef(0);
  const listeners = useRef(new Set<(event: MeetingWhistle) => void>());
  useEffect(() => {
    let stopped = false, receivedState = false, delay = 1000;
    let retry: ReturnType<typeof setTimeout> | undefined, connecting: ReturnType<typeof setTimeout> | undefined;
    const storageKey = `whistle.meeting.${key}.id`;
    const createId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,"0")).join("");
    let id: string, token: string;
    try {
      id = sessionStorage.getItem(storageKey) || createId();
      token = sessionStorage.getItem(`${storageKey}.token`) || createId();
      sessionStorage.setItem(storageKey,id);sessionStorage.setItem(`${storageKey}.token`,token);
    } catch { id = createId(); token = createId(); }
    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      let ws: WebSocket;
      try {
        const url = meetingSocketURL(new URL(location.href), import.meta.env.VITE_MEETING_SERVER_URL);
        url.searchParams.set("room", key); url.searchParams.set("id", id); url.searchParams.set("token",token);
        ws = new WebSocket(url);
      } catch {
        setStatus("offline");setError("연결 서버 주소를 확인해 주세요.");return;
      }
      socket.current = ws;
      connecting = setTimeout(() => ws.close(), 15_000);
      codec.current = createMeetingCodec();
      ws.onmessage = event => {
        if (stopped || socket.current !== ws) return;
        let message: MeetingMessage | null;
        try { message = codec.current.decode<MeetingMessage>(event.data); }
        catch (error) { setError((error as Error).message); return; }
        if (!message) return;
        if (message.type === "error") { setError(message.message); return; }
        if (message.type === "whistle") { listeners.current.forEach(listener => listener(message.whistle)); return; }
        setStatus("online"); setPresence(message.presence);
        if (message.type === "state") {
          clearTimeout(connecting);
          receivedState = true; delay = 1000;
          resetId.current = message.view.reset.id;
          setError("");
          id = message.view.id;
          try { sessionStorage.setItem(storageKey, id); } catch { /* Memory session still works. */ }
          setView(previous => previous?.revision === message.view.revision && previous.id === id ? previous : message.view);
        }
      };
      ws.onclose = event => {
        clearTimeout(connecting);
        if (stopped || socket.current !== ws) return;
        setStatus("offline");
        if (event.code === 4001) setError("다른 창에서 이 세계를 열었습니다.");
        else if (!receivedState) setError(previous => previous || "서버에 연결할 수 없습니다. 다시 연결하고 있습니다.");
        if (event.code !== 1008 && event.code !== 4001) {
          retry = setTimeout(connect, delay);
          delay = Math.min(15_000, delay * 2);
        }
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { stopped = true; clearTimeout(retry); clearTimeout(connecting); socket.current?.close(); socket.current = null; };
  }, [key]);
  const send = useCallback((message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      try { for (const frame of codec.current.encode(message)) socket.current.send(frame); }
      catch (error) { setError((error as Error).message); }
    }
  }, []);
  const position = useCallback((player: MeetingPosition, playing: boolean) => {
    send({ type: "position", player, playing, resetId:resetId.current });
  }, [send]);
  const subscribeWhistle = useCallback((listener: (event: MeetingWhistle) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  return { key, view, presence, status, error, send, position, subscribeWhistle };
}
