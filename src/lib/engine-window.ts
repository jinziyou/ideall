"use client"

import { isTauri } from "@/lib/tauri"
import {
  buildEngineWindowLabel,
  buildEngineWindowUrl,
  type EngineWindowTarget,
} from "@/lib/engine-window-target"

export type EngineWindowOpenResult =
  { mode: "app-window"; label: string; url: string } | { mode: "browser-tab"; url: string }

function randomNonce(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  }
  throw new Error("当前环境无法安全创建唯一窗口标识")
}

/**
 * 用指定引擎在独立窗口打开文件。
 *
 * Tauri 由受限 Rust 命令创建 `engine-*` 窗口；该 label 不匹配主窗口 capability，
 * 因而不会继承安全存储、HTTP、Shell 等 IPC 权限。纯 Web 开发环境退化为浏览器新标签。
 */
export async function openEngineWindow(
  fileKey: string,
  engineId: string,
): Promise<EngineWindowOpenResult> {
  if (typeof window === "undefined") throw new Error("独立引擎窗口只能在客户端打开")

  const target: EngineWindowTarget = { fileKey, engineId }
  const url = buildEngineWindowUrl(target, window.location.pathname)
  if (!isTauri()) {
    const opened = window.open(url, "_blank", "noopener,noreferrer")
    // 某些浏览器即使接受 noopener 仍返回 WindowProxy；显式断开作兼容兜底。
    if (opened) opened.opener = null
    return { mode: "browser-tab", url }
  }

  const label = buildEngineWindowLabel(target, randomNonce())
  const { invoke } = await import("@tauri-apps/api/core")
  const opened = await invoke<{ label: string; url: string }>("open_engine_window", {
    label,
    url,
  })
  if (opened.label !== label || opened.url !== url) {
    throw new Error("原生窗口返回了不一致的目标")
  }
  return { mode: "app-window", ...opened }
}
