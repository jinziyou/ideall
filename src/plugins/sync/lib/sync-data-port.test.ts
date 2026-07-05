import { test } from "node:test"
import assert from "node:assert/strict"
import {
  SYNC_DATA_SPEC,
  SYNC_EXPORT_KIND,
  SYNC_EXPORT_VERSION,
  createSyncStatusExport,
  parseSyncStatusExport,
} from "./sync-data-port"
import { PLUGIN_DATA_PACKAGE_KIND, PLUGIN_DATA_PACKAGE_VERSION } from "@/plugins/shared/plugin-data"

test("createSyncStatusExport/parseSyncStatusExport: 只导出同步状态不导出同步码", () => {
  const pack = createSyncStatusExport(true, "now")
  assert.deepEqual(parseSyncStatusExport(JSON.stringify(pack)), {
    kind: PLUGIN_DATA_PACKAGE_KIND,
    version: PLUGIN_DATA_PACKAGE_VERSION,
    plugin: {
      id: SYNC_DATA_SPEC.pluginId,
      label: SYNC_DATA_SPEC.pluginLabel,
      dataKind: SYNC_EXPORT_KIND,
      dataVersion: SYNC_EXPORT_VERSION,
    },
    exportedAt: "now",
    payload: { configured: true, codeExported: false },
  })
})
