import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { acpClose, createAcpStream } from "@/lib/acp-transport"
import type { RuntimeExtensionContribution, RuntimeExtensionFactory } from "./types"
import type { NativeRuntimeExtensionPackage } from "./native-host"
import { spawnNativeRuntimeExtension } from "./native-host"
import { createMcpConnectorFileSystem, type McpConnectorClient } from "./mcp-file-system"

let sessionSequence = 0

class SignedPackageTransport implements Transport {
  onmessage?: Transport["onmessage"]
  onclose?: Transport["onclose"]
  onerror?: Transport["onerror"]
  readonly #sessionId: string
  #dispose?: () => void
  #reader?: ReadableStreamDefaultReader<unknown>
  #writer?: WritableStreamDefaultWriter<unknown>
  #closed = false

  constructor(
    private readonly packageId: string,
    private readonly digest: string,
  ) {
    this.#sessionId = `runtime-extension-${Date.now().toString(36)}-${sessionSequence++}`
  }

  async start(): Promise<void> {
    if (this.#reader || this.#closed) throw new Error("Runtime extension connector already started")
    try {
      const { stream, dispose } = await createAcpStream(this.#sessionId)
      this.#dispose = dispose
      this.#reader = stream.readable.getReader()
      this.#writer = stream.writable.getWriter()
      void this.#read()
      // 先安装事件监听，再启动 connector，避免短命进程的首条 MCP 消息丢失。
      await spawnNativeRuntimeExtension(this.#sessionId, this.packageId, this.digest)
    } catch (error) {
      await this.close().catch(() => {})
      throw error
    }
  }

  async #read(): Promise<void> {
    const reader = this.#reader
    if (!reader) return
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        this.onmessage?.(value as JSONRPCMessage)
      }
    } catch (error) {
      if (!this.#closed) this.onerror?.(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.onclose?.()
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.#writer) throw new Error("Runtime extension connector is not ready")
    await this.#writer.write(message)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#dispose?.()
    try {
      await this.#writer?.close()
    } catch {}
    try {
      await this.#reader?.cancel()
    } catch {}
    await acpClose(this.#sessionId)
  }
}

export function signedMcpRuntimeExtensionFactory(
  packageValue: NativeRuntimeExtensionPackage,
): RuntimeExtensionFactory {
  return {
    id: packageValue.id,
    label: packageValue.label,
    version: packageValue.version,
    source: { kind: "package", id: packageValue.publisher },
    digest: packageValue.digest,
    permissionDigest: packageValue.permissionDigest,
    permissions: [...packageValue.permissions],
    create(): RuntimeExtensionContribution {
      let client: Client | undefined
      let transport: SignedPackageTransport | undefined
      let abort: (() => void) | undefined
      let activationSignal: AbortSignal | undefined
      const connectorFileSystem = createMcpConnectorFileSystem({
        extensionId: packageValue.id,
        extensionLabel: packageValue.label,
        publisher: packageValue.publisher,
        version: packageValue.version,
        digest: packageValue.digest,
        permissions: packageValue.permissions,
      })

      function removeAbortListener(): void {
        if (abort) activationSignal?.removeEventListener("abort", abort)
        abort = undefined
        activationSignal = undefined
      }

      return {
        id: packageValue.id,
        label: packageValue.label,
        fileSystems: [
          {
            provider: connectorFileSystem.provider,
            mount: {
              entryId: `runtime-extension.${packageValue.id}`,
              name: packageValue.label,
              properties: {
                runtimeExtensionConnector: true,
                searchable: true,
                navigationSection: "apps",
                iconHint: "plug",
              },
            },
          },
        ],
        async activate(signal) {
          if (signal.aborted)
            throw new Error(`Runtime extension activation aborted: ${packageValue.id}`)
          const [{ Client }, notificationTypes] = await Promise.all([
            import("@modelcontextprotocol/sdk/client/index.js"),
            import("@modelcontextprotocol/sdk/types.js"),
          ])
          transport = new SignedPackageTransport(packageValue.id, packageValue.digest)
          client = new Client(
            { name: `ideall-extension-${packageValue.id}`, version: "1.0.0" },
            { capabilities: {} },
          )
          abort = () => void client?.close().catch(() => {})
          activationSignal = signal
          signal.addEventListener("abort", abort, { once: true })
          try {
            await client.connect(transport)
            const connectorClient: McpConnectorClient = {
              listResources: async (cursor) => {
                const result = await client!.listResources(cursor ? { cursor } : undefined)
                return { resources: result.resources, nextCursor: result.nextCursor }
              },
              listTools: async (cursor) => {
                const result = await client!.listTools(cursor ? { cursor } : undefined)
                return { tools: result.tools, nextCursor: result.nextCursor }
              },
              readResource: (uri) => client!.readResource({ uri }),
              callTool: async (name, args) => {
                const result = await client!.callTool({ name, arguments: args })
                return {
                  ...(Array.isArray(result.content) ? { content: result.content } : {}),
                  ...(Object.prototype.hasOwnProperty.call(result, "structuredContent")
                    ? { structuredContent: result.structuredContent }
                    : {}),
                  ...(typeof result.isError === "boolean" ? { isError: result.isError } : {}),
                }
              },
            }
            await connectorFileSystem.attach(connectorClient)
            if (packageValue.permissions.includes("resources:read")) {
              client.setNotificationHandler(
                notificationTypes.ResourceListChangedNotificationSchema,
                () => void connectorFileSystem.refreshResources().catch(() => {}),
              )
              client.setNotificationHandler(
                notificationTypes.ResourceUpdatedNotificationSchema,
                (notification) => connectorFileSystem.resourceUpdated(notification.params.uri),
              )
            }
            if (packageValue.permissions.includes("tools:invoke")) {
              client.setNotificationHandler(
                notificationTypes.ToolListChangedNotificationSchema,
                () => void connectorFileSystem.refreshTools().catch(() => {}),
              )
            }
            if (signal.aborted)
              throw new Error(`Runtime extension activation aborted: ${packageValue.id}`)
          } catch (error) {
            connectorFileSystem.detach()
            removeAbortListener()
            await client.close().catch(() => transport?.close())
            throw error
          }
        },
        async dispose() {
          connectorFileSystem.detach()
          removeAbortListener()
          await client?.close().catch(() => transport?.close())
          client = undefined
          transport = undefined
        },
      }
    },
  }
}
