// 공간화 규칙: 소스(영역·배치한 소리·이벤트 소리)마다 거리 → 음량·width를 정한다.
//
//   x = 1 − 거리/range   (range 밖 0, 경계·소리에 닿으면 1)
//   음량 = curve(x)      lin: x · pow n: xⁿ · exp: 천천히 올라가다 가까이서 훅 · log: 빨리 올라가고 가까이서 천천히
//   width = width + (1 − width) · x   (range에서 시작값, 닿으면 1 = 방향 없이 좌우 모두)
//
// exp/log의 숫자는 dB 폭(기본 40). exp는 dB가 거리에 따라 직선으로 오르는 곡선을 0에서 시작하게 고친 것:
//   exp(x) = (e^(k·x) − 1) / (e^k − 1),  k = dB · ln10 / 20      log(x) = 1 − exp(1 − x)
// Pd에서는 낱말로 쓴다: "range 4 width 0.3 curve exp" (빠진 것은 그대로 둔다).

export type Curve = { type: "lin" } | { type: "pow"; n: number } | { type: "exp"; db: number } | { type: "log"; db: number };
export type SpatialRule = {
  /** 들리기 시작하는 거리(타일). 여기서 음량 0 */
  range: number;
  /** range에서의 width(0 = 방향, 1 = 좌우 모두). 닿으면 1 */
  width: number;
  curve: Curve;
};
/** exp·log의 기본 dB 폭: range 끝에서 −40dB(들릴 듯 말 듯)부터 */
export const DEFAULT_DB = 40;
export const LINEAR: Curve = { type: "lin" };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const expCurve = (x: number, db: number) => {
  const k = db * Math.LN10 / 20;
  return k < 1e-6 ? x : Math.expm1(k * x) / Math.expm1(k);
};

/** x(0~1) → 음량(0~1) */
export function curveValue(curve: Curve, x: number) {
  x = clamp01(x);
  switch (curve.type) {
    case "pow": return x ** curve.n;
    case "exp": return expCurve(x, curve.db);
    case "log": return 1 - expCurve(1 - x, curve.db);
    default: return x;
  }
}

/** 0(range 밖)~1(닿음). range가 0 이하면 닿았을 때만 1 */
const closeness = (range: number, distance: number) => range > 0 ? clamp01(1 - distance / range) : distance > 0 ? 0 : 1;

export const ruleGain = (rule: SpatialRule, distance: number) => curveValue(rule.curve, closeness(rule.range, distance));
/** blend: width가 커지기 시작하는 거리(기본 range) */
export const ruleWidth = (rule: SpatialRule, distance: number, blend = rule.range) =>
  rule.width + (1 - rule.width) * closeness(blend, distance);

/**
 * Pd 낱말을 규칙 조각으로: "range 4", "width 0.3", "curve exp [dB]" / "curve log [dB]" / "curve pow n" / "curve lin".
 * 모르는 낱말이나 잘못된 숫자는 건너뛴다(그 뒤는 계속 읽는다). 읽은 것만 돌려준다.
 */
export function parseRule(words: readonly (string | number)[]): Partial<SpatialRule> {
  const rule: Partial<SpatialRule> = {};
  const number = (i: number) => typeof words[i] === "number" && Number.isFinite(words[i]) ? words[i] as number : undefined;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === "range" && number(i + 1) !== undefined) rule.range = Math.max(0, number(++i)!);
    else if (word === "width" && number(i + 1) !== undefined) rule.width = clamp01(number(++i)!);
    else if (word === "curve") {
      const type = words[i + 1];
      if (type === "lin") { rule.curve = LINEAR; i++; }
      else if (type === "pow") { i++; rule.curve = { type: "pow", n: Math.max(0, number(i + 1) ?? 2) }; if (number(i + 1) !== undefined) i++; }
      else if (type === "exp" || type === "log") { i++; rule.curve = { type, db: Math.max(0, number(i + 1) ?? DEFAULT_DB) }; if (number(i + 1) !== undefined) i++; }
    }
  }
  return rule;
}

/** 디버그 표시용: "exp", "pow 2" … */
export const describeCurve = (curve: Curve) =>
  curve.type === "pow" ? `pow ${curve.n}` : curve.type === "lin" || curve.db === DEFAULT_DB ? curve.type : `${curve.type} ${curve.db}`;
