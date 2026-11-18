import { readFileSync, writeFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { host: { type: "string" } } });
if (!values.host || !isIPv4(values.host)) throw new Error("--host에 Mac의 공유기 IPv4 주소를 입력하세요.");
const { ssid, password } = JSON.parse(readFileSync("config/uwb-router.local.json", "utf8"));
if (typeof ssid !== "string" || !ssid || typeof password !== "string" || !password)
  throw new Error("공유기 접속 설정을 확인하세요.");
const header = [
  "#pragma once",
  "#define WHISTLE_WIFI_SSID " + JSON.stringify(ssid),
  "#define WHISTLE_WIFI_PASSWORD " + JSON.stringify(password),
  "#define WHISTLE_RECEIVER_IP " + JSON.stringify(values.host),
].join("\n");
writeFileSync("firmware/uwb-tag/network.local.h", header + "\n", { mode: 0o600 });
console.log("T0 UDP → " + values.host + ":5195");
