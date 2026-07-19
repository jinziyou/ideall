import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, test } from "node:test"
import { checkServerOpenApiProvenance } from "./check-server-openapi-provenance.mjs"
import {
  createServerOpenApiProvenance,
  validateServerOpenApiProvenance,
} from "./server-openapi-provenance.mjs"
import { syncServerOpenApi } from "./sync-server-openapi.mjs"

const tempRoots = []
const COMMIT = "0123456789abcdef0123456789abcdef01234567"

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "ideall-openapi-provenance-"))
  tempRoots.push(root)
  return root
}

test("sync writes a normalized snapshot and matching provenance", async () => {
  const root = await createTempRoot()
  const sourceFile = path.join(root, "source.json")
  const outputFile = path.join(root, "openapi", "server.json")
  const provenanceFile = path.join(root, "openapi", "server.provenance.json")
  await writeFile(sourceFile, '{"openapi":"3.1.0"}')

  syncServerOpenApi({ sourceFile, sourceCommit: COMMIT, outputFile, provenanceFile })

  assert.equal(await readFile(outputFile, "utf8"), '{"openapi":"3.1.0"}\n')
  const provenance = await checkServerOpenApiProvenance({
    artifactFile: outputFile,
    provenanceFile,
  })
  assert.equal(provenance.source.commit, COMMIT)
})

test("provenance rejects artifact tampering", () => {
  const artifactContent = Buffer.from('{"openapi":"3.1.0"}\n')
  const provenance = createServerOpenApiProvenance({ artifactContent, commit: COMMIT })

  const errors = validateServerOpenApiProvenance({
    provenance,
    artifactContent: Buffer.from('{"openapi":"3.0.0"}\n'),
  })
  assert.match(errors.join("\n"), /sha256 不匹配/)
})

test("sync requires an immutable provider commit before writing", async () => {
  const root = await createTempRoot()
  const sourceFile = path.join(root, "source.json")
  await writeFile(sourceFile, '{"openapi":"3.1.0"}\n')

  assert.throws(
    () => syncServerOpenApi({ sourceFile, outputFile: path.join(root, "server.json") }),
    /source.commit 必须是 40 位/,
  )
})
