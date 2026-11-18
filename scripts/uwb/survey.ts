import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { calculateAnchorLayout, type SurveyReading } from "../../lib/uwb/anchor-survey.ts";

export type SurveyNode = { id: number; url: string };
export type SurveyTransport = (node: SurveyNode, path: string, method?: "GET" | "POST", body?: string) => Promise<unknown>;
type Status = { id: number; state: string; cfg: string; cap: string; pan: string; ant: string; rpt: string; pow: string; session: string };
function status(value: unknown, node: SurveyNode): Status {
  const s = value as Status;
  if (!s || s.id !== node.id || typeof s.cfg !== "string" || !s.cfg.startsWith(`${node.id},1,`)
    || s.state !== "idle" || ![s.cap, s.pan, s.ant, s.rpt, s.pow, s.session].every(v => typeof v === "string")) throw new Error(`A${node.id}가 원래 앵커 상태가 아닙니다.`);
  return s;
}

export async function checkAnchorNetwork(nodes: SurveyNode[], request: SurveyTransport) {
  if (nodes.length !== 4 || new Set(nodes.map(n => n.id)).size !== 4 || nodes.some(n => !Number.isInteger(n.id) || n.id < 0 || n.id > 3)
    || new Set(nodes.map(n => n.url)).size !== 4) throw new Error("A0~A3의 서로 다른 주소 네 개가 필요합니다.");
  const initial = await Promise.all(nodes.map(async n => status(await request(n, "/status"), n)));
  if (initial.some(s => s.cfg.split(",").slice(2).join(",") !== initial[0].cfg.split(",").slice(2).join(",") || s.cap !== initial[0].cap || s.pan !== initial[0].pan || s.rpt !== "1")) throw new Error("앵커의 통신 설정·PAN·거리 보고 설정이 일치하지 않습니다.");
  return initial;
}

export async function runAnchorSurvey(nodes: SurveyNode[], request: SurveyTransport, log: (message: string) => void = console.log,
  saveReadings: (readings: SurveyReading[]) => void = () => {}) {
  const initial = await checkAnchorNetwork(nodes, request);
  const readings: SurveyReading[] = [];
  for (const node of nodes) {
    const session = randomUUID();
    log(`A${node.id}: 임시 태그 측정 시작`);
    let result: { id: number; session: string; restored: boolean; error?: string; readings: SurveyReading[] } | undefined;
    let failure: unknown;
    try {
      await request(node, "/measure", "POST", session);
      result = await request(node, `/result?session=${session}`) as typeof result;
      if (!result || result.id !== node.id || result.session !== session || !result.restored || result.error || !Array.isArray(result.readings)
        || result.readings.length !== 3 || result.readings.some(r => r.from !== node.id)) throw new Error(`A${node.id} 측정 실패: ${result?.error || "결과 또는 복구 상태 오류"}`);
    } catch (error) { failure = error; }
    finally {
      try {
        const restored = status(await request(node, "/status"), node);
        const before = initial.find(s => s.id === node.id)!;
        if (["cfg", "cap", "pan", "ant", "rpt", "pow"].some(k => restored[k as keyof Status] !== before[k as keyof Status])) throw new Error(`A${node.id} 원래 설정 불일치`);
      } catch (error) { throw new Error(`A${node.id} 복구 확인 실패. 다음 보드를 전환하지 않습니다. ${(error as Error).message}`); }
    }
    if (failure) throw failure;
    readings.push(...result!.readings);
    saveReadings([...readings]);
    log(`A${node.id}: 측정 완료 · 앵커 복구 확인`);
  }
  return { measuredAt: new Date().toISOString(), readings, ...calculateAnchorLayout(readings) };
}

export function httpSurveyTransport(key: string): SurveyTransport {
  return async (node, path, method = "GET", body) => {
    const deadline = Date.now() + 180000;
    for (let attempt = 0; ; attempt++) {
      let response: Response, text: string;
      try {
        response = await fetch(new URL(path, node.url), { method, body,
          headers: { "X-Whistle-Key": key, "Content-Type": "text/plain", Connection: "close" },
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
        text = await response.text();
      } catch (error) {
        if (method !== "GET" || attempt >= 2 || Date.now() + 1000 >= deadline) throw error;
        await delay(1000);
        continue;
      }
      if (!response.ok) throw new Error(`A${node.id} HTTP ${response.status}`);
      if (text.length > 32768) throw new Error("측정 응답이 너무 큽니다.");
      return JSON.parse(text);
    }
  };
}

export function simulatedSurveyTransport(points = [[0, 0], [4, 0], [4.5, 3], [.3, 2.8]]): SurveyTransport {
  const sessions = new Map<number, string>();
  return async (node, path, method, body) => {
    if (path === "/status") return { id: node.id, state: "idle", cfg: `${node.id},1,1,0`, cap: "1,10,1", pan: "0000", ant: "16336", rpt: "1", pow: "FD", session: sessions.get(node.id) || "" };
    if (path === "/measure" && method === "POST" && body) { sessions.set(node.id, body); return { accepted: true }; }
    if (path.startsWith("/result?") && sessions.get(node.id) === new URLSearchParams(path.split("?")[1]).get("session")) return {
      id: node.id, session: sessions.get(node.id), restored: true, error: "",
      readings: points.flatMap((p, to) => {
        if (to === node.id) return [];
        const median = Math.round(Math.hypot(p[0] - points[node.id][0], p[1] - points[node.id][1]) * 100) / 100;
        return [{ from: node.id, to, samples: 1000, median, p10: median - .02, p90: median + .02 }];
      }),
    };
    throw new Error("가상 보드 요청 오류");
  };
}
