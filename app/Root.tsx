import { lazy, Suspense } from "react";
import Home from "./page";
const MeetingLab = lazy(() => import("@/components/whistle/MeetingLab"));

export default function Root() {
  return new URLSearchParams(location.search).has("meeting")
    ? <Suspense fallback={null}><MeetingLab /></Suspense>
    : <Home />;
}
