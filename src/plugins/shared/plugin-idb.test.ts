import { test } from "node:test"
import assert from "node:assert/strict"
import { createPluginDb } from "./plugin-idb"

test("createPluginDb: IndexedDB 不可用时给出可恢复错误", async () => {
  const db = createPluginDb({
    name: "ideall:test",
    version: 1,
    upgrade: () => {},
  })

  await assert.rejects(() => db.getAll("items"), /当前环境不支持 IndexedDB/)
  await assert.rejects(() => db.get("items", "x"), /当前环境不支持 IndexedDB/)
})
