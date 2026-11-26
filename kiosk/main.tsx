// 키오스크: UWB 다중 플레이어 전시의 맵 편집 PC(components/whistle/Kiosk.tsx, docs/uwb-multiplayer.md)
import { createRoot } from "react-dom/client";
import ConnectedWorld from "../components/whistle/ConnectedWorld";
import { LanguageProvider } from "../components/whistle/Language";
import "../app/globals.css";
import KioskOverview from "./KioskOverview";

const channel = new URLSearchParams(location.search).get("channel");
if (channel === "editor" || channel === "scene") {
  document.title = channel === "editor" ? "Whistle Kiosk - Editor" : "Whistle Kiosk - 3D";
}
void document.fonts.load('400 16px "Pretendard"').catch(() => undefined).then(() => {
  createRoot(document.getElementById("root")!).render(<LanguageProvider>{channel === "scene" ? <KioskOverview /> : <ConnectedWorld kiosk exhibitionEditor={channel === "editor"} />}</LanguageProvider>);
});
