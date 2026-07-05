import { test } from "node:test"
import assert from "node:assert/strict"
import { createPluginDataPackage, type PluginDataPort } from "./plugin-data"
import {
  formatPluginImportResult,
  importPluginDataPackage,
  previewPluginDataImport,
} from "./plugin-data-manager"

const demoPort: PluginDataPort<{ items: number }> = {
  pluginId: "demo",
  pluginLabel: "Demo",
  dataKind: "ideall.demo",
  dataVersion: 1,
  filenamePrefix: "ideall-demo",
  importMode: "replace",
  importDescription: "replace demo data",
  exportJson: async () => "{}",
  importJson: async () => ({ items: 2 }),
  inspect: async () => ({
    pluginId: "demo",
    label: "Demo",
    dataKind: "ideall.demo",
    dataVersion: 1,
    status: "ready",
    itemCount: 1,
    bytes: 8,
    updatedAt: 1,
    detail: "1 item",
  }),
}

test("previewPluginDataImport: 识别目标端口与当前数据", async () => {
  const raw = JSON.stringify(createPluginDataPackage(demoPort, { items: [1, 2] }, "now"))
  const preview = await previewPluginDataImport(raw, "demo.json", [demoPort])
  assert.equal(preview.ok, true)
  assert.equal(preview.filename, "demo.json")
  assert.equal(preview.package?.dataKind, "ideall.demo")
  assert.equal(preview.target?.importMode, "replace")
  assert.equal(preview.current?.detail, "1 item")
})

test("previewPluginDataImport: 拒绝未知插件与版本不匹配", async () => {
  const unknown = JSON.stringify(
    createPluginDataPackage(
      { pluginId: "missing", pluginLabel: "Missing", dataKind: "ideall.missing", dataVersion: 1 },
      {},
    ),
  )
  assert.match((await previewPluginDataImport(unknown, "x.json", [demoPort])).error ?? "", /未找到/)

  const wrongVersion = JSON.stringify(createPluginDataPackage({ ...demoPort, dataVersion: 2 }, {}))
  assert.match(
    (await previewPluginDataImport(wrongVersion, "x.json", [demoPort])).error ?? "",
    /不支持/,
  )
})

test("importPluginDataPackage: 执行导入并格式化结果", async () => {
  const raw = JSON.stringify(createPluginDataPackage(demoPort, { items: [1, 2] }, "now"))
  const result = await importPluginDataPackage(raw, "demo.json", [demoPort])
  assert.deepEqual(result.result, { items: 2 })
  assert.equal(formatPluginImportResult(result.result), "items: 2")
})
