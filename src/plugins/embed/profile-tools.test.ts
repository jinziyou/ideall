import assert from "node:assert/strict"
import { test } from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ServerPort } from "@protocol/server-port"
import { TOOL } from "./protocol"
import type { ScopedHost } from "./scoped-host"
import { registerGrantedTools } from "./tools"
import { createLoopbackTransports } from "./transport"

test("profile bridge: requires a display name and refreshes the host session", async () => {
  const previousUser = {
    id: `u:${"1".repeat(32)}`,
    email: "user@example.test",
    name: "Before",
    avatar: null,
  }
  const updatedUser = { ...previousUser, name: "After" }
  const profilePatches: Array<{ name: string }> = []
  const sessions: Array<{ token: string; user: typeof updatedUser }> = []
  const serverPort = {
    async updateProfile(_token: string, patch: { name: string }) {
      profilePatches.push(patch)
      return { ok: true as const, data: updatedUser }
    },
  } as ServerPort
  const host = {
    getSession: () => ({ token: "jwt", user: previousUser }),
    async setSession(token: string, user: typeof updatedUser) {
      sessions.push({ token, user })
    },
    server: () => serverPort,
    files: {},
  } as ScopedHost

  const server = new McpServer({ name: "profile-test", version: "1" })
  registerGrantedTools(server, ["identity.publish"], { navigate: () => undefined }, host)
  const { serverTransport, clientTransport } = createLoopbackTransports()
  const client = new Client({ name: "profile-client", version: "1" }, { capabilities: {} })
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const result = await client.callTool({
      name: TOOL.meUpdateProfile,
      arguments: { name: "  After  " },
    })

    assert.equal(result.isError, undefined)
    assert.deepEqual(profilePatches, [{ name: "After" }])
    assert.deepEqual(sessions, [{ token: "jwt", user: updatedUser }])
    const content = result.content as Array<{ type: string; text?: string }>
    assert.deepEqual(JSON.parse(content[0]?.text ?? "null"), updatedUser)

    const unicodeName = "😀".repeat(100)
    await client.callTool({
      name: TOOL.meUpdateProfile,
      arguments: { name: unicodeName },
    })
    assert.deepEqual(profilePatches.at(-1), { name: unicodeName })

    const invalid = await client.callTool({
      name: TOOL.meUpdateProfile,
      arguments: { avatar: "https://example.test/avatar.png" },
    })
    assert.equal(invalid.isError, true)
    assert.equal(profilePatches.length, 2)

    const tooLong = await client.callTool({
      name: TOOL.meUpdateProfile,
      arguments: { name: `${unicodeName}😀` },
    })
    assert.equal(tooLong.isError, true)
    assert.equal(profilePatches.length, 2)
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
})
