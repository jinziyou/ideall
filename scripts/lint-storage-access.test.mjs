import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { findStorageAccessViolations } from "./lint-storage-access.mjs"

test("storage access lint rejects new direct callers and honors explicit adapters", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ideall-storage-lint-"))
  try {
    mkdirSync(path.join(root, "src", "feature"), { recursive: true })
    writeFileSync(
      path.join(root, "src", "feature", "new-store.ts"),
      'export const read = () => localStorage.getItem("key")\n',
    )
    assert.deepEqual(findStorageAccessViolations(root, {}), [
      {
        file: "src/feature/new-store.ts",
        line: 1,
        access: "localStorage.getItem",
      },
    ])
    assert.deepEqual(
      findStorageAccessViolations(root, {
        "src/feature/new-store.ts": "explicit adapter",
      }),
      [],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
