import assert from "node:assert/strict"
import { test } from "node:test"
import {
  SEMANTIC_RUNTIME_BUDGET,
  semanticRuntimeViolations,
} from "./check-semantic-runtime-budget.mjs"

test("semantic runtime budget reports each independent payload regression", () => {
  assert.deepEqual(
    semanticRuntimeViolations({
      workerBytes: SEMANTIC_RUNTIME_BUDGET.workerBytes + 1,
      workerGzipBytes: SEMANTIC_RUNTIME_BUDGET.workerGzipBytes + 1,
      orchestrationBytes: SEMANTIC_RUNTIME_BUDGET.orchestrationBytes + 1,
      orchestrationGzipBytes: SEMANTIC_RUNTIME_BUDGET.orchestrationGzipBytes + 1,
      wasmBytes: SEMANTIC_RUNTIME_BUDGET.wasmBytes + 1,
    }).map((message) => message.split(":")[0]),
    ["worker raw", "worker gzip", "orchestration raw", "orchestration gzip", "WASM runtime"],
  )
})
