import { mkdir, mkdtemp, rm, readFile, writeFile, copyFile, readdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readTargets, patchHash, busPorts } from "./audio-patches.mjs";

const require = createRequire(import.meta.url);
const webpd = dirname(require.resolve("webpd/package.json"));
const webpdVersion = JSON.parse(await readFile(join(webpd, "package.json"), "utf8")).version;
const { readMetadata } = await import(pathToFileURL(join(webpd, "dist/node_modules/@webpd/compiler/dist/src/run/index.js")));
const { default: runtimeCode } = await import(pathToFileURL(join(webpd, "dist/src/build/outputs/app/assets/runtime.js.txt.js")));
const root = fileURLToPath(new URL("../", import.meta.url));
const patchDir = join(root, "audio/patches");
const output = join(root, "public/audio-test");
const compile = (name, out) => {
  const started = Date.now();
  console.log(`WebPd: compiling ${name}.pd ...`);
  execFileSync(process.execPath, [join(webpd, "bin/cli.mjs"), "-i", join(patchDir, `${name}.pd`), "-o", out, "-f", "wasm"], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`WebPd: compiled ${name}.pd (${((Date.now() - started) / 1000).toFixed(1)}s)`);
};

await mkdir(output, { recursive: true });
await writeFile(join(output, "webpd-runtime.js"), runtimeCode);
for (const name of ["COPYING", "COPYING.LESSER"]) await copyFile(join(webpd, name), join(output, name));

const temporary = await mkdtemp(join(tmpdir(), "whistle-webpd-"));
try {
  // 예전 단일 패치 빌드(patch.wasm/io.json)의 결과물이 남아 있으면 지운다.
  await Promise.all(["patch.wasm", "io.json", ".legacy-hash"].map(f => rm(join(output, f), { force: true })));

  // --- 패치별 빌드: audio/patch-targets.json에 등재된 패치만 <이름>.wasm으로 ---
  const patchOutput = join(output, "patches");
  const manifestFile = join(patchOutput, "manifest.json");
  await mkdir(patchOutput, { recursive: true });
  const previous = await readFile(manifestFile, "utf8").then(JSON.parse).catch(() => ({ patches: {} }));
  const targets = await readTargets(join(root, "audio/patch-targets.json"), patchDir);
  const manifest = { webpd: webpdVersion, patches: {} };
  let compiled = 0;
  for (const name of targets) {
    const hash = await patchHash(patchDir, name, webpdVersion);
    const file = `${name}.wasm`;
    const cached = previous.patches?.[name];
    const exists = await access(join(patchOutput, file)).then(() => true, () => false);
    if (cached?.hash === hash && exists) {
      manifest.patches[name] = cached;
      continue;
    }
    const out = join(temporary, file);
    compile(name, out);
    const bytes = await readFile(out);
    manifest.patches[name] = { file, hash, bytes: bytes.byteLength, ...busPorts(await readMetadata("assemblyscript", bytes)) };
    await writeFile(join(patchOutput, file), bytes);
    compiled++;
  }
  // 목록에서 빠진 패치의 이전 결과물은 지운다(남아 있으면 혼동의 원인이 됨).
  const keep = new Set(["manifest.json", ...Object.values(manifest.patches).map(p => p.file)]);
  const stale = (await readdir(patchOutput)).filter(f => !keep.has(f));
  await Promise.all(stale.map(f => rm(join(patchOutput, f), { force: true })));
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`WebPd patches: ${compiled} compiled, ${targets.length - compiled} up to date${stale.length ? `, ${stale.length} stale removed` : ""} (${targets.join(", ") || "none"})`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
