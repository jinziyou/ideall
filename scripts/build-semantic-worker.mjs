import { copyFile, mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUTPUT_DIR = path.join(ROOT, "public", "generated")
const WORKER_OUTPUT = path.join(OUTPUT_DIR, "semantic-worker.js")
const RUNTIME_OUTPUT = path.join(OUTPUT_DIR, "semantic-runtime.js")
const WASM_FILES = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]

export async function buildSemanticWorker() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  await build({
    entryPoints: [path.join(ROOT, "src", "workers", "semantic-worker.ts")],
    outfile: WORKER_OUTPUT,
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    conditions: ["browser", "module", "import"],
    alias: { "@": path.join(ROOT, "src") },
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
    },
    logLevel: "warning",
  })
  await build({
    entryPoints: [path.join(ROOT, "src", "workspace", "local-semantic-search.ts")],
    outfile: RUNTIME_OUTPUT,
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "iife",
    globalName: "IdeallSemanticRuntime",
    platform: "browser",
    target: ["es2022"],
    conditions: ["browser", "module", "import"],
    alias: { "@": path.join(ROOT, "src") },
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
    },
    logLevel: "warning",
  })

  const requireFromTransformers = createRequire(import.meta.resolve("@huggingface/transformers"))
  const ortDist = path.dirname(requireFromTransformers.resolve("onnxruntime-web"))
  for (const file of WASM_FILES) {
    await copyFile(path.join(ortDist, file), path.join(OUTPUT_DIR, file))
  }

  return {
    workerBytes: (await stat(WORKER_OUTPUT)).size,
    runtimeBytes: (await stat(RUNTIME_OUTPUT)).size,
    wasmBytes: await Promise.all(
      WASM_FILES.map(async (file) => (await stat(path.join(OUTPUT_DIR, file))).size),
    ),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSemanticWorker()
  console.log(
    `[semantic-worker] worker ${result.workerBytes} B / orchestration ${result.runtimeBytes} B / WASM ${result.wasmBytes.reduce((a, b) => a + b, 0)} B`,
  )
}
