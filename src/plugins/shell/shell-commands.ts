// Shell 插件 —— Tauri shell 能力封装 (仅桌面 App)。

import { isTauri } from "@/lib/tauri"

export type ShellLine =
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string }
  | { type: "exit"; code: number }
  | { type: "error"; message: string }

export type ShellOptions = {
  cwd?: string
}

export function defaultShell(
  userAgent = typeof window !== "undefined" ? window.navigator.userAgent : "",
): { program: string; args: string[] } {
  // Tauri shell 插件不识别 $SHELL; capability 里我们允许 sh/bash/zsh/fish/cmd/powershell/pwsh。
  // 按平台选最稳的默认 shell。
  if (userAgent.includes("Win")) {
    return { program: "powershell", args: ["-Command"] }
  }
  return { program: "bash", args: ["-c"] }
}

export function normalizeShellOptions(options: ShellOptions = {}): ShellOptions | undefined {
  const cwd = options.cwd?.trim()
  return cwd ? { cwd } : undefined
}

/**
 * 执行单条命令, 返回完整输出 (stdout + stderr + exit code)。
 * 适合短命令; 长耗时命令请用 executeStreaming。
 */
export async function executeCommand(
  command: string,
  options: ShellOptions = {},
): Promise<{
  stdout: string
  stderr: string
  code: number
}> {
  if (!isTauri()) {
    throw new Error("终端仅在桌面 App 中可用")
  }
  const { Command } = await import("@tauri-apps/plugin-shell")
  const { program, args } = defaultShell()
  const result = await Command.create(
    program,
    [...args, command],
    normalizeShellOptions(options),
  ).execute()
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code ?? -1,
  }
}

/**
 * 流式执行命令, 通过回调逐行接收 stdout/stderr/exit。
 * 返回一个可调用以 kill 进程的函数。
 */
export async function executeStreaming(
  command: string,
  onLine: (line: ShellLine) => void,
  options: ShellOptions = {},
): Promise<() => void> {
  if (!isTauri()) {
    onLine({ type: "error", message: "终端仅在桌面 App 中可用" })
    return () => {}
  }
  const { Command } = await import("@tauri-apps/plugin-shell")
  const { program, args } = defaultShell()
  const cmd = Command.create(program, [...args, command], normalizeShellOptions(options))

  cmd.on("error", (message) => {
    onLine({ type: "error", message })
  })
  cmd.stdout.on("data", (line) => {
    onLine({ type: "stdout", text: line })
  })
  cmd.stderr.on("data", (line) => {
    onLine({ type: "stderr", text: line })
  })
  cmd.on("close", (payload) => {
    onLine({ type: "exit", code: payload.code ?? 0 })
  })

  const child = await cmd.spawn()
  return () => {
    void child.kill()
  }
}
