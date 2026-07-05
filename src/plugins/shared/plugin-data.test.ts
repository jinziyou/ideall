import { test } from "node:test"
import assert from "node:assert/strict"
import {
  PLUGIN_DATA_PACKAGE_KIND,
  PLUGIN_DATA_PACKAGE_VERSION,
  createPluginDataPackage,
  parseExpectedPluginDataPackage,
  parsePluginDataPackage,
  pluginDataFilename,
} from "./plugin-data"

const spec = {
  pluginId: "demo",
  pluginLabel: "Demo",
  dataKind: "ideall.plugin.demo",
  dataVersion: 1,
} as const

test("createPluginDataPackage/parsePluginDataPackage: 固定统一插件数据封套", () => {
  const pack = createPluginDataPackage(spec, { ok: true }, "2026-01-01T00:00:00.000Z")

  assert.deepEqual(parsePluginDataPackage(JSON.stringify(pack)), {
    kind: PLUGIN_DATA_PACKAGE_KIND,
    version: PLUGIN_DATA_PACKAGE_VERSION,
    plugin: {
      id: "demo",
      label: "Demo",
      dataKind: "ideall.plugin.demo",
      dataVersion: 1,
    },
    exportedAt: "2026-01-01T00:00:00.000Z",
    payload: { ok: true },
  })
})

test("parseExpectedPluginDataPackage: 拒绝插件/数据类型/版本不匹配", () => {
  const pack = createPluginDataPackage(spec, {})
  assert.equal(parseExpectedPluginDataPackage(JSON.stringify(pack), spec).plugin.id, "demo")

  assert.throws(
    () =>
      parseExpectedPluginDataPackage(JSON.stringify(pack), {
        ...spec,
        dataVersion: 2,
      }),
    /不支持/,
  )
  assert.throws(() => parsePluginDataPackage(JSON.stringify({ kind: "old", version: 1 })), /版本/)
})

test("pluginDataFilename: 使用 ISO 时间生成稳定 JSON 文件名", () => {
  assert.equal(
    pluginDataFilename("ideall-demo", new Date("2026-01-01T00:00:00.000Z")),
    "ideall-demo-2026-01-01T00-00-00-000Z.json",
  )
})
