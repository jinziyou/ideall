// 按 Grant 收窄的宿主能力句柄 (L1.5) —— 注入给 tools handler, 取代模块单例 getSession/getServerPort/getFilesPort。
//
// 关键收窄: note/thread 正文只在 scope 含 fs.notes:read 时可达。把私密读闸从「fs.read 单个 handler」
// 下沉到这一层 —— 任何 handler 经 host.files 都拿不到未授权的私密正文 (防御纵深, 见 docs/extension-registry-design.md §3 不变量2)。
// 非私密操作 (关注 / 书签 / 文件二进制 / 删除) 直通底层端口。
//
// 注: 进程内 handler 仍是一方可信代码 (三方一律进程外, 见 docs/extensions.md 决策 #5), 故此层是
// 一方代码纪律的防御纵深 + 可单测的收窄缝, 非堵当前漏洞。makeScopedFiles 是纯函数 (port + 标志 → 句柄)。
import {
  stripNode,
  type Node,
  type NodeKind,
  type FsCreateInput,
  type FsWritePatch,
} from "@protocol/node"
import { getFilesPort, type FilesPort } from "@protocol/files"
import { getServerPort, type ServerPort } from "@protocol/server-port"
import { getSession, setSession, type Session } from "@/lib/auth/auth-store"
import type { Permission } from "./protocol"

/** 私密正文受控的 FilesPort 子面 (注入 tools handler)。 */
export interface ScopedFiles {
  // ── 非私密直通 (不回读 note/thread 正文) ──
  isSubscribed: FilesPort["isSubscribed"]
  listSubscriptions: FilesPort["listSubscriptions"]
  addSubscription: FilesPort["addSubscription"]
  removeSubscription: FilesPort["removeSubscription"]
  listBookmarks: FilesPort["listBookmarks"]
  addBookmark: FilesPort["addBookmark"]
  deleteNode: FilesPort["fsDeleteNode"]
  // ── 私密内容受控面 (note/thread 正文须 fs.notes:read; 文件二进制须 fs.blobs:read) ──
  /** 文件二进制读 (受控): scope 含 fs.blobs:read 才回内容; 否则 "gated" → consent-required (与 note 正文同级闸)。 */
  readBlob(id: string): Promise<Awaited<ReturnType<FilesPort["fsReadBlob"]>> | "gated">
  /** 列举: 永远净化 (note/thread 剥内容), 与 fs.list / fs://nodes 同口径。 */
  listStripped(kinds: NodeKind[]): Promise<Node[]>
  /** 单读 (kind 须匹配): 可读 → Node; note/thread 无 notes-read → "gated"; 不存在/kind 不符 → null。 */
  readGated(id: string, kind: NodeKind): Promise<Node | "gated" | null>
  /** 写后回读自动净化 (无 notes-read 剥 note/thread 正文; 写 ≠ 可读)。 */
  createNode(input: FsCreateInput): Promise<Node>
  updateNode(
    kind: NodeKind,
    id: string,
    patch: FsWritePatch,
    expectedVersion?: string,
  ): Promise<Node | undefined>
  moveNode(
    kind: NodeKind,
    id: string,
    parentId: string | null,
    afterSortKey?: string | null,
    expectedVersion?: string,
  ): Promise<Node | undefined>
}

/** 据 fs.notes:read 是否在 scope 内, 把底层 FilesPort 收窄成 ScopedFiles。纯函数, 可单测。 */
export function makeScopedFiles(
  port: FilesPort,
  canReadNotes: boolean,
  canReadBlobs = false,
): ScopedFiles {
  const sanitize = (n: Node): Node => (canReadNotes ? n : stripNode(n))
  return {
    // 箭头延迟取属性到调用时 (而非构造时 .bind), 与原 handler 的惰性访问一致:
    // 未授权 → 对应工具不注册 → 该方法永不被调 → 即便底层 port 未实现也不抛 (守 agent-mcp 等精简 FilesPort)。
    isSubscribed: (...a) => port.isSubscribed(...a),
    listSubscriptions: (...a) => port.listSubscriptions(...a),
    addSubscription: (...a) => port.addSubscription(...a),
    removeSubscription: (...a) => port.removeSubscription(...a),
    listBookmarks: (...a) => port.listBookmarks(...a),
    addBookmark: (...a) => port.addBookmark(...a),
    deleteNode: (...a) => port.fsDeleteNode(...a),
    // 文件二进制读受 fs.blobs:read 闸 (与 note/thread 正文同级): 无授权 → "gated" → consent-required。
    async readBlob(id) {
      if (!canReadBlobs) return "gated"
      return port.fsReadBlob(id)
    },
    async listStripped(kinds) {
      return (await port.fsListNodes(kinds)).map(stripNode)
    },
    async readGated(id, kind) {
      const n = await port.fsGetNode(id)
      if (!n || n.kind !== kind) return null
      if ((n.kind === "note" || n.kind === "thread") && !canReadNotes) return "gated"
      return n
    },
    async createNode(input) {
      return sanitize(await port.fsCreateNode(input))
    },
    async updateNode(kind, id, patch, expectedVersion) {
      const n = await port.fsUpdateNode(kind, id, patch, expectedVersion)
      return n ? sanitize(n) : undefined
    },
    async moveNode(kind, id, parentId, afterSortKey, expectedVersion) {
      const n = await port.fsMoveNode(kind, id, parentId, afterSortKey, expectedVersion)
      return n ? sanitize(n) : undefined
    },
  }
}

/** 注入 tools handler 的收窄宿主句柄: 取代 getSession / getServerPort / getFilesPort 模块单例。 */
export interface ScopedHost {
  getSession: () => Session
  /** 资料写入成功后刷新宿主会话；token 仍不离开宿主。 */
  setSession: typeof setSession
  server: () => ServerPort
  files: ScopedFiles
}

/** 据 effective permissions 构建 ScopedHost (在 createLocalMcpServer 内, 每消费方一份)。 */
export function makeScopedHost(perms: Permission[]): ScopedHost {
  return {
    getSession,
    setSession,
    server: getServerPort,
    files: makeScopedFiles(
      getFilesPort(),
      perms.includes("fs.notes:read"),
      perms.includes("fs.blobs:read"),
    ),
  }
}
