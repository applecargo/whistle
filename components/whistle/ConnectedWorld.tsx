import Home from "@/app/page";
import { useMeetingRoom } from "./useMeetingRoom";
import "./meeting.css";

export type MeetingSession = ReturnType<typeof useMeetingRoom>;
/** kiosk: UWB 다중 플레이어 전시의 키오스크(kiosk/index.html). 만들기만 하고(플레이 없음), 혼자 쓰는 세계로 시작한다 */
export default function ConnectedWorld({ kiosk = false, exhibitionEditor = false }: { kiosk?: boolean; exhibitionEditor?: boolean }) {
  const key = new URLSearchParams(location.search).get("meeting")?.slice(0,100) || (kiosk ? "kiosk" : "local");
  const room = useMeetingRoom(key, !kiosk);
  return <Home meeting={room} kiosk={kiosk} exhibitionEditor={exhibitionEditor} />;
}
