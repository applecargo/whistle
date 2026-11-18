export type SurveyReading = { from: number; to: number; samples: number; median: number; p10: number; p90: number };
export type SurveyAnchor = { id: string; x: number; z: number };

const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

function linear(a: number[][], b: number[]) {
  const rows = a.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < b.length; i++) {
    let pivot = i;
    for (let j = i + 1; j < b.length; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    if (Math.abs(rows[i][i]) < 1e-10) throw new Error("앵커 배치가 일직선에 가깝습니다.");
    const divisor = rows[i][i];
    rows[i] = rows[i].map(v => v / divisor);
    for (let j = 0; j < b.length; j++) if (j !== i) {
      const factor = rows[j][i];
      rows[j] = rows[j].map((v, k) => v - factor * rows[i][k]);
    }
  }
  return rows.map(r => r[b.length]);
}

export function calculateAnchorLayout(readings: SurveyReading[]) {
  if (readings.length !== 12) throw new Error("네 앵커의 양방향 측정 12개가 필요합니다.");
  const seen = new Set<string>();
  for (const r of readings) {
    const key = `${r.from}-${r.to}`;
    if (![r.from, r.to].every(v => Number.isInteger(v) && v >= 0 && v <= 3) || r.from === r.to || seen.has(key)
      || !Number.isInteger(r.samples) || r.samples < 100
      || ![r.median, r.p10, r.p90].every(v => Number.isFinite(v) && v > 0 && v <= 500)
      || r.p10 > r.median || r.median > r.p90) throw new Error("앵커 거리 보고 형식 또는 표본 수 오류");
    if (r.p90 - r.p10 > .3) throw new Error(`A${r.from}→A${r.to} 거리 변동이 30cm를 넘습니다. 다시 측정하세요.`);
    seen.add(key);
  }
  const distances = pairs.map(([a, b]) => {
    const forward = readings.find(r => r.from === a && r.to === b)!;
    const reverse = readings.find(r => r.from === b && r.to === a)!;
    if (Math.abs(forward.median - reverse.median) > .25) throw new Error(`A${a}–A${b} 양방향 거리 차이가 25cm를 넘습니다. 배치 고정과 거리 보정을 확인하세요.`);
    return (forward.median + reverse.median) / 2;
  });
  const [d01, d02, d03, d12, d13, d23] = distances;
  const x2 = (d01 ** 2 + d02 ** 2 - d12 ** 2) / (2 * d01);
  const x3 = (d01 ** 2 + d03 ** 2 - d13 ** 2) / (2 * d01);
  const z2 = Math.sqrt(Math.max(0, d02 ** 2 - x2 ** 2));
  const z3 = Math.sqrt(Math.max(0, d03 ** 2 - x3 ** 2));
  if (Math.min(z2, z3) < .05) throw new Error("배치가 일직선에 가깝거나 거리로 삼각형을 만들 수 없습니다.");
  const sameSide = Math.abs(Math.hypot(x2 - x3, z2 - z3) - d23) <= Math.abs(Math.hypot(x2 - x3, z2 + z3) - d23);
  let v = [d01, x2, z2, x3, sameSide ? z3 : -z3];
  const points = (p: number[]) => [[0, 0], [p[0], 0], [p[1], p[2]], [p[3], p[4]]];
  const residuals = (p: number[]) => {
    const xy = points(p);
    return pairs.map(([a, b], i) => Math.hypot(xy[a][0] - xy[b][0], xy[a][1] - xy[b][1]) - distances[i]);
  };
  const cost = (p: number[]) => residuals(p).reduce((s, r) => s + r * r, 0);
  for (let step = 0; step < 30; step++) {
    const r = residuals(v);
    const columns = v.map((_, j) => { const moved = [...v]; moved[j] += 1e-5; return residuals(moved).map((x, i) => (x - r[i]) / 1e-5); });
    const delta = linear(columns.map(a => columns.map(b => a.reduce((s, x, i) => s + x * b[i], 0))), columns.map(a => -a.reduce((s, x, i) => s + x * r[i], 0)));
    let accepted = false;
    for (let scale = 1; scale >= 1 / 128; scale /= 2) {
      const candidate = v.map((x, i) => x + scale * delta[i]);
      if (candidate[0] > .05 && candidate[2] > .05 && cost(candidate) < cost(v)) { v = candidate; accepted = true; break; }
    }
    if (!accepted || Math.hypot(...delta) < 1e-7) break;
  }
  const errors = residuals(v);
  const rms = Math.sqrt(cost(v) / 6);
  if (!Number.isFinite(rms) || rms > .15 || Math.max(...errors.map(Math.abs)) > .25) throw new Error("거리들이 하나의 평면 배치와 일치하지 않습니다. 보드 위치·높이·거리 오차를 확인하세요.");
  const anchors: SurveyAnchor[] = points(v).map(([x, z], i) => ({ id: String(i), x, z }));
  return { anchors, rms, pairs: pairs.map(([a, b], i) => ({ a, b, distance: distances[i], residual: errors[i] })),
    coordinateSystem: "A0=(0,0), A0→A1=+X, A2=+Z 쪽. 동일 높이의 상대 좌표이며 절대 높이·전시장 방향은 측정하지 않음." };
}
