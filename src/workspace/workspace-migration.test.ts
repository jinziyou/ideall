import { test } from "node:test"
import assert from "node:assert/strict"
import { resourceKey } from "@protocol/resource"
import { fileRefKey } from "@protocol/file-system"
import { parseFileEngineTabParams } from "./file-tab"
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
    ref: { fileSystemId: "ideall.core", fileId: "panel:settings" },
    engineId: "ideall.panel",
  })
  assert.equal(settings?.rootId, "settings")

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
