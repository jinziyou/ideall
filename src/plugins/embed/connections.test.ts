// 已连接嵌入应用注册表单测 (node:test + tsx): 登记/快照/吊销/卸载语义。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  registerConnection,
  revokeConnection,
  getConnectionsSnapshot,
  type EmbedConnection,
} from "./connections"

function conn(id: string, grantedAt: number, onRevoke: () => void): EmbedConnection {
  return {
    id,
    appId: "app",
    name: id.toUpperCase(),
    origin: `https://${id}`,
    permissions: ["fs:read"],
    grantedAt,
    revoke: onRevoke,
  }
}

test("registerConnection: 进快照(按 grantedAt 排序); deregister 移除且不触发 revoke (卸载≠吊销)", () => {
  let revoked = 0
  const deregB = registerConnection(conn("b", 2, () => revoked++))
  const deregA = registerConnection(conn("a", 1, () => revoked++))
  const snap = getConnectionsSnapshot()
  assert.deepEqual(
    snap.map((c) => c.id),
    ["a", "b"],
    "按 grantedAt 升序",
  )
  deregA()
  deregB()
  assert.equal(getConnectionsSnapshot().length, 0)
  assert.equal(revoked, 0, "卸载不调 revoke")
})

test("revokeConnection: 调 revoke 且移出快照; 重复/未知 id 安全 no-op", () => {
  let revoked = 0
  registerConnection(conn("x", 1, () => revoked++))
  revokeConnection("x")
  assert.equal(revoked, 1)
  assert.equal(getConnectionsSnapshot().length, 0)
  revokeConnection("x") // 已撤 → 不再调
  revokeConnection("zzz") // 未知 → 安全
  assert.equal(revoked, 1)
})

test("空集快照为稳定引用 (useSyncExternalStore 要求)", () => {
  const e1 = getConnectionsSnapshot()
  const dereg = registerConnection(conn("c", 1, () => {}))
  dereg()
  const e2 = getConnectionsSnapshot()
  assert.equal(e1, e2, "回到空集时为同一引用, 不致无限重渲染")
})
