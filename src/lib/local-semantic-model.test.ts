import assert from "node:assert/strict"
import { test } from "node:test"
import {
  LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES,
  LOCAL_SEMANTIC_MODEL_FILES,
  LOCAL_SEMANTIC_MODEL_MAX_BYTES,
  localSemanticModelFileUrl,
} from "./local-semantic-model"
import { LOCAL_SEMANTIC_MODEL_ID, LOCAL_SEMANTIC_MODEL_REVISION } from "./local-semantic-contract"

test("local semantic model: manifest is immutable, exact and inside the explicit cache budget", () => {
  assert.match(LOCAL_SEMANTIC_MODEL_REVISION, /^[a-f0-9]{40}$/)
  assert.equal(
    LOCAL_SEMANTIC_MODEL_FILES.reduce((total, file) => total + file.bytes, 0),
    LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES,
  )
  assert.equal(LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES, 135_392_016)
  assert.ok(LOCAL_SEMANTIC_MODEL_DOWNLOAD_BYTES <= LOCAL_SEMANTIC_MODEL_MAX_BYTES)
  assert.deepEqual(
    LOCAL_SEMANTIC_MODEL_FILES.map((file) => file.path),
    ["config.json", "onnx/model_quantized.onnx", "tokenizer.json", "tokenizer_config.json"],
  )
  assert.equal(new Set(LOCAL_SEMANTIC_MODEL_FILES.map((file) => file.path)).size, 4)
  for (const file of LOCAL_SEMANTIC_MODEL_FILES) {
    assert.equal(
      localSemanticModelFileUrl(file.path),
      `https://huggingface.co/${LOCAL_SEMANTIC_MODEL_ID}/resolve/${LOCAL_SEMANTIC_MODEL_REVISION}/${file.path}`,
    )
  }
})
