import { test } from "node:test"
import assert from "node:assert/strict"
import {
  WORKSPACE_KEY,
  readDebugSnapshot,
  readStorage,
  readWorkspace,
  type StorageLike,
} from "./debug-snapshot"

function storage(values: Record<string, string>, failingKeys = new Set<string>()): StorageLike {
  const keys = Object.keys(values)
  return {
    get length() {
      return keys.length
    },
    key: (i) => keys[i] ?? null,
    getItem: (key) => {
      if (failingKeys.has(key)) throw new Error(`${key} blocked`)
      return values[key] ?? null
    },
  }
}

test("readStorage: 单 key 读取失败不阻断其它诊断项", () => {
  const result = readStorage(
    storage({ ok: "visible", bad: "secret" }, new Set(["bad"])),
    "localStorage",
  )

  assert.equal(result.error, undefined)
  assert.deepEqual(
    result.entries.map((entry) => [entry.key, entry.error ? "error" : entry.preview]),
    [
      ["bad", "error"],
      ["ok", "visible"],
    ],
  )
})

test("readStorage: 存储整体不可用时返回错误桶", () => {
  const result = readStorage(undefined, "sessionStorage")
  assert.deepEqual(result, { entries: [], error: "sessionStorage 不可用" })
})

test("readDebugSnapshot: 工作区优先读 sessionStorage 且敏感值脱敏", () => {
  const local = storage({
    authToken: "secret-token",
    [WORKSPACE_KEY]: JSON.stringify({ tabs: [{ id: "a" }], activeId: "local" }),
  })
  const session = storage({
    [WORKSPACE_KEY]: JSON.stringify({
      tabs: [{ id: "a" }, { id: "b" }],
      activeId: "tab-b",
      activeModule: "home",
      mode: "local",
    }),
  })
  const snapshot = readDebugSnapshot({
    localStorage: local,
    sessionStorage: session,
    runtime: {
      href: "http://localhost/debug",
      userAgent: "test",
      language: "zh-CN",
      online: true,
      timezone: "Asia/Shanghai",
      viewport: "100x100",
      tauri: false,
    },
  })

  assert.equal(snapshot.workspace?.source, "sessionStorage")
  assert.equal(snapshot.workspace?.tabs, 2)
  assert.equal(snapshot.workspace?.activeId, "tab-b")
  assert.equal(
    snapshot.storage.localStorage.entries.find((entry) => entry.key === "authToken")?.redacted,
    true,
  )
  assert.ok(!JSON.stringify(snapshot).includes("secret-token"))
})

test("readWorkspace: 非法 JSON 以 parse-error 保留诊断上下文", () => {
  assert.deepEqual(readWorkspace("{bad", "localStorage"), {
    source: "localStorage",
    tabs: 0,
    activeId: null,
    activeModule: "parse-error",
    mode: null,
  })
})
