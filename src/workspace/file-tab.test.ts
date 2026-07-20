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
import { isBrowserResourceTab, isEmbeddedResourceTab } from "./resource-tab"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { tabKey } from "./tab-key"

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

test("file engine tab: connected embeds retain the iframe lifecycle category", () => {
  const infoRef = resourceFileRef({ scheme: "info", kind: "home", id: "default" })
  const communityRef = resourceFileRef({ scheme: "community", kind: "home", id: "default" })
  assert.equal(
    isEmbeddedResourceTab(fileEngineTab({ ref: infoRef, name: "info" }, "ideall.connected")),
    true,
  )
  assert.equal(
    isEmbeddedResourceTab(
      fileEngineTab({ ref: communityRef, name: "community" }, "ideall.connected"),
    ),
    true,
  )
  assert.equal(isEmbeddedResourceTab(fileEngineTab({ ref, name: "file" }, "ideall.code")), false)
})

test("file engine tab: one FileRef can stay open in multiple engine tabs", () => {
  const code = fileEngineTab({ ref, name: "demo.ts" }, "ideall.code")
  const preview = fileEngineTab({ ref, name: "demo.ts" }, "ideall.preview")

  assert.notEqual(tabKey(code), tabKey(preview))
  assert.deepEqual(parseFileEngineTabParams(code.params)?.ref, ref)
  assert.deepEqual(parseFileEngineTabParams(preview.params)?.ref, ref)
})
