import type { Plugin } from "vite";
import { attachPortalRelay } from "./relay.ts";
import { attachMeetingRelay } from "../meeting/relay.ts";

export function portalRelayPlugin(): Plugin {
  const relays = new Set<ReturnType<typeof attachPortalRelay>>();
  return {
    name: "whistle-portals",
    configureServer(server) { if (server.httpServer) {
      relays.add(attachPortalRelay(server.httpServer)); relays.add(attachMeetingRelay(server.httpServer));
    } },
    configurePreviewServer(server) {
      relays.add(attachPortalRelay(server.httpServer)); relays.add(attachMeetingRelay(server.httpServer));
    },
    closeBundle() { for (const relay of relays) relay.close(); relays.clear(); },
  };
}
