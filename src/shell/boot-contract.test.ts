import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { registerBuiltInFileSystems } from "@/filesystem/builtin"
import {
  NAVIGATION_SECTIONS,
  NavigationContractError,
  assertNavigationContract,
} from "@/filesystem/navigation-file-system"
import { clearFileSystemsForTest } from "@/filesystem/registry"
import { BootContractError, assertShellBootContract, describeBootFailure } from "./boot-contract"

afterEach(() => clearFileSystemsForTest())

test("boot contract: built-in root, navigation and resource providers satisfy shell startup", () => {
  registerBuiltInFileSystems()
  assert.doesNotThrow(() => assertShellBootContract())
})

test("boot contract: missing providers fail with a stable diagnostic code", () => {
  assert.throws(
    () => assertShellBootContract(),
    (error) => error instanceof BootContractError && error.code === "BOOT_PROVIDER_MISSING",
  )
})

test("boot contract: navigation definitions reject duplicate identities", () => {
  assert.throws(
    () => assertNavigationContract([NAVIGATION_SECTIONS[0]!, NAVIGATION_SECTIONS[0]!]),
    (error) => error instanceof NavigationContractError,
  )
})

test("boot diagnostics: redact credential-shaped registration errors", () => {
  const diagnostic = describeBootFailure(new Error("Authorization: Bearer startup-secret"))
  assert.equal(diagnostic.code, "BOOT_REGISTRATION_FAILED")
  assert.equal(diagnostic.detail.includes("startup-secret"), false)
  assert.equal(diagnostic.detail.includes("[redacted]"), true)
})
