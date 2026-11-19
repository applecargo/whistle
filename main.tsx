import { createRoot } from "react-dom/client";
import Home from "./app/page";
import { LanguageProvider } from "./components/whistle/Language";
import "./app/globals.css";

const root = createRoot(document.getElementById("root")!);
if (new URLSearchParams(location.search).has("zine")) {
  void import("./components/zine/ZineStudio").then(
    ({ default: ZineStudio }) => {
      root.render(
        <LanguageProvider>
          <ZineStudio />
        </LanguageProvider>,
      );
    },
  );
} else {
  root.render(
    <LanguageProvider>
      <Home />
    </LanguageProvider>,
  );
}
