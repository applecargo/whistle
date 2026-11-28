import { lazy, Suspense, type ComponentProps } from "react";
import { SceneLoading } from "./Language";

const Scene = lazy(() => import("./Scene"));

export type EditorPreviewState = Pick<ComponentProps<typeof Scene>, "world" | "simulation" | "derivation" | "feedback" | "meeting">;

export function EditorPreview(props: EditorPreviewState & { exhibition?: boolean }) {
  return <Suspense fallback={<SceneLoading />}><Scene {...props} mode="overview" /></Suspense>;
}
