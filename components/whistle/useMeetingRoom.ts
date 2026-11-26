import { useCallback, useEffect, useRef, useState } from "react";
import { localMeetingView, type MeetingMessage, type MeetingPresence, type MeetingPosition, type MeetingWhistle } from "@/lib/meeting";
import { createMeetingCodec } from "@/lib/meeting-wire";
import type { World } from "@/lib/world";
import { meetingSocketURL } from "@/lib/meeting-client";

const createId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,"0")).join("");
function identity(key:string, fresh=false) {
  const storageKey=`whistle.meeting.${key}.id`;
  let id=createId(),token=createId();
  try {
    if(!fresh){id=sessionStorage.getItem(storageKey)||id;token=sessionStorage.getItem(`${storageKey}.token`)||token;}
    sessionStorage.setItem(storageKey,id);sessionStorage.setItem(`${storageKey}.token`,token);
  } catch {}
  return {id,token};
}
export function useMeetingRoom(key: string, initiallyEnabled = true) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [session,setSession]=useState(()=>identity(key));
  const [documentId]=useState(()=>{
    try {
      const id=sessionStorage.getItem("whistle.document.tab")||session.id;
      sessionStorage.setItem("whistle.document.tab",id);return id;
    } catch {return session.id;}
  });
  const [view, setView] = useState(()=>localMeetingView(session.id));
  const [presence, setPresence] = useState<MeetingPresence>({ peers: [], canWhistle: false });
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [error, setError] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const codec = useRef(createMeetingCodec());
  const resetId = useRef(0);
  const listeners = useRef(new Set<(event: MeetingWhistle) => void>());
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, delay = 1000;
    let retry: ReturnType<typeof setTimeout> | undefined, connecting: ReturnType<typeof setTimeout> | undefined;
    const {id,token}=session;
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
          delay = 1000;
          resetId.current = message.view.reset.id;
          setError("");
          setView(message.view);
        }
      };
      ws.onclose = event => {
        clearTimeout(connecting);
        if (stopped || socket.current !== ws) return;
        setStatus("offline");
        if (event.code === 4001) setError("다른 창에서 이 세계를 열었습니다.");
        if (event.code !== 1008 && event.code !== 4001 && event.code !== 4002) {
          retry = setTimeout(connect, delay);
          delay = Math.min(15_000, delay * 2);
        }
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { stopped = true; clearTimeout(retry); clearTimeout(connecting); socket.current?.close(); socket.current = null; };
  }, [key,session,enabled]);
  const send = useCallback((message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      try { for (const frame of codec.current.encode(message)) socket.current.send(frame); }
      catch (error) { setError((error as Error).message); }
    }
  }, []);
  const restart = useCallback((world:World) => {
    send({type:"leave"});
    socket.current?.close();socket.current=null;
    const next=identity(key,true);
    resetId.current=0;
    setView(localMeetingView(next.id,world));
    setPresence({peers:[],canWhistle:false});setStatus(enabled?"connecting":"offline");setError("");setSession(next);
  },[key,send,enabled]);
  const setMultiplayer = useCallback((next:boolean, world:World) => {
    if (next === enabled) return;
    if (!next) restart(world);
    setEnabled(next);
    setStatus(next ? "connecting" : "offline");
  }, [enabled,restart]);
  const position = useCallback((player: MeetingPosition, playing: boolean) => {
    send({ type: "position", player, playing, resetId:resetId.current });
  }, [send]);
  const subscribeWhistle = useCallback((listener: (event: MeetingWhistle) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  return { key, documentId, view, presence, status, error, enabled, setMultiplayer, send, restart, position, subscribeWhistle };
}
