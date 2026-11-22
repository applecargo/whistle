import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { portalRelayPlugin } from "./scripts/portals/vite";
export default defineConfig({
  base: "/whistle/",
  plugins: [react(), portalRelayPlugin()],
  server: { watch: { ignored: ["**/output/**", "**/.whistle-data/**"] } },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        audioLab: fileURLToPath(new URL("./audio-lab/index.html", import.meta.url)),
        uwbLab: fileURLToPath(new URL("./uwb-lab/index.html", import.meta.url)),
      },
    },
  },
});
