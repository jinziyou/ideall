import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { RuntimeExtensionSettingsDocument } from "./settings-contract"
import {
  RuntimeExtensionsPanel,
  runtimeExtensionActionPolicy,
  runtimeExtensionFailureMessage,
  runtimeExtensionHealthPresentation,
  runtimeExtensionSourceLabel,
} from "./runtime-extensions-panel"

function state(
  patch: Partial<RuntimeExtensionSettingsDocument> = {},
): RuntimeExtensionSettingsDocument {
  return {
    id: "example.extension",
    label: "Example",
    version: 2,
    source: { kind: "package", id: "example.pkg" },
    publisherFingerprint: `sha256:${"A".repeat(43)}`,
    permissions: ["fs:read"],
    digest: "digest",
    permissionDigest: "permissions",
    verification: { verifierId: "host-verifier", verifiedAt: 1 },
    grantedAt: 2,
    desired: true,
    health: "active",
    failure: null,
    pendingCleanup: [],
    rollbackVersion: null,
    ...patch,
  }
}

const onAction = async () => true

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
    runtimeExtensionActionPolicy(state({ health: "consent-required", desired: false })),
    { authorize: true, retry: false, revoke: false, uninstall: true },
  )
  assert.deepEqual(
    runtimeExtensionActionPolicy(
      state({ source: { kind: "builtin", id: "ideall.apps" }, health: "ready", desired: false }),
    ),
    { authorize: false, retry: true, revoke: false, uninstall: false },
  )
  assert.deepEqual(
    runtimeExtensionActionPolicy(
      state({
        source: { kind: "builtin", id: "ideall.apps" },
        health: "active",
        desired: true,
      }),
    ),
    { authorize: false, retry: false, revoke: false, uninstall: false },
  )
  assert.deepEqual(
    runtimeExtensionActionPolicy(state({ health: "consent-required", desired: true })),
    { authorize: false, retry: true, revoke: true, uninstall: true },
  )
  assert.deepEqual(
    runtimeExtensionActionPolicy(state({ source: null, health: "unavailable", permissions: [] })),
    { authorize: false, retry: false, revoke: false, uninstall: true },
  )
  assert.deepEqual(runtimeExtensionActionPolicy(state({ health: "revocation-failed" })), {
    authorize: false,
    retry: false,
    revoke: true,
    uninstall: false,
  })
  assert.deepEqual(
    runtimeExtensionActionPolicy(
      state({ source: null, desired: false, health: "rejected", permissions: [] }),
    ),
    { authorize: false, retry: false, revoke: false, uninstall: false },
  )
})

test("runtime extensions panel: renders controlled empty, permission and quarantine diagnostics", () => {
  const empty = renderToStaticMarkup(
    createElement(RuntimeExtensionsPanel, { extensions: [], onAction }),
  )
  assert.match(empty, /暂无运行时扩展/)

  const populated = renderToStaticMarkup(
    createElement(RuntimeExtensionsPanel, {
      extensions: [
        state({
          health: "quarantined",
          failure: "socket cleanup failed",
          pendingCleanup: ["lifecycle", "filesystem:remote"],
        }),
      ],
      onAction,
    }),
  )
  assert.match(populated, /Example/)
  assert.match(populated, /fs:read/)
  assert.match(populated, /已隔离/)
  assert.match(populated, /socket cleanup failed/)
  assert.match(populated, /filesystem:remote/)
  assert.match(populated, /host-verifier/)
  assert.match(populated, /已恢复/)

  const consent = renderToStaticMarkup(
    createElement(RuntimeExtensionsPanel, {
      extensions: [
        state({
          desired: false,
          health: "consent-required",
          verification: null,
          grantedAt: null,
        }),
      ],
      onAction,
    }),
  )
  assert.match(consent, /尚未验证/)
  assert.match(consent, /验证并授权/)

  const builtin = renderToStaticMarkup(
    createElement(RuntimeExtensionsPanel, {
      extensions: [
        state({
          source: { kind: "builtin", id: "ideall" },
          health: "active",
          desired: true,
        }),
      ],
      onAction,
    }),
  )
  assert.match(builtin, /不能在此卸载或撤销信任/)
  assert.doesNotMatch(builtin, />卸载</)

  const rejected = renderToStaticMarkup(
    createElement(RuntimeExtensionsPanel, {
      extensions: [
        state({
          id: "rejected:bad.connector",
          label: "bad.connector",
          version: 0,
          source: null,
          permissions: [],
          desired: false,
          health: "rejected",
          failure: "signature-rejected",
        }),
      ],
      onAction,
    }),
  )
  assert.match(rejected, /包已拒绝/)
  assert.match(rejected, /signature-rejected/)
  assert.doesNotMatch(rejected, /验证并授权/)
})

test("runtime extensions panel: exposes native publisher, revocation and rollback controls", () => {
  const markup = renderToStaticMarkup(
    createElement(RuntimeExtensionsPanel, {
      extensions: [state({ rollbackVersion: 1 })],
      publishers: [
        {
          publisher: "acme.tools",
          label: "Acme Tools",
          fingerprint: `sha256:${"B".repeat(43)}`,
          status: "trusted",
          trustedAt: 1,
          revokedAt: null,
          revocationSequence: 4,
          revocationIssuedAt: 2,
          revokedDigestCount: 3,
          keySequence: 2,
          rotatedAt: 3,
          retiredKeyCount: 1,
        },
      ],
      nativeAvailable: true,
      registry: {
        status: "current",
        source: "network",
        fetchedAt: 200,
        generatedAt: 100,
        expiresAt: 300,
        sequence: 2,
        failureCode: null,
        entries: [
          {
            id: "example.extension",
            label: "Acme Search",
            summary: "Search local resources.",
            version: 3,
            publisher: "acme.tools",
            publisherFingerprint: `sha256:${"B".repeat(43)}`,
            permissions: ["resources:read"],
            digest: `sha256:${"C".repeat(43)}`,
            packageUrl: "https://downloads.example.test/acme.search.ideall-extension",
            packageSha256: "a".repeat(64),
            publishedAt: 90,
          },
        ],
      },
      onAction,
      onManagement: async () => ({ changed: true }),
    }),
  )
  assert.match(markup, /安装 \/ 更新签名包/)
  assert.match(markup, /联网扩展目录/)
  assert.match(markup, /已联网验签/)
  assert.match(markup, /Acme Search/)
  assert.match(markup, /下载并检查更新/)
  assert.match(markup, /导入 publisher 根/)
  assert.match(markup, /导入密钥轮换/)
  assert.match(markup, /导入撤销清单/)
  assert.match(markup, /Acme Tools/)
  assert.match(markup, /撤销根信任/)
  assert.match(markup, /密钥序列 2/)
  assert.match(markup, /已退役密钥 1/)
  assert.match(markup, /回滚至 v1/)
})
