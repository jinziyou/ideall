import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUTPUT_DIR = path.join(ROOT, "public", "generated")

export const SEMANTIC_RUNTIME_BUDGET = Object.freeze({
  workerBytes: 2_000_000,
  workerGzipBytes: 650_000,
  orchestrationBytes: 64_000,
  orchestrationGzipBytes: 24_000,
  wasmBytes: 14_000_000,
})

export function semanticRuntimeViolations(stats, budget = SEMANTIC_RUNTIME_BUDGET) {
  return [
    ["worker raw", stats.workerBytes, budget.workerBytes],
    ["worker gzip", stats.workerGzipBytes, budget.workerGzipBytes],
    ["orchestration raw", stats.orchestrationBytes, budget.orchestrationBytes],
    ["orchestration gzip", stats.orchestrationGzipBytes, budget.orchestrationGzipBytes],
    ["WASM runtime", stats.wasmBytes, budget.wasmBytes],
  ]
    .filter(([, actual, limit]) => actual > limit)
    .map(([label, actual, limit]) => `${label}: ${actual} B > ${limit} B`)
}

async function main() {
  const worker = await readFile(path.join(OUTPUT_DIR, "semantic-worker.js"))
  const orchestration = await readFile(path.join(OUTPUT_DIR, "semantic-runtime.js"))
  const wasmBytes = (
    await Promise.all(
      ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"].map(
        async (file) => (await stat(path.join(OUTPUT_DIR, file))).size,
      ),
    )
  ).reduce((left, right) => left + right, 0)
  const stats = {
    workerBytes: worker.byteLength,
    workerGzipBytes: gzipSync(worker).byteLength,
    orchestrationBytes: orchestration.byteLength,
    orchestrationGzipBytes: gzipSync(orchestration).byteLength,
    wasmBytes,
  }
  const violations = semanticRuntimeViolations(stats)
  console.log(
    `[semantic-runtime] worker ${stats.workerBytes} B raw / ${stats.workerGzipBytes} B gzip; orchestration ${stats.orchestrationBytes} B raw / ${stats.orchestrationGzipBytes} B gzip; WASM ${stats.wasmBytes} B`,
  )
  if (violations.length) throw new Error(violations.join("\n"))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
