// 智能体工具集 —— 让模型读取/修改用户 home 的本地数据 (书签 / 收藏夹 / 订阅 / 资源)。
// 全部在浏览器执行 (数据在 IndexedDB), 经 protocol 的 HubDataPort 访问中枢数据
// (插件不直接依赖 core 存储; 由 core 在启动时注册端口实现)。
import { getHubData, type HubDataPort } from "@protocol/hub-data"
import { safeHref } from "@/components/lib/safe-url"
import type { SubscriptionType } from "@protocol/subscription"

const SUB_TYPES: SubscriptionType[] = ["publisher", "entity", "tool", "search", "peer"]
const LIST_CAP = 80
// 写入边界对模型给的文本 / 标签设上限, 防超长串或海量标签被持久化进 IndexedDB。
const STR_CAP = 2000
const TAGS_CAP = 24
const TAG_LEN_CAP = 64

/** OpenAI function-calling 工具定义 (传给模型的 tools 数组)。 */
export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_bookmarks",
      description: "列出用户的书签，可按收藏夹名或标签过滤。",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "收藏夹名 (可选)" },
          tag: { type: "string", description: "标签 (可选)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_bookmark",
      description: "为用户新增一条书签。folder 给收藏夹名，不存在会自动创建。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "链接地址 (必填)" },
          title: { type: "string", description: "标题 (可选，留空用 URL)" },
          description: { type: "string", description: "备注 (可选)" },
          tags: { type: "array", items: { type: "string" }, description: "标签 (可选)" },
          folder: { type: "string", description: "归入的收藏夹名 (可选)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_bookmark",
      description: "修改一条已有书签 (按 id)。只传需要改的字段。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "书签 id (必填，先用 list_bookmarks 获取)" },
          title: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          folder: { type: "string", description: "移动到的收藏夹名" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_bookmark",
      description: "删除一条书签 (按 id)。破坏性操作，仅在用户明确要求时使用。",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "书签 id (必填)" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_bookmark_folder",
      description: "新建一个收藏夹。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "收藏夹名 (必填)" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_subscriptions",
      description: "列出用户在「发现」里的订阅，可按类型过滤 (publisher/entity/tool/search/peer)。",
      parameters: {
        type: "object",
        properties: { type: { type: "string", description: "订阅类型 (可选)" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_search_subscription",
      description: "添加一个「搜索」订阅 (按关键词，本地优先，可选限定发布者域名)。",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "搜索关键词 (必填)" },
          domain: { type: "string", description: "限定的发布者域名 (可选)" },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_subscription",
      description: "取消一个订阅 (按 type + key，先用 list_subscriptions 获取)。破坏性操作。",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "订阅类型" },
          key: { type: "string", description: "订阅去重键" },
        },
        required: ["type", "key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_resources",
      description: "列出用户的本地资源文件 (仅元数据，不含内容)，可按标签过滤。",
      parameters: {
        type: "object",
        properties: { tag: { type: "string", description: "标签 (可选)" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_resource",
      description: "重命名资源文件或修改其标签 (按 id)。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "文件 id (必填)" },
          name: { type: "string", description: "新文件名 (可选)" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "新标签集 (可选，整体替换)",
          },
        },
        required: ["id"],
      },
    },
  },
]

export const AGENT_TOOL_NAMES = AGENT_TOOLS.map((t) => t.function.name)

/** 工具执行结果: data 回传给模型, summary 供 UI 展示。 */
export interface ToolResult {
  ok: boolean
  /** 给用户看的一句话 */
  summary: string
  /** 回传模型的结构化结果 */
  data: unknown
}

function asTags(v: unknown): string[] {
  const raw = Array.isArray(v)
    ? v.map((x) => String(x))
    : typeof v === "string"
      ? v.split(/[,，\s]+/)
      : []
  return raw
    .map((s) => s.trim().slice(0, TAG_LEN_CAP))
    .filter(Boolean)
    .slice(0, TAGS_CAP)
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, STR_CAP) : ""
}

/** 把收藏夹名解析为 id; 不存在则创建。空名返回 null (未分组)。 */
async function resolveFolderId(name: string, hub: HubDataPort): Promise<string | null> {
  const n = name.trim()
  if (!n) return null
  const folders = await hub.listFolders()
  const hit = folders.find((f) => f.name === n)
  if (hit) return hit.id
  const created = await hub.addFolder(n)
  return created.id
}

type Args = Record<string, unknown>

/** 执行一个工具调用; 任何错误都收敛为 ok:false 结果 (不抛, 让 agent 循环继续)。 */
export async function executeTool(name: string, args: Args): Promise<ToolResult> {
  try {
    const hub = getHubData()
    const {
      addBookmark,
      addFolder,
      deleteBookmark,
      listBookmarks,
      listFolders,
      updateBookmark,
      addSubscription,
      listSubscriptions,
      removeSubscription,
      listFiles,
      updateFileMeta,
    } = hub
    switch (name) {
      case "list_bookmarks": {
        const folderName = str(args.folder)
        const tag = str(args.tag).toLowerCase()
        const [bms, folders] = await Promise.all([listBookmarks(), listFolders()])
        const folderById = new Map(folders.map((f) => [f.id, f.name]))
        let list = bms
        if (folderName) {
          const fid = folders.find((f) => f.name === folderName)?.id ?? "__none__"
          list = list.filter((b) => b.folderId === fid)
        }
        if (tag) list = list.filter((b) => b.tags.some((t) => t.toLowerCase().includes(tag)))
        const items = list.slice(0, LIST_CAP).map((b) => ({
          id: b.id,
          title: b.title,
          url: b.url,
          tags: b.tags,
          folder: b.folderId ? (folderById.get(b.folderId) ?? null) : null,
        }))
        return {
          ok: true,
          summary: `列出 ${list.length} 条书签`,
          data: { total: list.length, truncated: list.length > items.length, items },
        }
      }

      case "add_bookmark": {
        const url = str(args.url)
        if (!url) return { ok: false, summary: "缺少 url", data: { error: "url 必填" } }
        // 模型给的 url 在写入边界就过协议白名单, 防 javascript: 等伪协议入库后被点击执行。
        if (!safeHref(url))
          return { ok: false, summary: "url 协议不合法", data: { error: "仅支持 http/https 链接" } }
        const folderId = await resolveFolderId(str(args.folder), hub)
        const bm = await addBookmark({
          url,
          title: str(args.title) || url,
          description: str(args.description),
          tags: asTags(args.tags),
          folderId,
        })
        return {
          ok: true,
          summary: `已收藏「${bm.title}」${str(args.folder) ? ` → ${str(args.folder)}` : ""}`,
          data: { id: bm.id, title: bm.title, url: bm.url },
        }
      }

      case "update_bookmark": {
        const id = str(args.id)
        const bms = await listBookmarks()
        const target = bms.find((b) => b.id === id)
        if (!target) return { ok: false, summary: `未找到书签 ${id}`, data: { error: "not found" } }
        const patch: Record<string, unknown> = {}
        if (typeof args.title === "string") patch.title = str(args.title)
        if (typeof args.description === "string") patch.description = str(args.description)
        if (args.tags !== undefined) patch.tags = asTags(args.tags)
        if (typeof args.folder === "string")
          patch.folderId = await resolveFolderId(args.folder, hub)
        await updateBookmark(id, patch)
        return { ok: true, summary: `已更新书签「${target.title}」`, data: { id } }
      }

      case "delete_bookmark": {
        const id = str(args.id)
        const bms = await listBookmarks()
        const target = bms.find((b) => b.id === id)
        if (!target) return { ok: false, summary: `未找到书签 ${id}`, data: { error: "not found" } }
        await deleteBookmark(id)
        return { ok: true, summary: `已删除书签「${target.title}」`, data: { id } }
      }

      case "create_bookmark_folder": {
        const fname = str(args.name)
        if (!fname) return { ok: false, summary: "缺少收藏夹名", data: { error: "name 必填" } }
        const folder = await addFolder(fname)
        return {
          ok: true,
          summary: `已创建收藏夹「${folder.name}」`,
          data: { id: folder.id, name: folder.name },
        }
      }

      case "list_subscriptions": {
        const type = str(args.type)
        let subs = await listSubscriptions()
        if (type) subs = subs.filter((s) => s.type === type)
        const items = subs
          .slice(0, LIST_CAP)
          .map((s) => ({ type: s.type, key: s.key, title: s.title }))
        return {
          ok: true,
          summary: `列出 ${subs.length} 个订阅`,
          data: { total: subs.length, truncated: subs.length > items.length, items },
        }
      }

      case "add_search_subscription": {
        const keyword = str(args.keyword)
        if (!keyword) return { ok: false, summary: "缺少关键词", data: { error: "keyword 必填" } }
        const domain = str(args.domain)
        // key 方案须与 UI「保存搜索」一致 (info-toolbar.tsx), 否则会与用户手动订阅重复。
        const key = domain ? `${keyword}@${domain}` : keyword
        await addSubscription({
          type: "search",
          key,
          title: domain ? `${keyword} · ${domain}` : keyword,
          searchKeyword: keyword,
          searchDomain: domain || undefined,
        })
        return {
          ok: true,
          summary: `已订阅搜索「${keyword}」${domain ? ` @${domain}` : ""}`,
          data: { key },
        }
      }

      case "remove_subscription": {
        const type = SUB_TYPES.find((t) => t === str(args.type))
        const key = str(args.key)
        if (!type || !key)
          return { ok: false, summary: "type 或 key 无效", data: { error: "invalid type/key" } }
        const subs = await listSubscriptions()
        const target = subs.find((s) => s.type === type && s.key === key)
        if (!target)
          return { ok: false, summary: `未找到订阅 ${type}:${key}`, data: { error: "not found" } }
        await removeSubscription(type, key)
        return { ok: true, summary: `已取消订阅「${target.title}」`, data: { type, key } }
      }

      case "list_resources": {
        const tag = str(args.tag).toLowerCase()
        let files = await listFiles()
        if (tag) files = files.filter((f) => f.tags.some((t) => t.toLowerCase().includes(tag)))
        const items = files.slice(0, LIST_CAP).map((f) => ({
          id: f.id,
          name: f.name,
          size: f.size,
          tags: f.tags,
        }))
        return {
          ok: true,
          summary: `列出 ${files.length} 个资源`,
          data: { total: files.length, truncated: files.length > items.length, items },
        }
      }

      case "update_resource": {
        const id = str(args.id)
        const files = await listFiles()
        const target = files.find((f) => f.id === id)
        if (!target) return { ok: false, summary: `未找到资源 ${id}`, data: { error: "not found" } }
        const patch: Record<string, unknown> = {}
        if (typeof args.name === "string" && str(args.name)) patch.name = str(args.name)
        if (args.tags !== undefined) patch.tags = asTags(args.tags)
        await updateFileMeta(id, patch)
        return { ok: true, summary: `已更新资源「${target.name}」`, data: { id } }
      }

      default:
        return { ok: false, summary: `未知工具 ${name}`, data: { error: "unknown tool" } }
    }
  } catch (e) {
    return {
      ok: false,
      summary: `工具执行出错：${name}`,
      data: { error: e instanceof Error ? e.message : String(e) },
    }
  }
}
