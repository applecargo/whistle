import { useEffect, useRef, useState } from "react";

const RETRY_MS = 2000;
export type Link = "off" | "connecting" | "connected" | "disconnected" | "invalid";

/** 끊기면 RETRY_MS마다 다시 붙는 웹소켓. url: undefined = 끔, null = 주소 오류 */
export function useSocket(url: URL | null | undefined, onOpen: (ws: WebSocket) => void, onMessage?: (data: unknown) => void) {
  const [state, setState] = useState<Link>("off");
  const handlers = useRef({ onOpen, onMessage });
  handlers.current = { onOpen, onMessage };
  const socket = useRef<WebSocket | null>(null);
  const address = url?.href, invalid = url === null;
  useEffect(() => {
    if (!address) { setState(invalid ? "invalid" : "off"); return; }
    let stopped = false, retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      setState("connecting");
      const ws = new WebSocket(address);
      socket.current = ws;
      ws.onopen = () => { if (!stopped) { setState("connected"); handlers.current.onOpen(ws); } };
      ws.onmessage = (event) => { if (!stopped) handlers.current.onMessage?.(event.data); };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (stopped) return;
        socket.current = null;
        setState("disconnected");
        retry = setTimeout(connect, RETRY_MS);
      };
    };
    connect();
    return () => { stopped = true; clearTimeout(retry); socket.current?.close(); socket.current = null; };
  }, [address, invalid]);
  return { state, socket };
}
