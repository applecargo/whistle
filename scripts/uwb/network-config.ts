import { randomBytes } from "node:crypto";

export function routerCredentials(input: unknown) {
  const { ssid, password } = (input ?? {}) as { ssid?: unknown; password?: unknown };
  if (typeof ssid !== "string" || !ssid.trim() || Buffer.byteLength(ssid) > 32 || /[\0\r\n]/.test(ssid))
    throw new Error("공유기 SSID는 1~32바이트여야 합니다.");
  if (typeof password !== "string" || (password.length > 0 && Buffer.byteLength(password) < 8) || Buffer.byteLength(password) > 63 || /[\0\r\n]/.test(password))
    throw new Error("공개 Wi-Fi는 빈 문자열을, 보안 Wi-Fi는 8~63바이트 비밀번호를 입력하세요.");
  return { ssid, password };
}

export function routerNetworkConfig(input: unknown, existingKey?: string) {
  const { ssid, password } = routerCredentials(input);
  if (existingKey !== undefined && !/^[a-f0-9]{48}$/.test(existingKey)) throw new Error("기존 제어 키 형식이 잘못됐습니다.");
  const key = existingKey ?? randomBytes(24).toString("hex");
  return {
    config: { mode: "router", ssid, key, nodes: [0, 1, 2, 3].map(id => ({ id, url: `http://whistle-a${id}.local` })) },
    header: `#pragma once\n#define WHISTLE_NETWORK_ROUTER 1\n#define WHISTLE_WIFI_SSID ${JSON.stringify(ssid)}\n#define WHISTLE_WIFI_PASSWORD ${JSON.stringify(password)}\n#define WHISTLE_CONTROL_KEY "${key}"\n`,
  };
}
