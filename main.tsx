import { createRoot } from "react-dom/client";
import Root from "./app/Root";
import { LanguageProvider } from "./components/whistle/Language";
import "./app/globals.css";
import SectorDisplay from "./components/whistle/SectorDisplay";
const display = new URLSearchParams(location.search).get("display");
void document.fonts.load('400 16px "Pretendard"').catch(() => undefined).then(() => {
  createRoot(document.getElementById("root")!).render(<LanguageProvider>{display ? <SectorDisplay display={display} /> : <Root />}</LanguageProvider>);
});
