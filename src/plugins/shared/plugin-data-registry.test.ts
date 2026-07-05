import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AUDIO_DATA_SPEC,
  AUDIO_EXPORT_KIND,
  AUDIO_EXPORT_VERSION,
} from "@/plugins/audio/audio-store"
import {
  DATABASE_DATA_SPEC,
  DATABASE_EXPORT_KIND,
  DATABASE_EXPORT_VERSION,
} from "@/plugins/database/database-store"
import { PLUGIN_DATA_PORTS, pluginDataPortById } from "./plugin-data-registry"

test("PLUGIN_DATA_PORTS: audio/database 暴露统一插件数据端口", () => {
  assert.deepEqual(
    PLUGIN_DATA_PORTS.map((port) => port.pluginId),
    ["audio", "database"],
  )

  assert.deepEqual(pluginDataPortById("audio"), {
    ...AUDIO_DATA_SPEC,
    filenamePrefix: "ideall-audio",
    exportJson: pluginDataPortById("audio")?.exportJson,
    importJson: pluginDataPortById("audio")?.importJson,
    inspect: pluginDataPortById("audio")?.inspect,
  })
  assert.equal(pluginDataPortById("audio")?.dataKind, AUDIO_EXPORT_KIND)
  assert.equal(pluginDataPortById("audio")?.dataVersion, AUDIO_EXPORT_VERSION)
  assert.equal(pluginDataPortById("database")?.dataKind, DATABASE_EXPORT_KIND)
  assert.equal(pluginDataPortById("database")?.dataVersion, DATABASE_EXPORT_VERSION)
  assert.equal(pluginDataPortById("database")?.pluginLabel, DATABASE_DATA_SPEC.pluginLabel)
  assert.equal(pluginDataPortById("missing"), undefined)
})
