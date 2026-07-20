import assert from "node:assert/strict"
import { test } from "node:test"
import { isValidElement, type ReactElement } from "react"
import {
  SETTINGS_FILE_SYSTEM_ID,
  SETTINGS_ROOT_MEDIA_TYPE,
  SETTINGS_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import { settingsManifest } from "./manifest"

test("settings manifest atomically contributes the settings filesystem and exact-root Display", async () => {
  const factory = settingsManifest.runtimeExtensionFactory
  assert.equal(factory.id, "ideall.settings")
  assert.equal(factory.version, 1)
  assert.equal(factory.digest, "builtin/ideall.settings/v1")

  const contribution = factory.create()
  assert.equal(contribution.fileSystems.length, 1)
  assert.equal(contribution.engines.length, 1)

  const fileSystem = contribution.fileSystems[0]
  assert.equal(fileSystem.provider.descriptor.fileSystemId, SETTINGS_FILE_SYSTEM_ID)
  assert.deepEqual(fileSystem.provider.descriptor.root, SETTINGS_ROOT_REF)
  assert.equal(fileSystem.mount.properties.navigationHidden, true)

  const root = await fileSystem.provider.stat(SETTINGS_ROOT_REF, {
    actor: "ui",
    permissions: [],
    intent: "metadata",
  })
  assert.ok(root)
  assert.equal(root.mediaType, SETTINGS_ROOT_MEDIA_TYPE)
  assert.equal(root.properties?.settingsRoot, true)

  const engine = contribution.engines[0]
  assert.equal(engine.descriptor.engineId, "ideall.settings")
  assert.deepEqual(engine.descriptor.match?.kinds, ["directory"])
  assert.deepEqual(engine.descriptor.match?.mediaTypes, [SETTINGS_ROOT_MEDIA_TYPE])
  assert.deepEqual(engine.descriptor.match?.properties, { settingsRoot: true })

  const display = engine.renderer({ file: root, descriptor: engine.descriptor })
  assert.ok(isValidElement(display))
  assert.notEqual((display as ReactElement).type, "div")

  const lookalike = { ...root, ref: { ...root.ref, fileId: "lookalike-root" } }
  const guarded = engine.renderer({ file: lookalike, descriptor: engine.descriptor })
  assert.ok(isValidElement(guarded))
  assert.equal((guarded as ReactElement).type, "div")
})
