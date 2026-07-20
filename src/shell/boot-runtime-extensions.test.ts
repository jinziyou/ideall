import assert from "node:assert/strict"
import { test } from "node:test"
import type { RuntimeExtensionFactory, RuntimeExtensionHost } from "./runtime-extensions"
import { RuntimeExtensionCatalog, RuntimeExtensionRegistry } from "./runtime-extensions"
import {
  activateBundledRuntimeExtensions,
  bundledRuntimeExtensionFactories,
  discoverBundledRuntimeExtensions,
} from "./boot-runtime-extensions"

function memoryRuntimeHost(): RuntimeExtensionHost {
  return {
    batch: (operation) => operation(),
    mountFileSystem: () => () => {},
    registerEngine: () => () => {},
  }
}

function failingBuiltinFactory(): RuntimeExtensionFactory {
  return {
    id: "test.broken-builtin",
    label: "Broken builtin",
    version: 1,
    source: { kind: "builtin", id: "test" },
    digest: "test/broken/v1",
    permissionDigest: "test/broken/permissions/v1",
    permissions: [],
    create() {
      return {
        id: "test.broken-builtin",
        label: "Broken builtin",
        activate() {
          throw new Error("activation failed")
        },
      }
    },
  }
}

test("boot runtime extensions discover and activate apps, settings and agent", async () => {
  assert.deepEqual(
    bundledRuntimeExtensionFactories.map(({ id }) => id),
    ["ideall.installed-apps", "ideall.settings", "ideall.agent-config", "ideall.display"],
  )

  const registry = new RuntimeExtensionRegistry(memoryRuntimeHost())
  const catalog = new RuntimeExtensionCatalog(registry)
  const undiscover = discoverBundledRuntimeExtensions(catalog)
  catalog.hydrate()

  const results = await activateBundledRuntimeExtensions(catalog)
  assert.deepEqual(
    results,
    bundledRuntimeExtensionFactories.map(({ id }) => ({ id, active: true })),
  )
  assert.deepEqual(
    registry.list().map(({ id }) => id),
    ["ideall.agent-config", "ideall.display", "ideall.installed-apps", "ideall.settings"],
  )
  for (const factory of bundledRuntimeExtensionFactories) {
    assert.equal(catalog.state(factory.id)?.health, "active")
  }

  await registry.clear()
  undiscover()
})

test("boot runtime extension activation isolates one failing factory", async () => {
  const registry = new RuntimeExtensionRegistry(memoryRuntimeHost())
  const catalog = new RuntimeExtensionCatalog(registry)
  const broken = failingBuiltinFactory()
  const factories = [
    bundledRuntimeExtensionFactories[0],
    broken,
    bundledRuntimeExtensionFactories[1],
  ] as const
  const undiscover = discoverBundledRuntimeExtensions(catalog, factories)

  assert.deepEqual(await activateBundledRuntimeExtensions(catalog, factories), [
    { id: "ideall.installed-apps", active: true },
    { id: "test.broken-builtin", active: false },
    { id: "ideall.settings", active: true },
  ])
  assert.equal(catalog.state(broken.id)?.health, "degraded")
  assert.match(String(catalog.failure(broken.id)), /activation failed/)
  assert.equal(registry.has("ideall.installed-apps"), true)
  assert.equal(registry.has("ideall.settings"), true)

  await registry.clear()
  undiscover()
})

test("boot runtime extension discovery rolls back earlier factories atomically", () => {
  const registry = new RuntimeExtensionRegistry(memoryRuntimeHost())
  const catalog = new RuntimeExtensionCatalog(registry)
  const apps = bundledRuntimeExtensionFactories[0]
  const settings = bundledRuntimeExtensionFactories[1]

  assert.throws(
    () => discoverBundledRuntimeExtensions(catalog, [apps, settings, apps]),
    /already discovered/,
  )
  assert.equal(catalog.state(apps.id), null)
  assert.equal(catalog.state(settings.id), null)
  assert.deepEqual(registry.list(), [])
})
