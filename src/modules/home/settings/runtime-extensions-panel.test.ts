import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { RuntimeExtensionCatalogState } from "@/shell/runtime-extensions"
import {
  RuntimeExtensionsPanel,
  runtimeExtensionActionPolicy,
  runtimeExtensionFailureMessage,
  runtimeExtensionHealthPresentation,
  runtimeExtensionSourceLabel,
  type RuntimeExtensionCatalogView,
} from "./runtime-extensions-panel"

function state(patch: Partial<RuntimeExtensionCatalogState> = {}): RuntimeExtensionCatalogState {
  return {
    id: "example.extension",
    label: "Example",
    version: 2,
    source: { kind: "package", id: "example.pkg" },
    permissions: ["fs:read"],
    digest: "digest",
    permissionDigest: "permissions",
    consentReceipt: "receipt",
    desired: true,
    health: "active",
    failure: null,
    pendingCleanup: [],
    ...patch,
  }
}

function catalog(states: RuntimeExtensionCatalogState[]): RuntimeExtensionCatalogView {
  return {
    states: () => states,
    subscribe: () => () => undefined,
    revision: () => 1,
    retry: async () => true,
    revoke: async () => true,
    uninstall: async () => true,
  }
}

test("runtime extensions panel: health, source and failure presentation are explicit", () => {
  assert.deepEqual(runtimeExtensionHealthPresentation("quarantined"), {
    label: "已隔离",
    tone: "error",
    description: "部分资源清理失败，扩展已隔离；请重试清理。",
  })
  assert.equal(
    runtimeExtensionSourceLabel({ kind: "builtin", id: "ideall.apps" }),
    "内置 · ideall.apps",
  )
  assert.equal(runtimeExtensionSourceLabel(null), "未知来源")
  assert.equal(
    runtimeExtensionFailureMessage(new AggregateError([new Error("dispose")], "清理失败")),
    "清理失败",
  )
})

test("runtime extensions panel: action policy does not fake consent or revoke builtin trust", () => {
  assert.deepEqual(
    runtimeExtensionActionPolicy(
      state({ health: "consent-required", consentReceipt: null, desired: false }),
    ),
    { retry: false, revoke: false, uninstall: false },
  )
  assert.deepEqual(
    runtimeExtensionActionPolicy(
      state({ source: { kind: "builtin", id: "ideall.apps" }, health: "ready", desired: false }),
    ),
    { retry: true, revoke: false, uninstall: false },
  )
  assert.deepEqual(
    runtimeExtensionActionPolicy(
      state({
        source: { kind: "builtin", id: "ideall.apps" },
        health: "active",
        desired: true,
      }),
    ),
    { retry: false, revoke: false, uninstall: false },
  )
  assert.deepEqual(
    runtimeExtensionActionPolicy(
      state({ health: "consent-required", consentReceipt: "persisted", desired: true }),
    ),
    { retry: false, revoke: true, uninstall: true },
  )
  assert.deepEqual(
    runtimeExtensionActionPolicy(
      state({ source: null, health: "unavailable", permissions: [], consentReceipt: null }),
    ),
    { retry: false, revoke: false, uninstall: true },
  )
})

test("runtime extensions panel: renders empty, permission and quarantine diagnostics", () => {
  const empty = renderToStaticMarkup(
    createElement(RuntimeExtensionsPanel, { catalog: catalog([]) }),
  )
  assert.match(empty, /暂无运行时扩展/)

  const populated = renderToStaticMarkup(
    createElement(RuntimeExtensionsPanel, {
      catalog: catalog([
        state({
          health: "quarantined",
          failure: new Error("socket cleanup failed"),
          pendingCleanup: ["lifecycle", "filesystem:remote"],
        }),
      ]),
    }),
  )
  assert.match(populated, /Example/)
  assert.match(populated, /fs:read/)
  assert.match(populated, /已隔离/)
  assert.match(populated, /socket cleanup failed/)
  assert.match(populated, /filesystem:remote/)

  const builtin = renderToStaticMarkup(
    createElement(RuntimeExtensionsPanel, {
      catalog: catalog([
        state({
          source: { kind: "builtin", id: "ideall" },
          health: "active",
          desired: true,
        }),
      ]),
    }),
  )
  assert.match(builtin, /不能在此卸载或撤销信任/)
  assert.doesNotMatch(builtin, />卸载</)
})
