// ACP 接入设置 —— 本地优先, 仅存本机 localStorage。
// 暴露方向 (编辑器经 ACP 连入 ideall): 是否允许 + 监听端口。仅 App 桌面生效 (web/dev 无监听器)。
export const ACP_SETTINGS_STORAGE_KEY = "ideall:acp:settings"

export type AgentExecutionBackend = "model" | "external-acp"

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
  /** 对话执行后端；外部 ACP 仅在桌面 App 且命令已配置时可用。 */
  executionBackend: AgentExecutionBackend
}

export const DEFAULT_ACP_SETTINGS: AcpSettings = {
  allowEditorConnect: false,
  listenPort: 0,
  externalAgent: { program: "", args: "", cwd: "" },
  executionBackend: "model",
}

function safeCommandField(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || /[\u0000\r\n]/u.test(value)) return ""
  return value.slice(0, maxLength)
}

export function isExternalAcpConfigured(settings: AcpSettings): boolean {
  return settings.externalAgent.program.trim().length > 0
}

/** 解析持久化串为设置 (纯函数, 便于单测): null/非法 → 默认; 部分字段 → 与默认合并。 */
export function parseAcpSettings(raw: string | null): AcpSettings {
  if (!raw) return DEFAULT_ACP_SETTINGS
  try {
    const p = JSON.parse(raw) as Partial<AcpSettings>
    const portOk =
      typeof p.listenPort === "number" &&
      Number.isInteger(p.listenPort) &&
      p.listenPort >= 0 &&
      p.listenPort <= 65535
    const ea: Partial<ExternalAgentConfig> = p.externalAgent ?? {}
    return {
      allowEditorConnect: Boolean(p.allowEditorConnect),
      listenPort: portOk ? (p.listenPort as number) : DEFAULT_ACP_SETTINGS.listenPort,
      externalAgent: {
        program: safeCommandField(ea.program, 512),
        args: safeCommandField(ea.args, 8_192),
        cwd: safeCommandField(ea.cwd, 4_096),
      },
      executionBackend: p.executionBackend === "external-acp" ? "external-acp" : "model",
    }
  } catch {
    return DEFAULT_ACP_SETTINGS
  }
}

// getSnapshot 引用稳定: 缓存原始串与解析结果。
let lastRaw: string | null = null
let lastParsed: AcpSettings = DEFAULT_ACP_SETTINGS
const listeners = new Set<() => void>()

function readSettingsRaw(): string | null {
  return localStorage.getItem(ACP_SETTINGS_STORAGE_KEY)
}

export function getAcpSettings(): AcpSettings {
  if (typeof localStorage === "undefined") return DEFAULT_ACP_SETTINGS
  let raw: string | null = null
  try {
    raw = readSettingsRaw()
  } catch {
    return DEFAULT_ACP_SETTINGS
  }
  if (raw === lastRaw) return lastParsed
  lastParsed = parseAcpSettings(raw)
  const normalizedRaw = JSON.stringify(lastParsed)
  lastRaw = normalizedRaw
  if (raw !== null && raw !== normalizedRaw) {
    try {
      localStorage.setItem(ACP_SETTINGS_STORAGE_KEY, normalizedRaw)
    } catch {}
  }
  return lastParsed
}

export function setAcpSettings(next: AcpSettings): void {
  const normalized = parseAcpSettings(JSON.stringify(next))
  try {
    localStorage.setItem(ACP_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    /* 隐私模式 / 存储受限时忽略 */
  }
  for (const l of listeners) l()
}

export function subscribeAcpSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
