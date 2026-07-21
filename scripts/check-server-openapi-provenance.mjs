import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { validateServerOpenApiProvenance } from "./lib/server-openapi-provenance.mjs"

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const APP_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..")

export async function checkServerOpenApiProvenance({
  artifactFile = path.join(APP_ROOT, "openapi", "server.json"),
  provenanceFile = path.join(APP_ROOT, "openapi", "server.provenance.json"),
} = {}) {
  const [artifactContent, provenanceContent] = await Promise.all([
    readFile(artifactFile),
    readFile(provenanceFile, "utf8"),
  ])
  let provenance
  try {
    provenance = JSON.parse(provenanceContent)
  } catch (error) {
    throw new Error(`provenance 不是合法 JSON: ${error.message}`)
  }
  const errors = validateServerOpenApiProvenance({ provenance, artifactContent })
  if (errors.length) throw new Error(errors.join("\n"))
  return provenance
}

async function main(argv = process.argv.slice(2)) {
  const [artifactFile, provenanceFile] = argv
  try {
    const provenance = await checkServerOpenApiProvenance({
      artifactFile: artifactFile ? path.resolve(artifactFile) : undefined,
      provenanceFile: provenanceFile ? path.resolve(provenanceFile) : undefined,
    })
    console.log(
      `✓ openapi/server.json provenance 有效（${provenance.source.repository}@${provenance.source.commit}）`,
    )
  } catch (error) {
    console.error(`✗ openapi/server.json provenance 无效: ${error.message}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) await main()
