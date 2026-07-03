// AI 能力位 → 友好标签 (唯一数据来源)。供「上下文组合器」「工作空间侧栏」「全局设置」共用。
// 顺序 = AGENT_PERMISSIONS; 只列 agent 默认集, 不含私密读位 (fs.notes:read / fs.blobs:read; 隐私三闸)。

import type { Permission } from "@/plugins/embed/protocol"

export interface CapabilityOption {
  perm: Permission
  label: string
  hint: string
}

export const CAPABILITY_OPTIONS: CapabilityOption[] = [
  { perm: "fs:read", label: "读取「我的」", hint: "列出关注 / 书签 / 资源 / 笔记标题" },
  { perm: "fs:write", label: "修改「我的」", hint: "增改书签 / 收藏夹 / 关注" },
  { perm: "fs.notes:write", label: "写入笔记", hint: "新建 / 编辑笔记" },
  { perm: "ui.tabs", label: "打开标签", hint: "把节点打开为工作区标签页" },
  { perm: "web:search", label: "联网搜索", hint: "web.search 搜索引擎" },
  { perm: "web:fetch", label: "抓取网页", hint: "web.fetch 读取网页正文" },
  { perm: "browser:read", label: "读浏览器页", hint: "getContent / listInteractive" },
  { perm: "browser:control", label: "操控浏览器", hint: "navigate / click / fill / wait" },
]

const BY_PERM = new Map(CAPABILITY_OPTIONS.map((c) => [c.perm, c]))

/** 能力位 → 短标签 (未知位回退原串)。 */
export function capabilityLabel(perm: Permission): string {
  return BY_PERM.get(perm)?.label ?? perm
}
