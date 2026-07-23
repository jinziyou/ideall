import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const PACKAGE_JSON = new URL("../package.json", import.meta.url)
const PNPM_LOCK = new URL("../pnpm-lock.yaml", import.meta.url)

test("brace-expansion advisory range resolves only to the patched release", () => {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"))
  const lockfile = readFileSync(PNPM_LOCK, "utf8")
  const override = packageJson.pnpm?.overrides?.["brace-expansion@>=3.0.0 <5.0.7"]

  assert.equal(override, "5.0.7")
  assert.match(lockfile, /^  brace-expansion@>=3\.0\.0 <5\.0\.7: 5\.0\.7$/m)

  const lockedVersions = [
    ...lockfile.matchAll(/^  brace-expansion@([0-9]+\.[0-9]+\.[0-9]+):$/gm),
  ].map((match) => match[1])
  assert.ok(lockedVersions.includes("5.0.7"))
  assert.equal(
    lockedVersions.some((version) => isAffectedBraceExpansion(version)),
    false,
    `vulnerable brace-expansion release remains locked: ${lockedVersions.join(", ")}`,
  )
})

function isAffectedBraceExpansion(version) {
  const [major, minor, patch] = version.split(".").map(Number)
  if (major === 3 || major === 4) return true
  return major === 5 && minor === 0 && patch < 7
}
