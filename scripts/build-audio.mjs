// 앱이 쓰는 오디오 파일을 public/audio-test/에 모은다. 컴파일은 하지 않는다(수 초).
// - pd4web/ : 미리 빌드한 pd4web 엔진(audio/engine/, `npm run audio:engine`으로 다시 빌드)
// - patches/: audio/patch-targets.json의 패치와 그것이 부르는 abstraction(.pd 원본 그대로)
//             + manifest.json(패치별 의존 파일과 해시). 해시는 브라우저 캐시를 넘기는 데 쓴다.
// 패치는 실행 중에 엔진 파일시스템으로 보내 동적으로 만든다(lib/audio/pd-runtime.ts).
import { mkdir, rm, readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTargets, patchHash, dependencyClosure } from "./audio-patches.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const patchDir = join(root, "audio/patches");
const engineDir = join(root, "audio/engine");
const output = join(root, "public/audio-test");

const engine = JSON.parse(await readFile(join(engineDir, "engine.json"), "utf8").catch(() => {
  throw new Error("audio/engine/engine.json이 없습니다. `npm run audio:engine`으로 pd4web 엔진을 먼저 빌드하세요.");
}));

// 예전 WebPd 빌드의 결과물(런타임·라이선스·패치별 wasm)은 지운다.
await Promise.all(["webpd-runtime.js", "COPYING", "COPYING.LESSER", "patch.wasm", "io.json", ".legacy-hash"]
  .map((f) => rm(join(output, f), { force: true })));

const engineOutput = join(output, "pd4web");
await mkdir(engineOutput, { recursive: true });
for (const name of Object.keys(engine.files)) await copyFile(join(engineDir, name), join(engineOutput, name));

const patchOutput = join(output, "patches");
await mkdir(patchOutput, { recursive: true });
const targets = await readTargets(join(root, "audio/patch-targets.json"), patchDir);
const manifest = { engine, patches: {} };
const files = new Set();
for (const name of targets) {
  const deps = await dependencyClosure(patchDir, name);
  manifest.patches[name] = { hash: (await patchHash(patchDir, name, `pd4web@${engine.pd4web}`)).slice(0, 16), files: deps.map((d) => `${d}.pd`) };
  for (const dep of deps) files.add(`${dep}.pd`);
}
for (const file of files) await copyFile(join(patchDir, file), join(patchOutput, file));
const keep = new Set(["manifest.json", ...files]);
const stale = (await readdir(patchOutput)).filter((f) => !keep.has(f));
await Promise.all(stale.map((f) => rm(join(patchOutput, f), { force: true })));
await writeFile(join(patchOutput, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Pd patches: ${targets.length}개 (${files.size} 파일)${stale.length ? `, 이전 파일 ${stale.length}개 지움` : ""} · pd4web 엔진 ${engine.pd4web}`);
