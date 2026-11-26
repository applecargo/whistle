// 키오스크: UWB 다중 플레이어 전시의 맵 편집 PC(components/whistle/Kiosk.tsx, docs/uwb-multiplayer.md)
import { createRoot } from "react-dom/client";
import ConnectedWorld from "../components/whistle/ConnectedWorld";
import { LanguageProvider } from "../components/whistle/Language";
import "../app/globals.css";
void document.fonts.load('400 16px "Pretendard"').catch(() => undefined).then(() => {
  createRoot(document.getElementById("root")!).render(<LanguageProvider><ConnectedWorld kiosk /></LanguageProvider>);
});
