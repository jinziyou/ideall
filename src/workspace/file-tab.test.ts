import { test } from "node:test"
import assert from "node:assert/strict"
import { fileRefKey } from "@protocol/file-system"
import {
  FILE_ENGINE_TAB_KIND,
  descriptorForFileEngineSearch,
  fileEnginePath,
  fileEngineTab,
  parseFileEngineSearch,
  parseFileEngineTabParams,
} from "./file-tab"
import { isBrowserResourceTab } from "./resource-tab"

const ref = { fileSystemId: "app:示例", fileId: "folder/a:b?c" }

test("file engine tab: stable file + engine identity round-trips through params and URL", () => {
  const tab = fileEngineTab({ ref, name: "demo.ts" }, "ideall.code")
  assert.equal(tab.kind, FILE_ENGINE_TAB_KIND)
  assert.deepEqual(parseFileEngineTabParams(tab.params), { ref, engineId: "ideall.code" })
  const path = fileEnginePath(ref, "ideall.code")
  const search = path.split("?", 2)[1] ?? ""
  assert.deepEqual(parseFileEngineSearch(search), {
    ref,
    engineId: "ideall.code",
  })
  assert.equal(tab.params?.file, fileRefKey(ref))
  assert.equal(descriptorForFileEngineSearch(search)?.params?.engine, "ideall.code")
})

test("file engine tab: invalid or missing engine is rejected", () => {
  assert.equal(parseFileEngineTabParams({ file: fileRefKey(ref) }), null)
  assert.equal(parseFileEngineSearch(`?file=${encodeURIComponent(fileRefKey(ref))}`), null)
})

test("file engine tab: browser engine participates in native browser lifecycle", () => {
  assert.equal(isBrowserResourceTab(fileEngineTab({ ref, name: "site" }, "ideall.browser")), true)
  assert.equal(isBrowserResourceTab(fileEngineTab({ ref, name: "site" }, "ideall.preview")), false)
})
