import assert from "node:assert/strict"
import { test } from "node:test"
import { installedAppIconRequest } from "./installed-apps"

test("installed app icon request sends only an opaque app id", () => {
  const request = installedAppIconRequest("org.example.Editor")
  assert.deepEqual(request, {
    command: "read_app_icon_data_url",
    args: { id: "org.example.Editor" },
  })
  assert.equal("path" in request.args, false)
})
