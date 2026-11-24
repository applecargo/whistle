import { createRoot } from "react-dom/client";
import Root from "./app/Root";
import { LanguageProvider } from "./components/whistle/Language";
import "./app/globals.css";
void document.fonts.load('400 16px "Pretendard"').catch(() => undefined).then(() => {
  createRoot(document.getElementById("root")!).render(<LanguageProvider><Root /></LanguageProvider>);
});
