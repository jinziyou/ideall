// 外部 ACP 智能体检测 —— 在系统 PATH 上探测已装的 agent, 让设置里"点选即用"(免手填命令)。
// 经 Rust acp_which (纯 PATH 解析) / acp_script_path (内置脚本) 探测; 仅 App 桌面有效, web/dev 返回空。
import { isTauri } from "@/lib/tauri"
import type { ExternalAgentConfig } from "./acp-settings"

export interface DetectedAgent {
  id: string
  label: string
  note?: string
  /** 点选后写入设置的命令配置。 */
  config: ExternalAgentConfig
}

// PATH 二进制候选 (按"是否在 PATH"探测; 命中才列出)。args = 进入 ACP stdio 模式的参数。
// note 标"参数或需调整"的项: 二进制确在, 但 ACP 子命令/参数因版本而异, 点选后可在下方手改。
const BIN_CANDIDATES: ReadonlyArray<{
  id: string
  label: string
  program: string
  args: string
  note?: string
}> = [
  {
    id: "claude-agent-acp",
    label: "Claude（claude-agent-acp）",
    program: "claude-agent-acp",
    args: "",
  },
  {
    id: "claude-code-acp",
    label: "Claude Code（claude-code-acp）",
    program: "claude-code-acp",
    args: "",
  },
  { id: "gemini", label: "Gemini CLI", program: "gemini", args: "--acp" },
  { id: "qwen", label: "Qwen Code", program: "qwen", args: "--acp", note: "参数或需调整" },
  { id: "codex", label: "Codex CLI", program: "codex", args: "acp", note: "参数或需调整" },
  { id: "opencode", label: "OpenCode", program: "opencode", args: "acp", note: "参数或需调整" },
  { id: "goose", label: "goose", program: "goose", args: "acp", note: "参数或需调整" },
  { id: "amp", label: "Amp（amp-acp）", program: "amp-acp", args: "", note: "Sourcegraph 适配器" },
  {
    id: "copilot",
    label: "GitHub Copilot",
    program: "copilot",
    args: "--acp",
    note: "参数或需调整",
  },
  { id: "cursor", label: "Cursor", program: "cursor-agent", args: "", note: "参数或需调整" },
  { id: "kimi", label: "Kimi CLI", program: "kimi", args: "--acp", note: "参数或需调整" },
]

// npx 回退: 未装二进制时, 经 npx 拉起 npm 分发的适配器 (首次会下载)。仅当 npx 在 PATH 且同 id 未由二进制命中时加入。
const NPX_CANDIDATES: ReadonlyArray<{ id: string; label: string; pkg: string }> = [
  {
    id: "claude-agent-acp",
    label: "Claude（claude-agent-acp · npx）",
    pkg: "@agentclientprotocol/claude-agent-acp",
  },
  {
    id: "claude-code-acp",
    label: "Claude Code（claude-code-acp · npx）",
    pkg: "@zed-industries/claude-code-acp",
  },
]

/** 探测可用外部 ACP 智能体; 非 Tauri 返回空。 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  if (!isTauri()) return []
  const { invoke } = await import("@tauri-apps/api/core")
  const which = (program: string) => invoke<string | null>("acp_which", { program })
  const out: DetectedAgent[] = []
  const seen = new Set<string>()
  const add = (a: DetectedAgent) => {
    if (seen.has(a.id)) return
    seen.add(a.id)
    out.push(a)
  }

  // 内置 echo 测试 agent (需 node + 脚本存在; dev 态可一键验证连通)。
  try {
    const [echo, node] = await Promise.all([
      invoke<string | null>("acp_script_path", { name: "acp-echo-agent.mjs" }),
      which("node"),
    ])
    if (echo && node) {
      add({
        id: "echo",
        label: "内置回显 Agent（测试）",
        note: "无需凭证，验证连通",
        config: { program: "node", args: JSON.stringify(echo), cwd: "" },
      })
    }
  } catch {
    /* 探测失败忽略 */
  }

  // PATH 上的真实 agent (二进制)。
  for (const c of BIN_CANDIDATES) {
    try {
      if (await which(c.program)) {
        add({
          id: c.id,
          label: c.label,
          note: c.note,
          config: { program: c.program, args: c.args, cwd: "" },
        })
      }
    } catch {
      /* 单个探测失败忽略 */
    }
  }

  // npx 回退 (仅当 npx 在 PATH 且二进制未命中)。
  try {
    if (await which("npx")) {
      for (const c of NPX_CANDIDATES) {
        if (seen.has(c.id)) continue
        add({
          id: c.id,
          label: c.label,
          note: "首次会下载",
          config: { program: "npx", args: `-y ${c.pkg}`, cwd: "" },
        })
      }
    }
  } catch {
    /* 忽略 */
  }

  return out
}
