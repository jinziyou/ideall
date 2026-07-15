// 路由 → 标签解析测试 (node:test + tsx): descriptorForPath / descriptorForResource 是深链、
// 刷新恢复与路由薄标记 (OpenWorkspaceTab) 的唯一入口, 锁定精确匹配 / 前缀回退 / 非法输入。
import { test } from "node:test"
import assert from "node:assert/strict"
import { resourceQueryValue } from "@protocol/resource"
import { resourceFileRef } from "@/filesystem/resource-file-system"
import { parseFileEngineTabParams } from "./file-tab"
import { BUILTIN_APP_SURFACES } from "./file-roots"
import { NAVIGATION_SECTIONS } from "./navigation-sections"
import { DIRECTORY_SURFACES } from "./directory-surfaces"
import { descriptorForPath, descriptorForResource, moduleById } from "./modules"

test("descriptorForPath: 根路径与 /home 落到「我的」概览", () => {
  assert.equal(descriptorForPath("/")?.kind, "home-overview")
  assert.equal(descriptorForPath("/home")?.kind, "home-overview")
  assert.equal(descriptorForPath("/home/未知子路径")?.kind, "home-overview", "home 前缀兜底")
})

test("descriptorForPath: 精确匹配各模块面板路由", () => {
  assert.equal(descriptorForPath("/home/notes")?.kind, "home-notes")
  assert.equal(descriptorForPath("/home/bookmarks")?.kind, "file-engine")
  assert.equal(descriptorForPath("/home/publications")?.module, "publications")
  const toolAi = descriptorForPath("/tool/ai")
  assert.equal(toolAi?.kind, "file-engine")
  assert.deepEqual(parseFileEngineTabParams(toolAi?.params), {
    ref: resourceFileRef({ scheme: "tool", kind: "ai", id: "default" }),
    engineId: "ideall.connected",
  })
  assert.equal(descriptorForPath("/apps")?.kind, "apps", "旧路由仍走 static 兼容读路径")
  const browser = descriptorForPath("/browser")
  assert.equal(browser?.kind, "file-engine")
  assert.deepEqual(parseFileEngineTabParams(browser?.params), {
    ref: resourceFileRef({ scheme: "browser", kind: "page", id: "default" }),
    engineId: "ideall.browser",
  })
  for (const id of ["git", "database", "audio"] as const) {
    const descriptor = descriptorForPath(`/${id}`)
    assert.equal(descriptor?.kind, "file-engine")
    assert.deepEqual(parseFileEngineTabParams(descriptor?.params), {
      ref: BUILTIN_APP_SURFACES[id].ref,
      engineId: BUILTIN_APP_SURFACES[id].engineId,
    })
  }
  assert.equal(descriptorForPath("/code")?.kind, "code")
  assert.equal(descriptorForPath("/trash")?.kind, "trash", "旧路由仍走 static 兼容读路径")
})

test("module entries: 五个目录入口只生成真实 root + 语义 Engine 的规范 descriptor", () => {
  const descriptors = [
    moduleById("subscriptions").entries[0]?.descriptor,
    moduleById("home").entries.find((entry) => entry.label === "书签")?.descriptor,
    moduleById("home").entries.find((entry) => entry.label === "资源")?.descriptor,
    moduleById("trash").entries[0]?.descriptor,
    moduleById("apps").entries[0]?.descriptor,
  ]

  assert.equal(descriptors.length, DIRECTORY_SURFACES.length)
  for (const [index, surface] of DIRECTORY_SURFACES.entries()) {
    const descriptor = descriptors[index]
    assert.ok(descriptor, surface.id)
    assert.equal(descriptor.kind, "file-engine", surface.id)
    assert.deepEqual(parseFileEngineTabParams(descriptor.params), {
      ref: surface.ref,
      engineId: surface.engineId,
    })
    assert.equal(descriptor.module, surface.module)
    assert.equal(descriptor.rootId, surface.rootId)
    assert.equal(descriptor.path, surface.navigationPath)
    assert.equal(descriptor.navigationPath, surface.navigationPath)
  }
})

test("descriptorForPath: 规范目录 URL 生成规范 file-engine descriptor，旧 URL 仍可读取", () => {
  for (const surface of DIRECTORY_SURFACES) {
    const descriptor = descriptorForPath(surface.navigationPath)
    assert.ok(descriptor, surface.id)
    assert.equal(descriptor.kind, "file-engine", surface.id)
    assert.deepEqual(parseFileEngineTabParams(descriptor.params), {
      ref: surface.ref,
      engineId: surface.engineId,
    })
    assert.equal(descriptor.path, surface.navigationPath)
    assert.equal(descriptor.navigationPath, surface.navigationPath)
  }

  assert.equal(descriptorForPath("/home/subscriptions")?.kind, "subscriptions")
  assert.equal(descriptorForPath("/apps")?.kind, "apps")
  assert.equal(descriptorForPath("/trash")?.kind, "trash")
})

test("descriptorForPath: 前缀回退", () => {
  assert.equal(descriptorForPath("/home/subscriptions?x=1".split("?")[0])?.kind, "subscriptions")
  assert.equal(descriptorForPath("/home/settings/anything")?.kind, "home-settings")
  assert.equal(descriptorForPath("/info/entity")?.kind, "info", "info 子路径回退到 info 标签")
  assert.equal(descriptorForPath("/tool/whatever")?.kind, "tool-search")
})

test("descriptorForPath: /home/agent 是虚拟命令路由 → 显式 null; 未知路径 → null; 空串兜底概览", () => {
  assert.equal(descriptorForPath("/home/agent"), null)
  assert.equal(descriptorForPath("/nonexistent"), null)
  assert.equal(descriptorForPath("")?.kind, "home-overview", "空 pathname 兜底到概览")
})

test("descriptorForResource: ?resource 优先, 兼容旧 ?node 深链", () => {
  const d = descriptorForResource("?node=note:abc123")
  assert.ok(d)
  assert.equal(d.kind, "file-engine")
  assert.deepEqual(parseFileEngineTabParams(d.params), {
    ref: resourceFileRef({ scheme: "node", kind: "note", id: "abc123" }),
    engineId: "ideall.note",
  })
  assert.ok(d.path?.startsWith("/home/notes?resource="))

  const fileRef = {
    scheme: "node",
    kind: "file",
    id: "a:b/c?d&e=f",
  } as const
  const resource = descriptorForResource(`?node=note:old&resource=${resourceQueryValue(fileRef)}`)
  assert.deepEqual(parseFileEngineTabParams(resource?.params), {
    ref: resourceFileRef(fileRef),
    engineId: "ideall.preview",
  })

  assert.equal(descriptorForResource("?node=badkind:x"), null, "非法 kind 拒收")
  const info = descriptorForResource(
    `?resource=${resourceQueryValue({ scheme: "info", kind: "entity", id: "ORG:示例" })}`,
  )
  assert.equal(info?.kind, "file-engine")
  assert.equal(info?.module, "info")
  assert.ok(info?.path?.startsWith("/info/entity?"))
  assert.ok(info?.path?.includes("resource="))
  assert.equal(descriptorForResource("?other=1"), null, "无 node 参数")
  assert.equal(descriptorForResource(""), null)
})

test("navigation sections: 五个 FileSystem 路径入口固定且同时可见", () => {
  assert.deepEqual(
    NAVIGATION_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      path: section.path,
    })),
    [
      { id: "home", label: "我的", path: "/home" },
      { id: "activity", label: "活动", path: "/activity" },
      { id: "browse", label: "浏览", path: "/browse" },
      { id: "apps", label: "应用", path: "/apps" },
      { id: "settings", label: "设置", path: "/settings" },
    ],
  )
})

test("moduleById: 未知 id 回退首个模块 (不抛错)", () => {
  assert.equal(moduleById("home").id, "home")
  assert.equal(moduleById("不存在" as never).id, "home")
})
