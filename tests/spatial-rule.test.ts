import assert from "node:assert/strict";
import { test } from "node:test";
import { curveValue, ruleGain, ruleWidth, parseRule, DEFAULT_DB, LINEAR, type SpatialRule } from "../lib/audio/spatial-rule.ts";
import { terrainRegions, nearbyRegions, DEFAULT_NEARBY, KIND_PATCHES } from "../lib/audio/terrain-sources.ts";
import { flatTerrain } from "../lib/terrain.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const dB = (v: number) => 20 * Math.log10(v);

test("곡선: 0에서 0, 1에서 1. lin = x, pow n = xⁿ", () => {
  for (const curve of [LINEAR, { type: "pow", n: 2 }, { type: "exp", db: DEFAULT_DB }, { type: "log", db: DEFAULT_DB }] as const) {
    close(curveValue(curve, 0), 0);
    close(curveValue(curve, 1), 1);
  }
  close(curveValue(LINEAR, 0.3), 0.3);
  close(curveValue({ type: "pow", n: 4 }, 0.5), 0.0625);
});

test("exp: dB 폭만큼 아래에서 dB가 직선으로 오르는 곡선을 0에서 시작하게 고친 것. log는 그 거울", () => {
  const exp = { type: "exp", db: DEFAULT_DB } as const;
  const pure = (x: number) => 10 ** (DEFAULT_DB * (x - 1) / 20);
  for (const x of [0.25, 0.5, 0.75]) close(curveValue(exp, x), (pure(x) - pure(0)) / (1 - pure(0)));
  // 가까운 쪽은 거의 dB 직선(1타일당 같은 dB)
  close(dB(curveValue(exp, 0.75)), -DEFAULT_DB / 4, 0.3);
  // 천천히 올라가다 가까이서 커진다: 선형보다 늘 작다
  for (const x of [0.1, 0.5, 0.9]) assert.ok(curveValue(exp, x) < x);
  const log = { type: "log", db: DEFAULT_DB } as const;
  for (const x of [0.1, 0.5, 0.9]) close(curveValue(log, x), 1 - curveValue(exp, 1 - x));
});

test("음량·width: range에서 0·시작값, 닿으면 1", () => {
  const rule: SpatialRule = { range: 4, width: 0.3, curve: LINEAR };
  close(ruleGain(rule, 4), 0); close(ruleGain(rule, 6), 0); close(ruleGain(rule, 2), 0.5); close(ruleGain(rule, 0), 1);
  close(ruleWidth(rule, 4), 0.3); close(ruleWidth(rule, 2), 0.65); close(ruleWidth(rule, 0), 1);
});

test("Pd 낱말 읽기: 빠진 것은 그대로, 숫자 없는 exp는 기본 dB", () => {
  assert.deepEqual(parseRule(["range", 4, "curve", "exp"]), { range: 4, curve: { type: "exp", db: DEFAULT_DB } });
  assert.deepEqual(parseRule(["curve", "exp", 60, "width", 0.3]), { width: 0.3, curve: { type: "exp", db: 60 } });
  assert.deepEqual(parseRule(["curve", "pow", 3]), { curve: { type: "pow", n: 3 } });
  assert.deepEqual(parseRule(["curve", "lin", "range", 2]), { range: 2, curve: LINEAR });
  assert.deepEqual(parseRule(["width", 2, "range", "x", "nope"]), { width: 1 });
});

test("영역: 기본 규칙은 예전 그대로(radius에서 0 선형, width는 blend부터). 패치가 바꾼 규칙은 그 패치의 영역에만", () => {
  const regions = terrainRegions({ size: 12, tiles: flatTerrain(12).tiles });
  const patch = KIND_PATCHES.plain;
  // 평지 섬 하나(맵 전체). 맵 밖에서 다가간다
  const at = (x: number, rules?: Map<string, Partial<SpatialRule>>) => nearbyRegions({ x, z: 5 }, regions, new Set(), DEFAULT_NEARBY, rules)[0];
  const d = 1; // 외곽(x = -0.5)까지 1타일
  close(at(-0.5 - d).gain, Math.max(0, 1 - d / DEFAULT_NEARBY.radius));
  close(at(-0.5 - d).width, Math.max(0, 1 - d / DEFAULT_NEARBY.blend));
  const rules = new Map([[patch, { range: 4, curve: { type: "exp", db: DEFAULT_DB } } as Partial<SpatialRule>]]);
  const far = at(-0.5 - 3, rules);
  assert.ok(far, "range를 넓히면 더 멀리서부터 켠다");
  close(far.gain, curveValue({ type: "exp", db: DEFAULT_DB }, 1 - 3 / 4));
  close(far.width, 1 - 3 / 4, 1e-9);
  assert.equal(at(-0.5 - 3), undefined, "다른 규칙이 없으면 기본 radius 밖");
});
