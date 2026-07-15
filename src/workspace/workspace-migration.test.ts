import { test } from "node:test"
import assert from "node:assert/strict"
import { resourceKey } from "@protocol/resource"
import { fileRefKey } from "@protocol/file-system"
import { fileEnginePath, parseFileEngineTabParams } from "./file-tab"
import { migrateWorkspaceTab, migrateWorkspaceTabs } from "./store"
import type { Tab } from "./types"
import { BUILTIN_APP_SURFACES } from "./file-roots"

test("workspace migration: legacy node and resource tabs become file + engine tabs", () => {
  const legacyNode: Tab = {
    id: "node:note:n1",
    kind: "node",
    module: "home",
    title: "Note",
    params: { kind: "note", id: "n1" },
  }
  const note = migrateWorkspaceTab(legacyNode)
  assert.equal(note?.kind, "file-engine")
  assert.deepEqual(parseFileEngineTabParams(note?.params), {
    ref: { fileSystemId: "ideall.core", fileId: "resource:node%3Anote%3An1" },
    engineId: "ideall.note",
  })

  const browserRef = { scheme: "browser", kind: "page", id: "https://example.com" } as const
  const legacyResource: Tab = {
    id: "resource:browser",
    kind: "resource",
    module: "browser",
    title: "Example",
    params: { resource: resourceKey(browserRef) },
  }
  const browser = migrateWorkspaceTab(legacyResource)
  assert.equal(parseFileEngineTabParams(browser?.params)?.engineId, "ideall.browser")
  assert.equal(browser?.rootId, "browse")
})

test("workspace migration: legacy node kinds restore their navigation sections", () => {
  const roots = {
    note: "home",
    bookmark: "home",
    folder: "home",
    file: "home",
    feed: "home",
    thread: "activity",
  } as const

  for (const [kind, rootId] of Object.entries(roots)) {
    const migrated = migrateWorkspaceTab({
      id: `node:${kind}:fixture`,
      kind: "node",
      module: kind === "feed" ? "subscriptions" : "home",
      title: kind,
      params: { kind, id: "fixture" },
    })
    assert.equal(migrated?.rootId, rootId, kind)
  }
})

test("workspace migration: tabs are deduplicated after their ids are canonicalized", () => {
  const ref = { scheme: "node", kind: "note", id: "same" } as const
  const legacyNode: Tab = {
    id: "node:note:same",
    kind: "node",
    module: "home",
    title: "Node snapshot",
    params: { kind: "note", id: "same" },
  }
  const legacyResource: Tab = {
    id: "resource:node-note-same",
    kind: "resource",
    module: "home",
    title: "Resource snapshot",
    params: { resource: resourceKey(ref) },
  }

  const migrated = migrateWorkspaceTabs([legacyNode, legacyResource])
  assert.equal(migrated.tabs.length, 1)
  assert.equal(migrated.tabs[0]?.kind, "file-engine")
  assert.equal(migrated.tabs[0]?.rootId, "home")
  assert.equal(migrated.idMap.get(legacyNode.id), migrated.tabs[0]?.id)
  assert.equal(migrated.idMap.get(legacyResource.id), migrated.tabs[0]?.id)
})

test("workspace migration: malformed file-engine snapshots are discarded", () => {
  assert.equal(
    migrateWorkspaceTab({
      id: "bad",
      kind: "file-engine",
      module: "home",
      title: "bad",
      params: { file: "broken" },
    }),
    null,
  )
})

test("workspace migration: legacy static panels and AI tasks become file-engine tabs", () => {
  const settings = migrateWorkspaceTab({
    id: "home-settings",
    kind: "home-settings",
    module: "home",
    title: "设置",
  })
  assert.deepEqual(parseFileEngineTabParams(settings?.params), {
    ref: { fileSystemId: "app.settings", fileId: "root" },
    engineId: "ideall.settings",
  })
  assert.equal(settings?.rootId, "settings")
  assert.equal(settings?.path, "/settings/basic")
  assert.equal(settings?.navigationPath, "/settings/basic")

  const tasks = migrateWorkspaceTab({
    id: "ai-tasks:old",
    kind: "ai-tasks",
    module: "agent",
    title: "Project tasks",
    params: { workspaceId: "project/a" },
  })
  assert.deepEqual(parseFileEngineTabParams(tasks?.params), {
    ref: { fileSystemId: "ideall.core", fileId: "panel:ai-tasks:project%2Fa" },
    engineId: "ideall.panel-fill",
  })
  assert.equal(tasks?.rootId, "activity")
})

test("workspace migration: legacy capability panels and static tabs converge on real files", () => {
  const fixtures = [
    {
      staticKind: "agent-spaces",
      panelId: "spaces",
      ref: { fileSystemId: "app.agent-config", fileId: "config:workspaces" },
      engineId: "ideall.agent-spaces",
      module: "agent",
      rootId: "activity",
      navigationPath: "/activity/spaces",
    },
    {
      staticKind: "agent-task-list",
      panelId: "tasks",
      ref: { fileSystemId: "app.agent-config", fileId: "config:tasks" },
      engineId: "ideall.agent-tasks",
      module: "agent",
      rootId: "activity",
      navigationPath: "/activity/tasks",
    },
    {
      staticKind: "home-settings",
      panelId: "settings",
      ref: { fileSystemId: "app.settings", fileId: "root" },
      engineId: "ideall.settings",
      module: "home",
      rootId: "settings",
      navigationPath: "/settings/basic",
      legacyPath: "/home/settings",
    },
    {
      staticKind: "ai-settings",
      panelId: "ai-settings",
      ref: { fileSystemId: "app.agent-config", fileId: "config:settings" },
      engineId: "ideall.agent-settings",
      module: "agent",
      rootId: "settings",
      navigationPath: "/settings/ai",
      legacyPath: "/ai",
    },
  ] as const

  for (const fixture of fixtures) {
    const legacyStatic: Tab = {
      id: `static:${fixture.staticKind}`,
      kind: fixture.staticKind,
      module: fixture.module,
      title: `static ${fixture.panelId}`,
    }
    const legacyPanel: Tab = {
      id: `panel:${fixture.panelId}`,
      kind: "file-engine",
      module: "home",
      title: `panel ${fixture.panelId}`,
      params: {
        file: fileRefKey({
          fileSystemId: "ideall.core",
          fileId: `panel:${fixture.panelId}`,
        }),
        engine: "ideall.panel",
      },
      rootId: "system",
      navigationPath: "legacyPath" in fixture ? fixture.legacyPath : undefined,
    }
    const canonical: Tab = {
      id: `canonical:${fixture.panelId}`,
      kind: "file-engine",
      module: fixture.module,
      title: `canonical ${fixture.panelId}`,
      params: {
        file: fileRefKey(fixture.ref),
        engine: fixture.engineId,
      },
      rootId: fixture.rootId,
      navigationPath: fixture.navigationPath,
    }
    const staleCanonicalEngine: Tab = {
      ...canonical,
      id: `stale-engine:${fixture.panelId}`,
      params: { file: fileRefKey(fixture.ref), engine: "ideall.panel-fill" },
    }

    const migrated = [legacyStatic, legacyPanel, canonical, staleCanonicalEngine].map((tab) =>
      migrateWorkspaceTab(tab),
    )
    for (const tab of migrated) {
      assert.deepEqual(parseFileEngineTabParams(tab?.params), {
        ref: fixture.ref,
        engineId: fixture.engineId,
      })
      assert.equal(tab?.module, fixture.module)
      assert.equal(tab?.rootId, fixture.rootId)
      assert.equal(tab?.path, fixture.navigationPath)
      assert.equal(tab?.navigationPath, fixture.navigationPath)
    }
    assert.equal(new Set(migrated.map((tab) => tab?.id)).size, 1)

    const deduplicated = migrateWorkspaceTabs([
      legacyStatic,
      legacyPanel,
      canonical,
      staleCanonicalEngine,
    ])
    assert.equal(deduplicated.tabs.length, 1, fixture.panelId)
  }
})

test("workspace migration: legacy app panels become their real FileSystem roots", () => {
  for (const id of ["database", "git", "audio"] as const) {
    const surface = BUILTIN_APP_SURFACES[id]
    const legacyStatic = migrateWorkspaceTab({
      id,
      kind: id,
      module: surface.module,
      title: id,
    })
    assert.deepEqual(parseFileEngineTabParams(legacyStatic?.params), {
      ref: surface.ref,
      engineId: surface.engineId,
    })
    assert.equal(legacyStatic?.rootId, "apps")

    const legacyFileEngine = migrateWorkspaceTab({
      id: `file-engine:${id}`,
      kind: "file-engine",
      module: surface.module,
      title: id,
      params: {
        file: fileRefKey({ fileSystemId: "ideall.core", fileId: `panel:${id}` }),
        engine: surface.engineId,
      },
      rootId: "system",
    })
    assert.deepEqual(parseFileEngineTabParams(legacyFileEngine?.params), {
      ref: surface.ref,
      engineId: surface.engineId,
    })
    assert.equal(legacyFileEngine?.rootId, "apps")
  }
})

test("workspace migration: legacy directory panels and static tabs converge on one semantic root tab", () => {
  const fixtures = [
    {
      staticKind: "subscriptions",
      panelId: "subscriptions",
      ref: { fileSystemId: "ideall.core", fileId: "place:subscriptions" },
      engineId: "ideall.subscriptions",
      module: "subscriptions",
      rootId: "home",
      oldPath: "/home/subscriptions",
      navigationPath: "/home/following",
    },
    {
      staticKind: "home-bookmarks",
      panelId: "bookmarks",
      ref: { fileSystemId: "ideall.core", fileId: "place:bookmarks" },
      engineId: "ideall.bookmarks",
      module: "home",
      rootId: "home",
      oldPath: "/home/bookmarks",
      navigationPath: "/home/bookmarks",
    },
    {
      staticKind: "home-resources",
      panelId: "files",
      ref: { fileSystemId: "ideall.core", fileId: "place:files" },
      engineId: "ideall.resources",
      module: "home",
      rootId: "home",
      oldPath: "/home/resources",
      navigationPath: "/home/resources",
    },
    {
      staticKind: "trash",
      panelId: "trash",
      ref: { fileSystemId: "ideall.trash", fileId: "root" },
      engineId: "ideall.trash",
      module: "trash",
      rootId: "activity",
      oldPath: "/trash",
      navigationPath: "/activity/deleted",
    },
    {
      staticKind: "apps",
      panelId: "apps",
      ref: { fileSystemId: "third-party.installed-apps", fileId: "root" },
      engineId: "ideall.installed-apps",
      module: "apps",
      rootId: "apps",
      oldPath: "/apps",
      navigationPath: "/apps/local-apps",
    },
  ] as const

  for (const fixture of fixtures) {
    const legacyStatic: Tab = {
      id: `static:${fixture.staticKind}`,
      kind: fixture.staticKind,
      module: fixture.module,
      title: `static ${fixture.panelId}`,
    }
    const legacyPanel: Tab = {
      id: `panel:${fixture.panelId}`,
      kind: "file-engine",
      module: "home",
      title: `panel ${fixture.panelId}`,
      params: {
        file: fileRefKey({
          fileSystemId: "ideall.core",
          fileId: `panel:${fixture.panelId}`,
        }),
        engine: "ideall.panel",
      },
      rootId: "settings",
      navigationPath: fixture.oldPath,
    }
    const canonical: Tab = {
      id: `canonical:${fixture.panelId}`,
      kind: "file-engine",
      module: fixture.module,
      title: `canonical ${fixture.panelId}`,
      params: {
        file: fileRefKey(fixture.ref),
        engine: fixture.engineId,
      },
      rootId: fixture.rootId,
      navigationPath: fixture.navigationPath,
    }
    const staleCanonicalEngine: Tab = {
      ...canonical,
      id: `stale-engine:${fixture.panelId}`,
      params: {
        file: fileRefKey(fixture.ref),
        engine: "ideall.panel",
      },
    }

    const migratedStatic = migrateWorkspaceTab(legacyStatic)
    const migratedPanel = migrateWorkspaceTab(legacyPanel)
    const migratedCanonical = migrateWorkspaceTab(canonical)
    const migratedStaleEngine = migrateWorkspaceTab(staleCanonicalEngine)
    for (const migrated of [
      migratedStatic,
      migratedPanel,
      migratedCanonical,
      migratedStaleEngine,
    ]) {
      assert.deepEqual(parseFileEngineTabParams(migrated?.params), {
        ref: fixture.ref,
        engineId: fixture.engineId,
      })
      assert.equal(migrated?.module, fixture.module)
      assert.equal(migrated?.rootId, fixture.rootId)
      assert.equal(migrated?.path, fixture.navigationPath)
      assert.equal(migrated?.navigationPath, fixture.navigationPath)
    }
    assert.equal(migratedStatic?.id, migratedPanel?.id)
    assert.equal(migratedPanel?.id, migratedCanonical?.id)
    assert.equal(migratedCanonical?.id, migratedStaleEngine?.id)

    const deduplicated = migrateWorkspaceTabs([
      legacyStatic,
      legacyPanel,
      canonical,
      staleCanonicalEngine,
    ])
    assert.equal(deduplicated.tabs.length, 1, fixture.panelId)
    assert.equal(deduplicated.idMap.get(legacyStatic.id), deduplicated.tabs[0]?.id)
    assert.equal(deduplicated.idMap.get(legacyPanel.id), deduplicated.tabs[0]?.id)
    assert.equal(deduplicated.idMap.get(canonical.id), deduplicated.tabs[0]?.id)
    assert.equal(deduplicated.idMap.get(staleCanonicalEngine.id), deduplicated.tabs[0]?.id)
  }
})

test("workspace migration: canonical tabs use their file to disambiguate the old system root", () => {
  const fixtures = [
    { panel: "settings", module: "home", expected: "settings" },
    { panel: "trash", module: "trash", expected: "activity" },
    { panel: "code", module: "code", expected: "apps" },
  ] as const

  for (const fixture of fixtures) {
    const migrated = migrateWorkspaceTab({
      id: `legacy-system:${fixture.panel}`,
      kind: "file-engine",
      module: fixture.module,
      title: fixture.panel,
      params: {
        file: fileRefKey({ fileSystemId: "ideall.core", fileId: `panel:${fixture.panel}` }),
        engine: "ideall.panel",
      },
      rootId: "system",
    })
    assert.equal(migrated?.rootId, fixture.expected, fixture.panel)
  }
})

test("workspace migration: directory navigation path is canonicalized and never changes tab identity", () => {
  const base: Tab = {
    id: "legacy-bookmarks",
    kind: "file-engine",
    module: "home",
    title: "书签",
    params: {
      file: fileRefKey({ fileSystemId: "ideall.core", fileId: "panel:bookmarks" }),
      engine: "ideall.panel",
    },
    rootId: "home",
    navigationPath: "//home/./bookmarks",
  }
  const migrated = migrateWorkspaceTab(base)
  assert.deepEqual(parseFileEngineTabParams(migrated?.params), {
    ref: { fileSystemId: "ideall.core", fileId: "place:bookmarks" },
    engineId: "ideall.bookmarks",
  })
  assert.equal(migrated?.navigationPath, "/home/bookmarks")
  assert.equal(migrated?.id, migrateWorkspaceTab({ ...base, navigationPath: "/home/files" })?.id)
  assert.equal(
    migrateWorkspaceTab({ ...base, navigationPath: "/../outside" })?.navigationPath,
    "/home/bookmarks",
  )
})

test("workspace migration: alternate Engine on a directory root keeps a full FileRef deep link", () => {
  const ref = { fileSystemId: "ideall.core", fileId: "place:bookmarks" }
  const migrated = migrateWorkspaceTab({
    id: "bookmarks-directory-view",
    kind: "file-engine",
    module: "home",
    title: "书签",
    path: "/home/bookmarks",
    params: {
      file: fileRefKey(ref),
      engine: "ideall.directory",
    },
    rootId: "home",
    navigationPath: "/home/bookmarks",
  })

  assert.equal(migrated?.path, fileEnginePath(ref, "ideall.directory"))
  assert.equal(migrated?.navigationPath, "/home/bookmarks")
  assert.deepEqual(parseFileEngineTabParams(migrated?.params), {
    ref,
    engineId: "ideall.directory",
  })
})
