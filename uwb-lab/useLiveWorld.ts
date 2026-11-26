import { useCallback, useEffect, useRef, useState } from "react";
import { validateWorld, type World } from "../lib/world";
import { upgradeTerrain } from "../lib/terrain";
import { LIVE_WORLD_CHANNEL } from "../lib/live-world";

import { browserWorldStore } from "../lib/browser-world";
import { MAX_LIBRARY_SIZE } from "../lib/content-limits";

type Status = "off" | "saved" | "waiting" | "connected" | "disconnected" | "unavailable";

export function useLiveWorld(receive: (world: World) => void, initiallyActive = false) {
  const [active, setActive] = useState(initiallyActive);
  const [status, setStatus] = useState<Status>("off");
  const [error, setError] = useState("");
  const receiveRef = useRef(receive);
  receiveRef.current = receive;

  const disconnect = useCallback(() => {
    setActive(false);
    setStatus("off");
    setError("");
  }, []);
  const connect = useCallback(() => setActive(true), []);

  useEffect(() => {
    if (!active) return;
    let source: string | null = null;
    let lastSeen = performance.now();
    let readVersion = 0;
    const loadSaved = async () => {
      const version = ++readVersion;
      try {
        const stored = await browserWorldStore("uwb", "uwb-listener").read();
        if (version !== readVersion) return;
        if (!stored) {
          setStatus("waiting");
        } else {
          receiveRef.current(upgradeTerrain(validateWorld(stored, MAX_LIBRARY_SIZE)));
          setStatus("saved");
        }
        setError("");
      } catch {
        if (version !== readVersion) return;
        setStatus("unavailable");
        setError("작업을 불러올 수 없습니다.");
      }
    };
    loadSaved();
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(LIVE_WORLD_CHANNEL);
    if (channel) channel.onmessage = ({ data }) => {
      if (typeof data?.source !== "string") return;
      if (data.type === "world" || data.type === "unavailable" || data.type === "closed") readVersion++;
      if (data.type === "world") {
        try {
          const world = validateWorld(data.world, MAX_LIBRARY_SIZE);
          receiveRef.current(world);
          source = data.source;
          lastSeen = performance.now();
          setStatus("connected");
          setError("");
        } catch {
          if (!source || source === data.source) {
            setStatus("unavailable");
            setError("작업 데이터가 올바르지 않습니다.");
          }
        }
      } else if (!source || source === data.source) {
        if (data.type === "alive") {
          lastSeen = performance.now();
        } else if (data.type === "unavailable") {
          setStatus("unavailable");
        } else if (data.type === "closed" && source === data.source) {
          source = null;
          setStatus("disconnected");
        }
      }
    };
    const request = () => {
      if (source && performance.now() - lastSeen > 5000) {
        source = null;
        setStatus("disconnected");
      }
      channel?.postMessage(source ? { type: "ping", target: source } : { type: "request" });
    };
    request();
    const timer = setInterval(request, 1000);
    const visible = () => {
      if (!document.hidden) channel?.postMessage({ type: "request" });
    };
    const saved = (event: StorageEvent) => {
      if (!source && (event.key === "whistle.world.v2" || event.key === null)) loadSaved();
    };
    window.addEventListener("storage", saved);
    document.addEventListener("visibilitychange", visible);
    return () => {
      readVersion++;
      clearInterval(timer);
      window.removeEventListener("storage", saved);
      document.removeEventListener("visibilitychange", visible);
      channel?.close();
    };
  }, [active]);

  return { active, status, error, connect, disconnect };
}
