import { mkdir, mkdtemp, rm, readFile, writeFile, copyFile, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const webpd = dirname(require.resolve("webpd/package.json"));
const { readMetadata } = await import(pathToFileURL(join(webpd, "dist/node_modules/@webpd/compiler/dist/src/run/index.js")));
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "public/audio-test");
const patchesDir = join(root, "audio/patches");

const force = process.argv.includes("--force");
const hashesFile = join(output, ".build-hashes.json");

async function computeHash(content) {
  return createHash("sha256").update(content).digest("hex");
}

let savedHashes = {};
if (!force) {
  try {
    savedHashes = JSON.parse(await readFile(hashesFile, "utf-8"));
  } catch {
    savedHashes = {};
  }
}

const files = (await readdir(patchesDir)).filter(f => f.endsWith(".pd")).sort();
let runtimeCopied = false;

await mkdir(output, { recursive: true });

const newHashes = {};
let compiledCount = 0;
let skippedCount = 0;

for (const file of files) {
  const name = basename(file, ".pd");
  const filePath = join(patchesDir, file);
  const content = await readFile(filePath);
  const hash = await computeHash(content);
  newHashes[file] = hash;

  const wasmTarget = join(output, `${name}.wasm`);
  const ioTarget = join(output, `${name}.io.json`);

  const hasWasm = await stat(wasmTarget).then(() => true, () => false);

  if (!force && savedHashes[file] === hash && hasWasm) {
    skippedCount++;
    // Keep hash recorded
    continue;
  }

  console.log(`Compiling WebPd patch: ${file} -> ${name}.wasm...`);
  const temporary = await mkdtemp(join(tmpdir(), "whistle-webpd-"));
  let wasm, runtime;
  try {
    execFileSync(process.execPath, [join(webpd, "bin/cli.mjs"), "-i", filePath, "-o", temporary, "-f", "app"], { stdio: "inherit" });
    wasm = await readFile(join(temporary, "patch.wasm"));
    runtime = await readFile(join(temporary, "webpd-runtime.js"));
    if (!runtimeCopied) {
      await writeFile(join(output, "webpd-runtime.js"), runtime);
      runtimeCopied = true;
    }
  } catch (error) {
    console.warn(`Warning: Failed to compile patch ${file}:`, error.message);
    await rm(temporary, { recursive: true, force: true });
    continue;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  let io = { inputs: {}, outputs: {} };
  try {
    const metadata = await readMetadata("assemblyscript", wasm);
    const ports = (specs) => Object.fromEntries(Object.entries(specs).flatMap(([id, portlets]) => {
      const node = metadata.customMetadata.graph[id];
      if (!node || (node.type !== "send" && node.type !== "receive")) return [];
      if (!node.args.busName || portlets.length !== 1) return [];
      return [[node.args.busName, { nodeId: id, portletId: portlets[0] }]];
    }));
    io = {
      inputs: ports(metadata.settings.io.messageReceivers),
      outputs: ports(metadata.settings.io.messageSenders),
    };
  } catch (e) {
    console.warn(`Warning: Could not read metadata for ${file}:`, e.message);
  }

  if (name === "uwb-player") {
    for (const busName of ["whistle-edit", "whistle-player", "whistle-gate", "whistle-event", "whistle-player-stop", "whistle-board-height"]) {
      if (!io.inputs[busName] || !io.outputs[busName]) throw new Error(`Missing Pd bus for uwb-player: ${busName}`);
    }
    if (!io.outputs["whistle-ready"]) throw new Error("Missing Pd ready signal for uwb-player");
  }

  await writeFile(wasmTarget, wasm);
  await writeFile(ioTarget, JSON.stringify(io, null, 2) + "\n");
  compiledCount++;
}

// Ensure backwards compatibility aliases for uwb-player -> patch.wasm / io.json
const defaultWasm = join(output, "uwb-player.wasm");
const defaultIo = join(output, "uwb-player.io.json");
if (await stat(defaultWasm).then(() => true, () => false)) {
  await copyFile(defaultWasm, join(output, "patch.wasm"));
  if (await stat(defaultIo).then(() => true, () => false)) {
    await copyFile(defaultIo, join(output, "io.json"));
  }
}

for (const name of ["COPYING", "COPYING.LESSER"]) {
  await copyFile(join(webpd, name), join(output, name)).catch(() => {});
}

await writeFile(hashesFile, JSON.stringify(newHashes, null, 2) + "\n");
console.log(`WebPd build complete: compiled ${compiledCount}, skipped ${skippedCount} up-to-date patches.`);
