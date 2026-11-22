import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error 빌드 스크립트는 타입 선언이 없는 .mjs
import { readTargets, dependencyClosure, patchHash, referencedNames } from "../scripts/audio-patches.mjs";

const obj = (name: string, ...args: string[]) => `#X obj 10 10 ${[name, ...args].join(" ")};\n`;

async function fixture(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "whistle-patches-"));
  for (const [name, source] of Object.entries(files)) await writeFile(join(dir, name), source);
  return { dir, done: () => rm(dir, { recursive: true, force: true }) };
}

test("abstraction 참조를 재귀적으로 찾고 내장 객체는 무시한다", async () => {
  const { dir, done } = await fixture({
    "main.pd": "#N canvas 0 0 100 100 10;\n" + obj("osc~", "440") + obj("ead110~") + obj("dac~,", "f", "7"),
    "ead110~.pd": obj("ead~", "3"),
    "ead~.pd": obj("vline~"),
    "unused.pd": obj("osc~"),
  });
  try {
    assert.deepEqual(await dependencyClosure(dir, "main"), ["ead110~", "ead~", "main"]);
  } finally { await done(); }
});

test("clone 인자와 줄바꿈된 레코드, 쉼표가 붙은 토큰도 참조로 인식한다", () => {
  const available = new Set(["voice", "ead~"]);
  const source = "#X obj 10 10 clone\nvoice 4;\n#X obj 10 10 ead~, f 7;\n#X msg 10 10 voice;\n";
  assert.deepEqual([...referencedNames(source, available)].sort(), ["ead~", "voice"]);
});

test("순환 참조가 있어도 끝난다", async () => {
  const { dir, done } = await fixture({ "a.pd": obj("b"), "b.pd": obj("a") });
  try { assert.deepEqual(await dependencyClosure(dir, "a"), ["a", "b"]); } finally { await done(); }
});

test("해시는 의존 패치나 컴파일러 버전이 바뀔 때만 달라진다", async () => {
  const { dir, done } = await fixture({ "main.pd": obj("dep"), "dep.pd": obj("osc~"), "other.pd": obj("osc~") });
  try {
    const before = await patchHash(dir, "main", "1");
    await writeFile(join(dir, "other.pd"), obj("noise~"));
    assert.equal(await patchHash(dir, "main", "1"), before, "관계없는 패치 변경은 무시");
    assert.notEqual(await patchHash(dir, "main", "2"), before, "컴파일러 버전 변경");
    await writeFile(join(dir, "dep.pd"), obj("noise~"));
    assert.notEqual(await patchHash(dir, "main", "1"), before, "abstraction 변경");
  } finally { await done(); }
});

test("대상 목록은 존재하는 패치만, 중복 없이 허용한다", async () => {
  const { dir, done } = await fixture({ "a.pd": obj("osc~") });
  const list = join(dir, "targets.json");
  try {
    await writeFile(list, JSON.stringify({ patches: ["a"] }));
    assert.deepEqual(await readTargets(list, dir), ["a"]);
    await writeFile(list, JSON.stringify({ patches: ["a", "a"] }));
    await assert.rejects(readTargets(list, dir), /중복/);
    await writeFile(list, JSON.stringify({ patches: ["missing"] }));
    await assert.rejects(readTargets(list, dir), /missing\.pd/);
    await writeFile(list, JSON.stringify({ patches: ["../a"] }));
    await assert.rejects(readTargets(list, dir), /잘못된/);
  } finally { await done(); }
});

test("실제 terrain_clock 패치의 의존성", async () => {
  const deps = await dependencyClosure(join(import.meta.dirname, "../audio/patches"), "terrain_clock");
  // ead1xx~는 ead~를 주석(#X text)에서만 언급하므로 의존성이 아니다.
  assert.deepEqual(deps, ["ead108~", "ead110~", "ead111~", "ead122~", "ead130~", "ead140~", "ead145~", "ead170~", "terrain_clock"]);
});
