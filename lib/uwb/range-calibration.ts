import type { Range, RangeMessage } from "./protocol.ts";
import { distanceTo, type BridgeConfig } from "./solver.ts";

export type RangeCorrection = { anchorId: string; offset: number; median: number; reference: number; spread: number; samples: number };

export function calibrateAtCentre(frames: RangeMessage[], config: BridgeConfig): RangeCorrection[] {
  if (!frames.length || new Set(frames.map((f) => f.tagId)).size !== 1) throw new Error("한 태그의 거리 수신이 필요합니다.");
  const centre = { x: (Math.min(...config.anchors.map((a) => a.x)) + Math.max(...config.anchors.map((a) => a.x))) / 2,
    z: (Math.min(...config.anchors.map((a) => a.z)) + Math.max(...config.anchors.map((a) => a.z))) / 2,
    boardHeight: config.fixedHeight };
  return config.anchors.map((anchor) => {
    const values = frames.flatMap((f) => f.ranges.filter((r) => r.anchorId === anchor.id).map((r) => r.distance)).sort((a, b) => a - b);
    if (values.length < 20 || values.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error(`앵커 ${anchor.id}의 유효 표본이 부족합니다.`);
    const median = (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
    const spread = values[Math.floor((values.length - 1) * .9)] - values[Math.floor((values.length - 1) * .1)];
    if (spread > .3) throw new Error(`앵커 ${anchor.id}의 거리 변동이 큽니다. 태그를 고정하고 다시 시도하세요.`);
    const reference = distanceTo(centre, anchor), offset = median - reference;
    if (Math.abs(offset) > 2) throw new Error(`앵커 ${anchor.id}의 오차가 2m를 넘습니다. 배치와 단위를 확인하세요.`);
    return { anchorId: anchor.id, offset, median, reference, spread, samples: values.length };
  });
}

export function correctRanges(ranges: Range[], corrections: RangeCorrection[]): Range[] {
  return ranges.map((range) => {
    const correction = corrections.find((c) => c.anchorId === range.anchorId);
    if (!correction) throw new Error(`앵커 ${range.anchorId}의 보정값이 없습니다.`);
    const distance = range.distance - correction.offset;
    if (!Number.isFinite(distance) || distance <= 0) throw new Error(`앵커 ${range.anchorId}의 보정 거리가 0 이하입니다. 보정을 다시 확인하세요.`);
    return { ...range, distance };
  });
}
