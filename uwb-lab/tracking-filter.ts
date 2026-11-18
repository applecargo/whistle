import type { PositionMessage } from '../lib/uwb/protocol';

export const INVALID_HOLD_MS = 120;

export function createTrackingFilter(radius = 0.10) {
  let published: PositionMessage | null = null;
  let departedAt: number | null = null;
  let publishedAt = -Infinity;

  return {
    reset() {
      published = null;
      departedAt = null;
      publishedAt = -Infinity;
    },
    update(point: PositionMessage, now: number): PositionMessage | null {
      if (published) {
        const distance = Math.hypot(point.x - published.x, point.z - published.z);
        if (distance <= radius) departedAt = null;
        else departedAt ??= now;
        const moving = distance >= 3 * radius || (departedAt !== null && now - departedAt >= 60);
        if (now - publishedAt < 50) return null;
        if (!moving) {
          if (point.boardHeight === published.boardHeight) return null;
          point = { ...point, x: published.x, z: published.z };
        }
      }
      published = point;
      publishedAt = now;
      return point;
    },
  };
}
