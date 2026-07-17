import assert from "node:assert/strict"
import { test } from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { registerFilesPort, type FilesPort } from "@protocol/files"
import type { CaptureBookmarkInput } from "@protocol/capture"
import { registerUiActions } from "@/lib/ui-actions"
import { createLocalMcpServer } from "./local-mcp-server"
import { firstPartyGrant } from "./grant"
import { communityEmbedManifest } from "./manifest"
import { TOOL } from "./protocol"
import { createLoopbackTransports } from "./transport"

test("community bookmark tool: uses the unified host capture action", async () => {
  const captured: CaptureBookmarkInput[] = []
  const unregisterFiles = registerFilesPort({} as FilesPort)
  const unregisterUi = registerUiActions({
    openTab: () => undefined,
    closeTab: () => undefined,
    async captureBookmark(input) {
      captured.push(input)
      return {
        status: "created",
        bookmark: {
          id: "bm-1",
          title: input.title,
          url: input.url,
          description: input.description ?? "",
          favicon: input.favicon ?? "",
          folderId: null,
          tags: ["收件箱"],
          createdAt: 1,
        },
      }
    },
  })
  const server = createLocalMcpServer(firstPartyGrant(communityEmbedManifest, Date.now()), {
    navigate: () => undefined,
  })
  const { serverTransport, clientTransport } = createLoopbackTransports()
  const client = new Client({ name: "community-capture-test", version: "1" }, { capabilities: {} })
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const tools = await client.listTools()
    assert.equal(
      tools.tools.some((tool) => tool.name === TOOL.hubAddBookmark),
      true,
    )

    const result = await client.callTool({
      name: TOOL.hubAddBookmark,
      arguments: {
        title: "Community research",
        url: "https://example.com/research#finding",
        description: "A searchable finding",
      },
    })
    assert.equal(result.isError, undefined)
    assert.deepEqual(captured, [
      {
        title: "Community research",
        url: "https://example.com/research#finding",
        description: "A searchable finding",
      },
    ])
    const content = result.content as Array<{ type: string; text?: string }>
    const text = content.find((item) => item.type === "text")
    assert.ok(text?.text)
    assert.equal(JSON.parse(text.text).id, "bm-1")
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
    unregisterUi()
    unregisterFiles()
  }
})
