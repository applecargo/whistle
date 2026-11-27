import { useEffect, useRef, useState } from "react";
import type { EditorPreviewState } from "../components/whistle/EditorPreview";

export const PREVIEW_CHANNEL = "whistle.kiosk.editor-preview.v1";
type Message = { type: "request" } | { type: "preview"; state: EditorPreviewState | null };

export function usePublishEditorPreview(state: EditorPreviewState | null) {
  const current = useRef(state);
  const channel = useRef<BroadcastChannel | null>(null);
  current.current = state;
  const enabled = state !== null;
  useEffect(() => {
    if (!enabled || typeof BroadcastChannel === "undefined") return;
    const connection = new BroadcastChannel(PREVIEW_CHANNEL);
    channel.current = connection;
    const reply = () => connection.postMessage({ type: "preview", state: current.current } satisfies Message);
    const leave = () => connection.postMessage({ type: "preview", state: null } satisfies Message);
    connection.onmessage = ({ data }: MessageEvent<Message>) => { if (data.type === "request") reply(); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", reply);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", reply);
      leave();
      connection.close();
      channel.current = null;
    };
  }, [enabled]);
  useEffect(() => {
    channel.current?.postMessage({ type: "preview", state } satisfies Message);
  }, [state]);
}

export function useEditorPreview() {
  const [preview, setPreview] = useState<EditorPreviewState | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(PREVIEW_CHANNEL);
    channel.onmessage = ({ data }: MessageEvent<Message>) => {
      if (data.type === "preview") setPreview(data.state);
    };
    const request = () => channel.postMessage({ type: "request" } satisfies Message);
    request();
    window.addEventListener("pageshow", request);
    return () => { window.removeEventListener("pageshow", request); channel.close(); };
  }, []);
  return preview;
}
