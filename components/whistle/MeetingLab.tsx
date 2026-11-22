import Home from "@/app/page";
import { useMeetingRoom } from "./useMeetingRoom";
import { SceneLoading } from "./Language";
import type { MeetingView } from "@/lib/meeting";
import "./meeting.css";

export type MeetingSession = ReturnType<typeof useMeetingRoom> & { view: MeetingView };
export default function MeetingLab() {
  const key = new URLSearchParams(location.search).get("meeting")?.slice(0,100) || "local";
  const room = useMeetingRoom(key);
  if (!room.view) return room.error ? <div role="alert">{room.error}</div> : <SceneLoading />;
  return <Home key={room.view.id} meeting={room as MeetingSession} />;
}
