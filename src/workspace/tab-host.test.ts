import assert from "node:assert/strict"
import { test } from "node:test"
import { registerBuiltInEngines } from "@/engines/builtin"
import type { Tab } from "./types"
import { dirtyTabMustStayAlive } from "./tab-host"

const codeTab: Tab = {
  id: "file-engine:code",
  kind: "file-engine",
  module: "code",
  title: "code",
  params: { file: "app.test:file", engine: "ideall.code" },
}

test("tab host: only snapshot-ready serializable dirty engines may be evicted", () => {
  registerBuiltInEngines()
  assert.equal(dirtyTabMustStayAlive(codeTab, new Set()), true)
  assert.equal(dirtyTabMustStayAlive(codeTab, new Set([codeTab.id])), false)
  const shell = {
    ...codeTab,
    id: "file-engine:shell",
    params: { file: "ideall.core:panel%3Ashell", engine: "ideall.shell" },
  }
  assert.equal(dirtyTabMustStayAlive(shell, new Set([shell.id])), true)
})
