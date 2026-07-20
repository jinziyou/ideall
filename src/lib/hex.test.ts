import assert from "node:assert/strict"
import { test } from "node:test"
import { bytesToHex } from "./hex"

test("bytesToHex preserves leading zeros and uses lowercase", () => {
  assert.equal(bytesToHex(new Uint8Array([])), "")
  assert.equal(bytesToHex(new Uint8Array([0, 15, 16, 171, 255])), "000f10abff")
})
