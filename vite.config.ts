import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
// pd4web 엔진은 SharedArrayBuffer(스레드)를 쓰므로 교차 출처 격리가 필요하다.
// 개발·미리보기 서버는 헤더로, GitHub Pages는 public/coi-serviceworker.js로 건다.
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
export default defineConfig({
  base: "/whistle/",
  server: { headers: isolation },
  preview: { headers: isolation },
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        audioLab: fileURLToPath(new URL("./audio-lab/index.html", import.meta.url)),
        soundscapeLab: fileURLToPath(new URL("./audio-lab/soundscape.html", import.meta.url)),
        uwbLab: fileURLToPath(new URL("./uwb-lab/index.html", import.meta.url)),
      },
    },
  },
});
