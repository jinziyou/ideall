import assert from "node:assert/strict"
import { test } from "node:test"
import {
  decryptWorkspaceArchive,
  encryptWorkspaceArchive,
  isEncryptedWorkspaceArchive,
} from "@/lib/workspace-archive-crypto"

const PASSPHRASE = "correct horse battery staple"

test("encrypted workspace archives round trip without exposing plaintext", async () => {
  const plaintext = JSON.stringify({ kind: "ideall.workspace-archive", private: "hidden-value" })
  const encrypted = await encryptWorkspaceArchive(plaintext, PASSPHRASE, {
    createdAt: "2026-07-16T00:00:00.000Z",
  })

  assert.equal(isEncryptedWorkspaceArchive(encrypted), true)
  assert.equal(encrypted.includes("hidden-value"), false)
  assert.equal(await decryptWorkspaceArchive(encrypted, PASSPHRASE), plaintext)
})

test("encrypted workspace archives reject wrong passphrases and tampering", async () => {
  const encrypted = await encryptWorkspaceArchive("secret", PASSPHRASE)
  await assert.rejects(
    decryptWorkspaceArchive(encrypted, "incorrect password value"),
    /口令错误或加密归档已损坏/,
  )

  const envelope = JSON.parse(encrypted) as { ciphertext: string }
  envelope.ciphertext = `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}`
  await assert.rejects(
    decryptWorkspaceArchive(JSON.stringify(envelope), PASSPHRASE),
    /口令错误或加密归档已损坏/,
  )
})

test("encrypted workspace archives enforce passphrase and byte budgets", async () => {
  await assert.rejects(encryptWorkspaceArchive("secret", "too-short"), /归档口令长度/)
  await assert.rejects(
    encryptWorkspaceArchive("12345", PASSPHRASE, {
      limits: {
        maxPlaintextBytes: 4,
        maxEnvelopeBytes: 1_024,
        maxNodes: 1,
        maxBlobs: 1,
        maxSingleBlobBytes: 1,
        maxTotalBlobBytes: 1,
        maxTrashSnapshots: 1,
        maxPlugins: 1,
        maxTabs: 1,
      },
    }),
    /明文超出限制/,
  )
})
