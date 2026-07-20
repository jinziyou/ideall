import assert from "node:assert/strict"
import { test } from "node:test"
import { fileRefKey } from "@protocol/file-system"
import {
  DIRECTORY_SURFACES,
  directorySurfaceForLegacyPanel,
  directorySurfaceForPath,
  directorySurfaceForRef,
} from "./directory-surfaces"

test("directory surfaces: 真实 root、语义 Engine 与工作区位置保持一一对应", () => {
  assert.deepEqual(
    DIRECTORY_SURFACES.map((surface) => ({
      id: surface.id,
      ref: fileRefKey(surface.ref),
      engineId: surface.engineId,
      module: surface.module,
      rootId: surface.rootId,
      navigationPath: surface.navigationPath,
    })),
    [
      {
        id: "subscriptions",
        ref: "ideall.core:place%3Asubscriptions",
        engineId: "ideall.subscriptions",
        module: "subscriptions",
        rootId: "home",
        navigationPath: "/home/following",
      },
      {
        id: "bookmarks",
        ref: "ideall.core:place%3Abookmarks",
        engineId: "ideall.bookmarks",
        module: "home",
        rootId: "home",
        navigationPath: "/home/bookmarks",
      },
      {
        id: "resources",
        ref: "ideall.core:place%3Afiles",
        engineId: "ideall.resources",
        module: "home",
        rootId: "home",
        navigationPath: "/home/resources",
      },
      {
        id: "trash",
        ref: "ideall.trash:root",
        engineId: "ideall.trash",
        module: "trash",
        rootId: "activity",
        navigationPath: "/activity/deleted",
      },
      {
        id: "installed-apps",
        ref: "third-party.installed-apps:root",
        engineId: "ideall.installed-apps",
        module: "apps",
        rootId: "apps",
        navigationPath: "/apps/local-apps",
      },
    ],
  )
})

test("directory surfaces: 旧 panel FileRef 只作为指向真实 root 的 alias", () => {
  const fixtures = [
    ["subscriptions", "subscriptions"],
    ["bookmarks", "bookmarks"],
    ["files", "resources"],
    ["trash", "trash"],
    ["apps", "installed-apps"],
  ] as const

  for (const [panelId, surfaceId] of fixtures) {
    const surface = directorySurfaceForLegacyPanel({
      fileSystemId: "ideall.core",
      fileId: `panel:${panelId}`,
    })
    assert.equal(surface?.id, surfaceId)
    assert.equal(directorySurfaceForRef(surface!.ref)?.id, surfaceId)
  }

  assert.equal(
    directorySurfaceForLegacyPanel({
      fileSystemId: "ideall.core",
      fileId: "panel:settings",
    }),
    null,
  )
  assert.equal(
    directorySurfaceForRef({ fileSystemId: "ideall.core", fileId: "panel:bookmarks" }),
    null,
  )
})

test("directory surfaces: 新深链、规范后代路径和旧 alias 的匹配边界明确", () => {
  const fixtures = [
    ["/home/following", "/home/following/item", "/home/subscriptions", "subscriptions"],
    ["/home/bookmarks", "/home/bookmarks/item", null, "bookmarks"],
    ["/home/resources", "/home/resources/item", null, "resources"],
    ["/activity/deleted", "/activity/deleted/item", "/trash", "trash"],
    ["/apps/local-apps", "/apps/local-apps/item", "/apps", "installed-apps"],
  ] as const

  for (const [canonical, descendant, legacy, surfaceId] of fixtures) {
    assert.equal(directorySurfaceForPath(canonical)?.id, surfaceId)
    assert.equal(directorySurfaceForPath(descendant)?.id, surfaceId)
    if (legacy) assert.equal(directorySurfaceForPath(legacy)?.id, surfaceId)
  }

  assert.equal(directorySurfaceForPath("/home/following-up"), null)
  assert.equal(directorySurfaceForPath("/trash/item"), null)
  assert.equal(directorySurfaceForPath("/apps-store"), null)
})
