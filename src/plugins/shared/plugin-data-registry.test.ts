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
import { GIT_EXPORT_KIND, GIT_EXPORT_VERSION } from "@/plugins/git/git-repos-store"
import { AGENT_EXPORT_KIND, AGENT_EXPORT_VERSION } from "@/plugins/agent/lib/agent-data-port"
import { SYNC_EXPORT_KIND, SYNC_EXPORT_VERSION } from "@/plugins/sync/lib/sync-data-port"
import { PLUGIN_DATA_PORTS, pluginDataPortById } from "./plugin-data-registry"

test("PLUGIN_DATA_PORTS: 核心插件暴露统一插件数据端口", () => {
  assert.deepEqual(
    PLUGIN_DATA_PORTS.map((port) => port.pluginId),
    ["audio", "database", "git", "agent", "sync"],
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
  assert.equal(pluginDataPortById("git")?.dataKind, GIT_EXPORT_KIND)
  assert.equal(pluginDataPortById("git")?.dataVersion, GIT_EXPORT_VERSION)
  assert.equal(pluginDataPortById("agent")?.dataKind, AGENT_EXPORT_KIND)
  assert.equal(pluginDataPortById("agent")?.dataVersion, AGENT_EXPORT_VERSION)
  assert.equal(pluginDataPortById("sync")?.dataKind, SYNC_EXPORT_KIND)
  assert.equal(pluginDataPortById("sync")?.dataVersion, SYNC_EXPORT_VERSION)
  assert.equal(pluginDataPortById("missing"), undefined)
})
