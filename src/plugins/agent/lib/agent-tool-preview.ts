import { TOOL } from "@/plugins/embed/protocol"

export type AgentToolRisk = "low" | "medium" | "high"
export type AgentToolEffect = "read" | "write" | "delete" | "navigation" | "external"

export type AgentToolPreviewField = Readonly<{
  label: string
  value: string
}>

/**
 * 工具审批和持久审计共用的最小脱敏投影。不携带原始 args，避免密钥、表单
 * 输入或笔记正文在 UI/审计库中形成第二份副本。
 */
export type AgentToolPreview = Readonly<{
  toolName: string
  title: string
  summary: string
  effect: AgentToolEffect
  risk: AgentToolRisk
  mutating: boolean
  target?: Readonly<{
    kind?: string
    id?: string
    label: string
  }>
  fields: readonly AgentToolPreviewField[]
}>

const MAX_VALUE_LENGTH = 160
const SENSITIVE_KEY =
  /(token|secret|api[-_]?key|authorization|auth|cookie|password|passphrase|session|jwt|bearer|credential|refresh|content|body|text|value)/i

const NODE_LABELS: Readonly<Record<string, string>> = {
  note: "笔记",
  bookmark: "书签",
  folder: "文件夹",
  feed: "关注",
  thread: "对话",
  file: "文件",
}

function bounded(value: unknown, fallback = "未指定"): string {
  if (typeof value !== "string") return fallback
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim()
  if (!normalized) return fallback
  return normalized.length > MAX_VALUE_LENGTH
    ? `${normalized.slice(0, MAX_VALUE_LENGTH - 1)}…`
    : normalized
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function nodeLabel(kind: unknown): string {
  return typeof kind === "string" ? (NODE_LABELS[kind] ?? bounded(kind, "资料")) : "资料"
}

function safeUrl(value: unknown): string {
  const raw = bounded(value)
  try {
    const url = new URL(raw)
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return bounded(url.toString())
  } catch {
    return raw.replace(/\?.*$/u, "?[已隐藏]")
  }
}

function targetForNode(args: Record<string, unknown>, label?: string) {
  const kind = typeof args.kind === "string" ? args.kind : undefined
  const id = typeof args.id === "string" ? bounded(args.id) : undefined
  const title = typeof args.title === "string" ? bounded(args.title) : undefined
  return {
    ...(kind ? { kind } : {}),
    ...(id ? { id } : {}),
    label: label ?? title ?? id ?? nodeLabel(kind),
  }
}

function changedFields(args: Record<string, unknown>, excluded: readonly string[]): string {
  const keys = Object.keys(args)
    .filter((key) => !excluded.includes(key) && args[key] !== undefined)
    .slice(0, 8)
    .map((key) => {
      if (key === "title") return "标题"
      if (key === "tags") return "标签"
      if (key === "parentId") return "位置"
      if (key === "afterSortKey") return "排序"
      if (key === "content") return "正文"
      return SENSITIVE_KEY.test(key) ? "敏感字段（值已隐藏）" : "其他字段"
    })
  return keys.length ? keys.join("、") : "无可见字段"
}

function genericPreview(name: string, args: Record<string, unknown>): AgentToolPreview {
  const fieldCount = Math.min(Object.keys(args).length, 8)
  const external = /^m\d+_/u.test(name)
  const knownMutation: Readonly<
    Partial<
      Record<
        string,
        { title: string; summary: string; effect: AgentToolEffect; risk: AgentToolRisk }
      >
    >
  > = {
    [TOOL.communityPublish]: {
      title: "发布社区内容",
      summary: "将向远程社区提交内容",
      effect: "external",
      risk: "high",
    },
    [TOOL.communityDeletePublication]: {
      title: "删除社区发布",
      summary: "将删除远程社区中的内容",
      effect: "delete",
      risk: "high",
    },
    [TOOL.meUpdateProfile]: {
      title: "更新社区资料",
      summary: "将更改远程账号的公开资料",
      effect: "external",
      risk: "high",
    },
    [TOOL.hubAddSubscription]: {
      title: "添加关注",
      summary: "将更改“我的”中的关注状态",
      effect: "write",
      risk: "medium",
    },
    [TOOL.hubRemoveSubscription]: {
      title: "取消关注",
      summary: "将从“我的”中移除关注",
      effect: "delete",
      risk: "high",
    },
    [TOOL.hubAddBookmark]: {
      title: "添加书签",
      summary: "将在“我的”中保存一条书签",
      effect: "write",
      risk: "medium",
    },
    [TOOL.hostNavigate]: {
      title: "切换应用页面",
      summary: "将改变当前工作区位置",
      effect: "navigation",
      risk: "low",
    },
    [TOOL.hostOpenExternal]: {
      title: "打开外部链接",
      summary: "将把外部链接打开到内嵌浏览器",
      effect: "navigation",
      risk: "medium",
    },
  }
  const mutation = knownMutation[name]
  if (mutation) {
    return {
      toolName: bounded(name, "unknown"),
      ...mutation,
      mutating: true,
      ...(name === TOOL.hostOpenExternal && args.url
        ? { target: { label: safeUrl(args.url) } }
        : {}),
      fields: fieldCount ? [{ label: "参数", value: `${fieldCount} 个字段（值已隐藏）` }] : [],
    }
  }
  return {
    toolName: bounded(name, "unknown"),
    title: external ? "调用外部 MCP 工具" : "执行工具",
    summary: external ? "外部工具能力与副作用无法由 ideall 完整验证" : "请确认此工具调用",
    effect: external ? "external" : "read",
    risk: external ? "high" : "low",
    mutating: external,
    fields: fieldCount ? [{ label: "参数", value: `${fieldCount} 个字段（值已隐藏）` }] : [],
  }
}

export function createAgentToolPreview(name: string, input: unknown): AgentToolPreview {
  const args = record(input)
  const kind = nodeLabel(args.kind)
  switch (name) {
    case TOOL.fsCreate:
      return {
        toolName: name,
        title: `创建${kind}`,
        summary: `将在“我的”中创建一项${kind}`,
        effect: "write",
        risk: "medium",
        mutating: true,
        target: targetForNode(args),
        fields: [
          { label: "变更字段", value: changedFields(args, ["kind"]) },
          ...(args.parentId !== undefined
            ? [{ label: "父级 ID", value: bounded(args.parentId, "根目录") }]
            : []),
        ],
      }
    case TOOL.fsWrite:
      return {
        toolName: name,
        title: `修改${kind}`,
        summary: `将覆盖目标${kind}的指定字段`,
        effect: "write",
        risk: "medium",
        mutating: true,
        target: targetForNode(args),
        fields: [{ label: "变更字段", value: changedFields(args, ["kind", "id"]) }],
      }
    case TOOL.fsMove:
      return {
        toolName: name,
        title: `移动${kind}`,
        summary: `将改变目标${kind}的位置或排序`,
        effect: "write",
        risk: "medium",
        mutating: true,
        target: targetForNode(args),
        fields: [{ label: "新父级 ID", value: bounded(args.parentId, "根目录") }],
      }
    case TOOL.fsDelete:
      return {
        toolName: name,
        title: `删除${kind}`,
        summary: `目标${kind}将进入回收站或被取消`,
        effect: "delete",
        risk: "high",
        mutating: true,
        target: targetForNode(args),
        fields: [],
      }
    case TOOL.uiOpenTab:
    case TOOL.uiCloseTab: {
      const opening = name === TOOL.uiOpenTab
      return {
        toolName: name,
        title: opening ? "打开标签" : "关闭标签",
        summary: opening ? "将改变当前工作区布局" : "将关闭目标标签",
        effect: "navigation",
        risk: opening ? "low" : "medium",
        mutating: true,
        target: targetForNode(args),
        fields: [],
      }
    }
    case TOOL.browserNavigate:
      return {
        toolName: name,
        title: "导航内嵌浏览器",
        summary: "将打开外部网页",
        effect: "external",
        risk: "medium",
        mutating: true,
        target: { label: safeUrl(args.url) },
        fields: [],
      }
    case TOOL.browserClick:
      return {
        toolName: name,
        title: "点击网页元素",
        summary: "点击可能触发网页提交或状态变更",
        effect: "external",
        risk: "high",
        mutating: true,
        target: { label: bounded(args.selector, "未指定元素") },
        fields: [],
      }
    case TOOL.browserFill:
      return {
        toolName: name,
        title: "填写网页表单",
        summary: "将向外部网页输入内容；输入值不会进入预览或审计日志",
        effect: "external",
        risk: "high",
        mutating: true,
        target: { label: bounded(args.selector, "未指定输入框") },
        fields: [{ label: "输入内容", value: "已隐藏" }],
      }
    case TOOL.browserPress:
      return {
        toolName: name,
        title: "向网页发送按键",
        summary: "按键可能触发表单提交或页面操作",
        effect: "external",
        risk: "high",
        mutating: true,
        target: { label: bounded(args.key) },
        fields: [],
      }
    case TOOL.browserWait:
    case TOOL.browserWaitForSelector:
      return {
        toolName: name,
        title: "等待网页状态",
        summary: "本次操作不写入网页内容",
        effect: "read",
        risk: "low",
        mutating: false,
        fields: args.selector ? [{ label: "等待元素", value: bounded(args.selector) }] : [],
      }
    default:
      return genericPreview(name, args)
  }
}
