// 패치 목록·의존 파일·해시를 위한 순수 헬퍼. build-audio.mjs와 테스트에서 함께 쓴다.
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const NAME = /^[A-Za-z0-9_~.-]+$/;

/** audio/patch-targets.json의 빌드 대상 패치 이름 목록을 읽는다. */
export async function readTargets(file, patchDir) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  const names = parsed?.patches;
  if (!Array.isArray(names)) throw new Error(`${file}: "patches" 배열이 필요합니다.`);
  const available = await patchNames(patchDir);
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== "string" || !NAME.test(name)) throw new Error(`${file}: 잘못된 패치 이름 ${JSON.stringify(name)}`);
    if (seen.has(name)) throw new Error(`${file}: 중복된 패치 이름 ${name}`);
    if (!available.has(name)) throw new Error(`${file}: ${name}.pd 파일이 없습니다.`);
    seen.add(name);
  }
  return names;
}

async function patchNames(dir) {
  return new Set((await readdir(dir)).filter(f => f.endsWith(".pd")).map(f => f.slice(0, -3)));
}

/** Pd 파일에서 같은 폴더의 다른 .pd(abstraction)를 가리키는 객체 이름을 찾는다. */
export function referencedNames(source, available) {
  const found = new Set();
  // Pd 레코드는 `;`로 끝나며 여러 줄에 걸칠 수 있다.
  for (const record of source.split(/(?<!\\);\s*\n?/)) {
    const tokens = record.trim().split(/\s+/);
    if (tokens[0] !== "#X" || tokens[1] !== "obj") continue;
    // `clone abs 4` 처럼 인자로 abstraction을 받는 경우도 있으므로 모든 토큰을 본다.
    for (const raw of tokens.slice(4)) {
      const token = raw.replace(/,$/, "");
      if (available.has(token)) found.add(token);
    }
  }
  return found;
}

/** 대상 패치와 그것이 (재귀적으로) 불러오는 모든 abstraction 이름. 정렬된 배열. */
export async function dependencyClosure(dir, name) {
  const available = await patchNames(dir);
  const closure = new Set();
  const visit = async (current) => {
    if (closure.has(current)) return;
    closure.add(current);
    const source = await readFile(join(dir, `${current}.pd`), "utf8");
    for (const next of referencedNames(source, available)) await visit(next);
  };
  await visit(name);
  return [...closure].sort();
}

/** 엔진 버전 + 의존 패치 전체의 이름과 내용으로 만든 해시. 하나라도 바뀌면 달라진다(브라우저 캐시 무효화). */
export async function patchHash(dir, name, engineVersion) {
  const hash = createHash("sha256").update(`${engineVersion}\n`);
  for (const dep of await dependencyClosure(dir, name)) {
    hash.update(`${dep}\n`).update(await readFile(join(dir, `${dep}.pd`))).update("\n");
  }
  return hash.digest("hex");
}
