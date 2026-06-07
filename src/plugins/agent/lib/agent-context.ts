// 把用户 home 的本地数据 (订阅 / 书签 / 资源 / 收藏夹) 汇成紧凑快照, 作为 AI 助手的上下文。
// 只读、只取元数据 (文件不含内容 Blob), 全部来自本机 IndexedDB; 发送时随系统提示一并给模型。
import { getHubData } from "@protocol/hub-data"
import { formatBytes } from "@/lib/hub-format"

// 各类目最多列出的条数 (控制 token; 超出只给计数)
const CAP = 50

const SUB_TYPE_LABEL: Record<string, string> = {
  publisher: "发布者",
  entity: "实体",
  tool: "工具",
  search: "搜索",
  peer: "社区发布者",
}

function section(title: string, total: number, lines: string[]): string {
  if (total === 0) return ""
  const head = total > lines.length ? `${title}（共 ${total} 项，列前 ${lines.length}）：` : `${title}（${total} 项）：`
  return head + "\n" + lines.map((l) => `  - ${l}`).join("\n")
}

/** 汇集 home 快照文本; 全空时返回空串。 */
export async function gatherHomeContext(): Promise<string> {
  const hub = getHubData()
  const [subs, bookmarks, folders, files] = await Promise.all([
    hub.listSubscriptions().catch(() => []),
    hub.listBookmarks().catch(() => []),
    hub.listFolders().catch(() => []),
    hub.listFiles().catch(() => []),
  ])

  const blocks: string[] = []

  blocks.push(
    section(
      "我的订阅",
      subs.length,
      subs.slice(0, CAP).map((s) => `[${SUB_TYPE_LABEL[s.type] ?? s.type}] ${s.title}`),
    ),
  )
  blocks.push(
    section(
      "我的书签",
      bookmarks.length,
      bookmarks.slice(0, CAP).map((b) => {
        const tags = b.tags.length ? ` #${b.tags.join(" #")}` : ""
        return `${b.title} — ${b.url}${tags}`
      }),
    ),
  )
  if (folders.length) {
    blocks.push(section("收藏夹", folders.length, folders.slice(0, CAP).map((f) => f.name)))
  }
  blocks.push(
    section(
      "我的资源文件",
      files.length,
      files.slice(0, CAP).map((f) => {
        const tags = f.tags.length ? ` #${f.tags.join(" #")}` : ""
        return `${f.name} (${formatBytes(f.size)})${tags}`
      }),
    ),
  )

  return blocks.filter(Boolean).join("\n\n")
}

/** 拼装系统提示: 助手人设 + (可选) home 快照。tools 模式下允许调用工具改动数据。 */
export function buildSystemPrompt(homeContext: string, opts?: { tools?: boolean }): string {
  const lines = [
    "你是 Wonita「我的空间」(home) 里的 AI 助手。Wonita 是一个本地优先的个人信息总控终端，",
    "home 是用户聚合信息、资源、工具与社区的中枢。请用简体中文、简洁专业地回答。",
    "排版用纯文本与短横线列表即可，代码用三反引号包裹；不要使用 # 标题或 ** 加粗等 Markdown 记号（前端按纯文本显示）。",
  ]
  if (opts?.tools) {
    lines.push(
      "你可调用工具读取或修改用户的书签、收藏夹、订阅、资源（改动直接生效于本机）。",
      "需要最新或精确数据时优先用工具查询，而不是只依赖下方快照；修改类工具用完后在最终答复里说明你做了哪些改动。",
      "破坏性操作（删除、取消订阅）要谨慎，仅在用户明确要求时执行。",
    )
  } else {
    lines.push("你无法直接改动用户数据，需要操作时请给出清晰的步骤建议。")
  }
  const base = lines.join("")
  // 未带 home 上下文 (用户关闭 或 暂无数据) 时, 不提「快照」, 避免空指引。
  if (!homeContext) return base
  return (
    base +
    "\n\n涉及用户已有的订阅、书签、资源时，优先结合下方「我的空间快照」作答（只读参考，可能不完整，不要逐条复述）：\n" +
    homeContext
  )
}
