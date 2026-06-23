"use client"

import * as React from "react"

// 全局在线/离线感知 (B-2) —— 包 navigator.onLine + online/offline 事件, 供同步面板 / 订阅流 /
// EmbedHost 等取数路径在断网时优先给「离线」提示 + 重试, 而非把失败误导成「内容已删除 / 不存在」。
// 本地优先能力 (笔记 / 书签 / 资源) 不受影响, 仅用于远端取数的失败归因。

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

function getSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine
}

// SSR 预渲染期假定在线, 避免与客户端首帧水合不一致。
function getServerSnapshot(): boolean {
  return true
}

/** 返回当前是否在线; online/offline 事件触发时自动更新。SSR 安全。 */
export function useOnlineStatus(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
