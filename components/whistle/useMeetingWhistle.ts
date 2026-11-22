import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { MeetingSession } from "./ConnectedWorld";
import type { Player } from "@/lib/world";
import { createMeetingWhistle } from "@/lib/audio/meeting-whistle";

export function useMeetingWhistle(meeting: MeetingSession | undefined, playing: boolean, player: MutableRefObject<Player>, notify: (message: string) => void) {
  const state = useRef({ meeting, playing }); state.current = { meeting, playing };
  const context = useRef<AudioContext | null>(null);
  const audio = useRef<ReturnType<typeof createMeetingWhistle> | null>(null);
  const last = useRef(-Infinity);
  const connected = !!meeting && meeting.status === "online" && meeting.presence.canWhistle;
  const start = useCallback(() => {
    try {
      context.current ??= new AudioContext();
      audio.current ??= createMeetingWhistle(context.current, () => player.current);
      void context.current.resume().catch(() => notify("휘슬 소리를 켤 수 없습니다. 다시 눌러주세요."));
    } catch { notify("휘슬 소리를 켤 수 없습니다."); }
  }, [player, notify]);
  useEffect(() => meeting?.subscribeWhistle(event => {
    const current = state.current;
    if (!current.playing || current.meeting?.status !== "online" || document.hidden) return;
    audio.current?.play(() => event.from === current.meeting?.view.id ? player.current :
      state.current.meeting?.presence.peers.find(p => p.id === event.from)?.player ?? event);
  }), [meeting?.subscribeWhistle, player]);
  useEffect(() => {
    if (!playing || !connected) { audio.current?.stop(); return; }
    let frame: number;
    const update = () => { audio.current?.update(); frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update);
    const hide = () => { if (document.hidden) audio.current?.stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", hide); audio.current?.stop(); };
  }, [playing, connected]);
  useEffect(() => () => { audio.current?.stop(); void context.current?.close(); audio.current = null; context.current = null; }, []);
  const blow = () => {
    if (!playing || !connected || performance.now() - last.current < 400) return;
    last.current = performance.now(); start();
    meeting!.position({ ...player.current, grounded: !!player.current.grounded }, true);
    meeting!.send({ type: "whistle" });
  };
  return { start, blow, enabled: playing && connected };
}
