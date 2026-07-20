import assert from "node:assert/strict"
import { test } from "node:test"
import { fileReadResultToBlob } from "./read-result"

test("file read result: base64 and binary data become typed blobs", async () => {
  const fromBase64 = fileReadResultToBlob({
    data: { base64: "aGVsbG8=" },
    mediaType: "text/plain",
  })
  const fromBytes = fileReadResultToBlob({
    data: new Uint8Array([119, 111, 114, 108, 100]),
    mediaType: "text/plain",
  })

  assert.equal(fromBase64.type, "text/plain")
  assert.equal(await fromBase64.text(), "hello")
  assert.equal(await fromBytes.text(), "world")
  assert.throws(
    () => fileReadResultToBlob({ data: { nested: true }, mediaType: "application/json" }),
    TypeError,
  )
})
