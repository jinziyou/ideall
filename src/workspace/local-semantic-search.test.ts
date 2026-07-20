import assert from "node:assert/strict"
import { test } from "node:test"
import type { LocalSearchIndexDocument } from "@/files/local-search-index-store"
import { createLocalSemanticVector } from "@/files/local-semantic-index-store"
import {
  LOCAL_SEMANTIC_MAX_INPUT_CHARS,
  LOCAL_SEMANTIC_MODEL_ID,
  LOCAL_SEMANTIC_VECTOR_DIMENSIONS,
} from "@/lib/local-semantic-contract"
import {
  localSemanticIndexMatchesDocuments,
  localSemanticPassage,
  localSemanticScores,
} from "./local-semantic-search"

function document(key: string, sourceVersion: string): LocalSearchIndexDocument {
  return {
    key,
    type: "document",
    target: { fileSystemId: "ideall.core", fileId: key },
    group: "文件",
    kind: "note",
    label: `Title ${key}`,
    fields: [{ label: "正文", value: "A   locally indexed passage" }],
    sourceVersion,
    indexedAt: 1,
  }
}

function unitVector(index: number, value = 1): Float32Array {
  const vector = new Float32Array(LOCAL_SEMANTIC_VECTOR_DIMENSIONS)
  vector[index] = value
  return vector
}

test("local semantic text: uses the E5 passage prefix, compacts whitespace and stays bounded", () => {
  const source = {
    ...document("document:long", "1"),
    fields: [{ label: "正文", value: `alpha   beta ${"long ".repeat(2_000)}` }],
  }

  const passage = localSemanticPassage(source)

  assert.match(passage, /^passage: Title document:long 正文: alpha beta/)
  assert.ok(passage.length <= LOCAL_SEMANTIC_MAX_INPUT_CHARS)
  assert.doesNotMatch(passage, / {2,}/)
})

test("local semantic scores: ignores stale/model-mismatched vectors and ranks current vectors", () => {
  const first = document("document:first", "1")
  const second = document("document:second", "2")
  const currentFirst = createLocalSemanticVector(
    first.key,
    "1",
    LOCAL_SEMANTIC_MODEL_ID,
    unitVector(0, 0.8),
  )
  const staleSecond = createLocalSemanticVector(
    second.key,
    "1",
    LOCAL_SEMANTIC_MODEL_ID,
    unitVector(0, 0.9),
  )
  const wrongModel = createLocalSemanticVector(second.key, "2", "other/model", unitVector(0, 1))

  const scores = localSemanticScores(
    [first, second],
    [currentFirst, staleSecond, wrongModel],
    unitVector(0),
  )

  assert.equal(scores.size, 1)
  assert.ok(Math.abs((scores.get(first.key) ?? 0) - 0.8) < 0.000_001)
  assert.equal(
    localSemanticIndexMatchesDocuments([first, second], [currentFirst, staleSecond]),
    false,
  )
  const currentSecond = createLocalSemanticVector(
    second.key,
    "2",
    LOCAL_SEMANTIC_MODEL_ID,
    unitVector(1),
  )
  assert.equal(
    localSemanticIndexMatchesDocuments([first, second], [currentFirst, currentSecond]),
    true,
  )
  assert.equal(
    localSemanticIndexMatchesDocuments([first, second], [currentFirst, currentFirst]),
    false,
  )
})
