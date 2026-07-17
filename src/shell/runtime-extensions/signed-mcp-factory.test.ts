import assert from "node:assert/strict"
import { test } from "node:test"
import type { NativeRuntimeExtensionPackage } from "./native-host"
import { signedMcpRuntimeExtensionFactory } from "./signed-mcp-factory"

test("signed MCP factory snapshots verified package identity without starting a process", () => {
  const packageValue: NativeRuntimeExtensionPackage = {
    id: "acme.search",
    label: "Acme Search",
    version: 2,
    publisher: "acme.official",
    publisherFingerprint: `sha256:${"C".repeat(43)}`,
    permissions: ["resources:read"],
    digest: `sha256:${"A".repeat(43)}`,
    permissionDigest: `sha256:${"B".repeat(43)}`,
    connectorProtocol: "mcp-stdio",
    rollbackVersion: null,
  }

  const factory = signedMcpRuntimeExtensionFactory(packageValue)
  assert.deepEqual(
    {
      id: factory.id,
      label: factory.label,
      version: factory.version,
      source: factory.source,
      digest: factory.digest,
      permissionDigest: factory.permissionDigest,
      permissions: factory.permissions,
    },
    {
      id: "acme.search",
      label: "Acme Search",
      version: 2,
      source: { kind: "package", id: "acme.official" },
      digest: packageValue.digest,
      permissionDigest: packageValue.permissionDigest,
      permissions: ["resources:read"],
    },
  )
  const contribution = factory.create()
  assert.equal(contribution.id, "acme.search")
  assert.equal(contribution.label, "Acme Search")
  assert.equal(typeof contribution.activate, "function")
  assert.equal(typeof contribution.dispose, "function")
  assert.equal(contribution.fileSystems?.length, 1)
  assert.equal(
    contribution.fileSystems?.[0]?.provider.descriptor.fileSystemId,
    "runtime-extension.acme.search",
  )
  assert.deepEqual(contribution.fileSystems?.[0]?.mount, {
    entryId: "runtime-extension.acme.search",
    name: "Acme Search",
    properties: {
      runtimeExtensionConnector: true,
      searchable: true,
      navigationSection: "apps",
      iconHint: "plug",
    },
  })
  assert.equal(contribution.engines, undefined)
})
