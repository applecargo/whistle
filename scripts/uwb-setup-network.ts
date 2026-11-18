import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { routerNetworkConfig } from "./uwb/network-config.ts";

const { values } = parseArgs({ options: {
  "router-config": { type: "string", default: "config/uwb-router.local.json" },
  replace: { type: "boolean" },
} });
const header = "firmware/uwb-anchor/network.local.h", config = "config/uwb-survey.local.json";
const existing = existsSync(config) || existsSync(header);
if (existing && !values.replace) throw new Error("기존 설정이 있습니다. 네 보드 재설치를 준비한 뒤 --replace로 교체하세요.");
if (!existsSync(values["router-config"])) throw new Error(`${values["router-config"]}에 공유기 ssid와 password를 입력하세요.`);
const previous = existsSync(config) ? JSON.parse(readFileSync(config, "utf8")) : undefined;
const next = routerNetworkConfig(JSON.parse(readFileSync(values["router-config"], "utf8")), previous?.key);
if (existing) {
  const backup = `output/uwb/network-backup-${Date.now()}`;
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const [source, name] of [[config, "uwb-survey.local.json"], [header, "network.local.h"]])
    if (existsSync(source)) writeFileSync(`${backup}/${name}`, readFileSync(source), { mode: 0o600 });
  console.log(`이전 설정 백업: ${backup}`);
}
mkdirSync("config", { recursive: true });
writeFileSync(header, next.header, { mode: 0o600 });
writeFileSync(config, JSON.stringify(next.config, null, 2) + "\n", { mode: 0o600 });
for (const file of [header, config, values["router-config"]]) chmodSync(file, 0o600);
console.log(`공유기 접속 설정 생성: ${config}\n네 보드에 같은 펌웨어를 설치하세요. Mac은 기존 Wi-Fi를 유지합니다.`);
