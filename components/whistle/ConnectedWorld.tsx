import Home from "@/app/page";
import { useMeetingRoom } from "./useMeetingRoom";
import "./meeting.css";

export type MeetingSession = ReturnType<typeof useMeetingRoom>;
export default function ConnectedWorld() {
  const key = new URLSearchParams(location.search).get("meeting")?.slice(0,100) || "local";
  const room = useMeetingRoom(key);
  return <Home meeting={room} />;
}
