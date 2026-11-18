import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkAnchorNetwork, runAnchorSurvey, httpSurveyTransport, simulatedSurveyTransport, type SurveyNode } from "./uwb/survey.ts";
import type { SurveyReading } from "../lib/uwb/anchor-survey.ts";

const { values } = parseArgs({ options: { simulate: { type: "boolean" }, check: { type: "boolean" }, config: { type: "string", default: "config/uwb-survey.local.json" }, "fixed-layout": { type: "boolean" } } });
mkdirSync("output/uwb", { recursive: true });
const file = `output/uwb/${values.check ? "network-check" : "survey"}-${Date.now()}${values.simulate ? "-simulated" : ""}.json`;
let readings: SurveyReading[] = [];
try {
  if (!values.check && !values.simulate && !values["fixed-layout"]) throw new Error("네 앵커를 같은 높이·고정 위치에 두고 T0 전원을 끈 뒤 --fixed-layout으로 실행하세요.");
  const config = values.simulate ? { nodes: [0, 1, 2, 3].map(id => ({ id, url: `http://simulated-${id}` })), key: "" }
    : JSON.parse(readFileSync(values.config, "utf8")) as { nodes: SurveyNode[]; key: string };
  if (!values.simulate && (typeof config.key !== "string" || config.key.length < 16)) throw new Error("무선 측정 설정 키가 없습니다. npm run uwb:setup-network를 실행하세요.");
  const request = values.simulate ? simulatedSurveyTransport() : httpSurveyTransport(config.key);
  if (values.check) {
    const statuses = await checkAnchorNetwork(config.nodes, request);
    writeFileSync(file, JSON.stringify({ simulated: !!values.simulate, complete: true, statuses }, null, 2));
    console.table(statuses.map(s => ({ id: s.id, state: s.state, cfg: s.cfg, pan: s.pan })));
    console.log(`네 앵커 연결·설정 확인 완료. 측정은 시작하지 않았습니다.\n${file}`);
  } else {
  const report = await runAnchorSurvey(config.nodes, request, console.log, current => {
    readings = current; writeFileSync(file, JSON.stringify({ simulated: !!values.simulate, complete: false, readings }, null, 2));
  });
  writeFileSync(file, JSON.stringify({ simulated: !!values.simulate, complete: true, ...report }, null, 2));
  console.table(report.anchors); console.log(`거리 일치 RMS: ${report.rms.toFixed(3)}m\n${file}\n${report.coordinateSystem}`);
  }
} catch (error) {
  writeFileSync(file, JSON.stringify({ simulated: !!values.simulate, complete: false, readings, error: (error as Error).message }, null, 2));
  console.error(`${(error as Error).message}\n기록: ${file}`); process.exitCode = 1;
}
