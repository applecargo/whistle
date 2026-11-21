// pd4web 엔진(Pd 0.56 + vanilla 객체를 wasm으로)을 한 번 빌드해 audio/engine/에 둔다.
// 엔진에는 패치가 들어가지 않는다(빈 host 패치만). 패치는 실행 중에 sendFile로 넣고 동적으로 만든다.
// 그래서 패치를 고쳐도 이 빌드는 다시 할 필요가 없다. pd4web 버전을 올리거나 외부 객체가 필요할 때만 돌린다.
//
//   npm run audio:engine                 (PATH의 pd4web)
//   PD4WEB=/path/to/pd4web npm run audio:engine
//
// pd4web CLI는 파이썬 패키지(pip install pd4web, Python 3.12+). 첫 빌드는 Emscripten 등을 받아 오래 걸린다.
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const engineDir = join(root, "audio/engine");
const pd4web = process.env.PD4WEB || "pd4web";
/** wasm 메모리(MB). 메모리가 늘어나지 않는 빌드라 동시에 띄울 패치 수(슬롯)를 감당할 만큼 잡는다. */
const MEMORY_MB = 64;
/** 엔진 결과물 중 앱이 쓰는 파일 */
const FILES = ["pd4web.js", "pd4web.wasm", "pd4web.data"];

// `pd4web --version`은 "pd4web 3.4.1 | built ..."를 출력하고 0이 아닌 코드로 끝난다.
const probe = spawnSync(pd4web, ["--version"], { encoding: "utf8" });
const version = /pd4web\s+(\S+)/.exec(`${probe.stdout}${probe.stderr}`)?.[1];
if (!version) throw new Error(`pd4web CLI를 찾지 못했습니다(${pd4web}). pip install pd4web 후 PATH에 두거나 PD4WEB=경로 로 지정하세요.`);
// 빌드 폴더는 지우지 않고 다시 쓴다(두 번째 빌드부터 캐시로 1~2분).
const work = join(root, "output/pd4web-engine");
{
  const source = join(work, "src");
  const out = join(work, "out");
  await mkdir(source, { recursive: true });
  // 빈 host: 슬롯(서브패치)은 JS가 동적 패칭 메시지로 만든다(lib/audio/pd-runtime.ts).
  await writeFile(join(source, "index.pd"), "#N canvas 0 50 450 300 12;\n#X text 20 20 whistle host: slots are created by JS;\n");
  const started = Date.now();
  console.log(`pd4web ${version}: 엔진 빌드 중...`);
  execFileSync(pd4web, ["--nogui", "-m", String(MEMORY_MB), "-o", out, "index.pd"], { cwd: source, stdio: ["ignore", "ignore", "inherit"] });
  await mkdir(engineDir, { recursive: true });
  const files = {};
  for (const name of FILES) {
    await copyFile(join(out, "WebPatch", name), join(engineDir, name));
    files[name] = createHash("sha256").update(await readFile(join(engineDir, name))).digest("hex").slice(0, 16);
  }
  await writeFile(join(engineDir, "engine.json"), JSON.stringify({ pd4web: version, memoryMB: MEMORY_MB, files }, null, 2) + "\n");
  console.log(`pd4web 엔진 빌드 완료 (${((Date.now() - started) / 1000).toFixed(0)}s) → audio/engine/`);
}
