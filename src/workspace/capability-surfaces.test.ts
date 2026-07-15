import assert from "node:assert/strict"
import { test } from "node:test"
import { fileRefKey } from "@protocol/file-system"
import {
  CAPABILITY_SURFACES,
  capabilitySurfaceForLegacyPanel,
  capabilitySurfaceForPath,
  capabilitySurfaceForRef,
  capabilitySurfaceForStaticKind,
} from "./capability-surfaces"

test("capability surfaces: 可见管理能力一一映射到真实文件与语义 Engine", () => {
  assert.deepEqual(
    CAPABILITY_SURFACES.map((surface) => ({
      id: surface.id,
      ref: fileRefKey(surface.ref),
      engineId: surface.engineId,
      staticKind: surface.legacyStaticKind,
      module: surface.module,
      rootId: surface.rootId,
      navigationPath: surface.navigationPath,
    })),
    [
      {
        id: "agent-spaces",
        ref: "app.agent-config:config%3Aworkspaces",
        engineId: "ideall.agent-spaces",
        staticKind: "agent-spaces",
        module: "agent",
        rootId: "activity",
        navigationPath: "/activity/spaces",
      },
      {
        id: "agent-tasks",
        ref: "app.agent-config:config%3Atasks",
        engineId: "ideall.agent-tasks",
        staticKind: "agent-task-list",
        module: "agent",
        rootId: "activity",
        navigationPath: "/activity/tasks",
      },
      {
        id: "settings",
        ref: "app.settings:root",
        engineId: "ideall.settings",
        staticKind: "home-settings",
        module: "home",
        rootId: "settings",
        navigationPath: "/settings/basic",
      },
      {
        id: "agent-settings",
        ref: "app.agent-config:config%3Asettings",
        engineId: "ideall.agent-settings",
        staticKind: "ai-settings",
        module: "agent",
        rootId: "settings",
        navigationPath: "/settings/ai",
      },
    ],
  )
})

test("capability surfaces: 旧 panel/static 仅作为真实文件 alias", () => {
  const fixtures = [
    ["spaces", "agent-spaces", "agent-spaces"],
    ["tasks", "agent-task-list", "agent-tasks"],
    ["settings", "home-settings", "settings"],
    ["ai-settings", "ai-settings", "agent-settings"],
  ] as const

  for (const [panelId, staticKind, surfaceId] of fixtures) {
    const surface = capabilitySurfaceForLegacyPanel({
      fileSystemId: "ideall.core",
      fileId: `panel:${panelId}`,
    })
    assert.equal(surface?.id, surfaceId)
    assert.equal(capabilitySurfaceForStaticKind(staticKind)?.id, surfaceId)
    assert.equal(capabilitySurfaceForRef(surface!.ref)?.id, surfaceId)
  }

  assert.equal(
    capabilitySurfaceForLegacyPanel({
      fileSystemId: "ideall.core",
      fileId: "panel:ai-mcp",
    }),
    null,
  )
})

test("capability surfaces: 规范路径、后代路径与旧 URL 的匹配边界明确", () => {
  const fixtures = [
    ["/activity/spaces", "/activity/spaces/item", null, "agent-spaces"],
    ["/activity/tasks", "/activity/tasks/item", null, "agent-tasks"],
    ["/settings/basic", "/settings/basic/item", "/home/settings", "settings"],
    ["/settings/ai", "/settings/ai/item", "/ai", "agent-settings"],
  ] as const

  for (const [canonical, descendant, legacy, surfaceId] of fixtures) {
    assert.equal(capabilitySurfaceForPath(canonical)?.id, surfaceId)
    assert.equal(capabilitySurfaceForPath(descendant)?.id, surfaceId)
    if (legacy) assert.equal(capabilitySurfaceForPath(legacy)?.id, surfaceId)
  }

  assert.equal(capabilitySurfaceForPath("/activity/spaceship"), null)
  assert.equal(capabilitySurfaceForPath("/settings/advanced"), null)
  assert.equal(capabilitySurfaceForPath("/ai-mcp"), null)
})
