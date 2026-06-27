// ACP 接入设置 —— 本地优先, 仅存本机 localStorage。
// 暴露方向 (编辑器经 ACP 连入 ideall): 是否允许 + 监听端口。仅 App 桌面生效 (web/dev 无监听器)。
const KEY = "wonita:acp:settings"

/** 客户端方向: 要驱动的外部 ACP 智能体命令 (用户配置, 非模型可控)。 */
export interface ExternalAgentConfig {
  /** 可执行程序 (如 npx / claude-code-acp / gemini)。 */
  program: string
  /** 命令参数 (空白分隔, 如 "--acp")。 */
  args: string
  /** 工作目录 (绝对路径; 空 = 由调用方兜底)。 */
  cwd: string
}

export interface AcpSettings {
  /** 允许外部编辑器经 ACP 连入 (开启 loopback 监听)。 */
  allowEditorConnect: boolean
  /** 监听端口 (0 = 由系统自动分配)。 */
  listenPort: number
  /** 客户端方向要驱动的外部智能体命令。 */
  externalAgent: ExternalAgentConfig
}

export const DEFAULT_ACP_SETTINGS: AcpSettings = {
  allowEditorConnect: false,
  listenPort: 0,
  externalAgent: { program: "", args: "", cwd: "" },
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** 解析持久化串为设置 (纯函数, 便于单测): null/非法 → 默认; 部分字段 → 与默认合并。 */
export function parseAcpSettings(raw: string | null): AcpSettings {
  if (!raw) return DEFAULT_ACP_SETTINGS
  try {
    const p = JSON.parse(raw) as Partial<AcpSettings>
    const portOk = typeof p.listenPort === "number" && p.listenPort >= 0 && p.listenPort <= 65535
    const ea: Partial<ExternalAgentConfig> = p.externalAgent ?? {}
    return {
      allowEditorConnect: Boolean(p.allowEditorConnect),
      listenPort: portOk ? (p.listenPort as number) : DEFAULT_ACP_SETTINGS.listenPort,
      externalAgent: { program: str(ea.program), args: str(ea.args), cwd: str(ea.cwd) },
    }
  } catch {
    return DEFAULT_ACP_SETTINGS
  }
}

// getSnapshot 引用稳定: 缓存原始串与解析结果。
let lastRaw: string | null = null
let lastParsed: AcpSettings = DEFAULT_ACP_SETTINGS
const listeners = new Set<() => void>()

export function getAcpSettings(): AcpSettings {
  if (typeof localStorage === "undefined") return DEFAULT_ACP_SETTINGS
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return DEFAULT_ACP_SETTINGS
  }
  if (raw === lastRaw) return lastParsed
  lastRaw = raw
  lastParsed = parseAcpSettings(raw)
  return lastParsed
}

export function setAcpSettings(next: AcpSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式 / 存储受限时忽略 */
  }
  for (const l of listeners) l()
}

export function subscribeAcpSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
