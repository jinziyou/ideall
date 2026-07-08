// 模块色点 (小圆点) 唯一数据来源 —— 标签条 / 状态栏共用, 杜绝两处手抄漂移。
// 仅做分类小圆点 (bg-spoke-* / bg-primary), 不大面积 fill (见 globals.css「D 皮肤」约束)。
// Tailwind v4 按源码字面量扫描生成工具类, 故此处必须是字面量类名, 不可模板拼接。
import type { ModuleId } from "./types"

export const MODULE_DOT: Record<ModuleId, string> = {
  home: "bg-primary",
  subscriptions: "bg-spoke-info",
  apps: "bg-spoke-tool",
  plugins: "bg-spoke-tool",
  shell: "bg-spoke-tool",
  git: "bg-spoke-tool",
  database: "bg-spoke-tool",
  audio: "bg-spoke-tool",
  code: "bg-spoke-tool",
  trash: "bg-destructive",
  info: "bg-spoke-info",
  community: "bg-spoke-community",
  publications: "bg-spoke-community",
  browser: "bg-spoke-tool",
  tool: "bg-spoke-tool",
  agent: "bg-primary",
}
