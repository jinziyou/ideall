import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createPluginDataPackage,
  parseWorkspaceBackupPackage,
  type PluginDataPort,
} from "./plugin-data"
import {
  exportWorkspaceBackupJson,
  formatPluginImportResult,
  importPluginDataPackage,
  previewPluginDataImport,
  restorePluginDataBackup,
} from "./plugin-data-manager"

let importedRaw = ""

const demoPort: PluginDataPort<{ items: number }> = {
  pluginId: "demo",
  pluginLabel: "Demo",
  dataKind: "ideall.demo",
  dataVersion: 1,
  filenamePrefix: "ideall-demo",
  importMode: "replace",
  importDescription: "replace demo data",
  exportJson: async () => JSON.stringify(createPluginDataPackage(demoPort, { items: ["current"] })),
  importJson: async (raw) => {
    importedRaw = raw
    return { items: 2 }
  },
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
  importedRaw = ""
  const raw = JSON.stringify(createPluginDataPackage(demoPort, { items: [1, 2] }, "now"))
  const result = await importPluginDataPackage(raw, "demo.json", [demoPort])
  assert.deepEqual(result.result, { items: 2 })
  assert.equal(result.backup?.pluginId, "demo")
  assert.match(result.backup?.raw ?? "", /current/)
  assert.equal(formatPluginImportResult(result.result), "items: 2")
})

test("restorePluginDataBackup: 可恢复导入前备份", async () => {
  const raw = JSON.stringify(createPluginDataPackage(demoPort, { items: [1, 2] }, "now"))
  const result = await importPluginDataPackage(raw, "demo.json", [demoPort])
  assert.ok(result.backup)
  await restorePluginDataBackup(result.backup, [demoPort])
  assert.match(importedRaw, /current/)
})

test("importPluginDataPackage: 导入失败后尝试恢复备份", async () => {
  let calls = 0
  const recoveringPort: PluginDataPort<{ calls: number }> = {
    ...demoPort,
    exportJson: async () =>
      JSON.stringify(createPluginDataPackage(demoPort, { items: ["before-failure"] })),
    importJson: async (raw) => {
      calls += 1
      importedRaw = raw
      if (calls === 1) throw new Error("boom")
      return { calls }
    },
  }
  const raw = JSON.stringify(createPluginDataPackage(demoPort, { items: ["broken"] }, "now"))
  await assert.rejects(() => importPluginDataPackage(raw, "demo.json", [recoveringPort]), /boom/)
  assert.equal(calls, 2)
  assert.match(importedRaw, /before-failure/)
})

test("workspace backup: 导出、预检、导入与恢复全量插件包", async () => {
  importedRaw = ""
  const raw = await exportWorkspaceBackupJson([demoPort])
  const pack = parseWorkspaceBackupPackage(raw)
  assert.equal(pack.kind, "ideall.workspace-backup")
  assert.equal(pack.plugins.length, 1)
  assert.equal(pack.plugins[0].plugin.id, "demo")

  const preview = await previewPluginDataImport(raw, "workspace.json", [demoPort])
  assert.equal(preview.ok, true)
  assert.equal(preview.target?.pluginLabel, "全部插件")
  assert.equal(preview.workspace?.pluginCount, 1)

  const result = await importPluginDataPackage(raw, "workspace.json", [demoPort])
  assert.deepEqual(result.result, { plugins: 1, imported: 1, noop: 0 })
  assert.equal(result.backup?.pluginId, "workspace")
  assert.match(importedRaw, /current/)

  await restorePluginDataBackup(result.backup!, [demoPort])
  assert.match(importedRaw, /current/)
})
