import { parseConfig, type BridgeConfig } from "./solver.ts";

export type RectangleSetup = { width: number; depth: number; anchorHeight: number; tagHeight: number };

export function rectangleConfig(setup: RectangleSetup): BridgeConfig {
  if (!Number.isFinite(setup.width) || !Number.isFinite(setup.depth)
    || setup.width <= 0 || setup.depth <= 0 || setup.width > 1000 || setup.depth > 1000) {
    throw new Error("가로·세로는 0보다 크고 1000m 이하인 숫자여야 합니다.");
  }
  if (![setup.anchorHeight, setup.tagHeight].every((v) => Number.isFinite(v) && v >= 0 && v <= 10)) {
    throw new Error("앵커·태그 높이는 0~10m 사이의 숫자여야 합니다.");
  }
  return parseConfig({ mode: "2d", fixedHeight: setup.tagHeight, maxResidual: 0.35, smoothingMs: 120,
    tags: ["0", "1", "2", "3"], anchors: [
      { id: "0", x: 0, z: 0, boardHeight: setup.anchorHeight },
      { id: "1", x: setup.width, z: 0, boardHeight: setup.anchorHeight },
      { id: "2", x: setup.width, z: setup.depth, boardHeight: setup.anchorHeight },
      { id: "3", x: 0, z: setup.depth, boardHeight: setup.anchorHeight },
    ] });
}
