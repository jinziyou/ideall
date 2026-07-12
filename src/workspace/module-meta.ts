// 旧模块目录与 href/搜索等兼容入口共用的身份数据：label + icon (+ 分区色)。
// 五分区产品导航由 navigation-sections.ts 独立定义；本表不是当前可见导航的信息架构。
// 注: 分区色存「字面量类名」(dot=小圆点 bg-spoke-*; tint=图标着色 text-spoke-*) ——
//     Tailwind v4 按源码字面量扫描生成工具类, 不可用模板拼接 (拼接会被当成未用而不生成 → 掉色)。
import {
  Bookmark,
  Braces,
  Database,
  FileAudio,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  LayoutGrid,
  Blocks,
  Map,
  Megaphone,
  Newspaper,
  FileText,
  Rss,
  Shell,
  Trash2,
  Wrench,
} from "lucide-react"
import type { ComponentType } from "react"

type Icon = ComponentType<{ className?: string }>

export type ModuleMeta = {
  label: string
  icon: Icon
  /** 小圆点分类色 (导航分区点)。Tailwind 字面量。 */
  dotClass?: string
  /** 图标着色分类色 (工作区活动栏)。Tailwind 字面量。 */
  tintClass?: string
}

/** 在兼容模块与导航入口中重复出现、需保持一致的模块身份原子。 */
export const MODULE_META = {
  overview: { label: "我的", icon: LayoutDashboard },
  // 产品区段名是「文件」; 底层 place/kind 仍为 notes/note。
  notes: { label: "文件", icon: FileText },
  subscriptions: { label: "关注", icon: Rss, tintClass: "text-spoke-info" },
  publications: {
    label: "发布",
    icon: Megaphone,
    dotClass: "bg-spoke-community",
    tintClass: "text-spoke-community",
  },
  resources: { label: "资源", icon: FolderOpen },
  bookmarks: { label: "书签", icon: Bookmark },
  info: { label: "资讯", icon: Newspaper, dotClass: "bg-spoke-info", tintClass: "text-spoke-info" },
  community: {
    label: "社区",
    icon: Map,
    dotClass: "bg-spoke-community",
    tintClass: "text-spoke-community",
  },
  tool: { label: "工具", icon: Wrench, dotClass: "bg-spoke-tool", tintClass: "text-spoke-tool" },
  apps: { label: "应用", icon: LayoutGrid, tintClass: "text-spoke-tool" },
  plugins: { label: "插件", icon: Blocks, tintClass: "text-spoke-tool" },
  shell: { label: "终端", icon: Shell, tintClass: "text-spoke-tool" },
  git: { label: "Git", icon: GitBranch, tintClass: "text-spoke-tool" },
  database: { label: "数据库", icon: Database, tintClass: "text-spoke-tool" },
  audio: { label: "音频", icon: FileAudio, tintClass: "text-spoke-tool" },
  code: { label: "Code", icon: Braces, tintClass: "text-spoke-tool" },
  trash: { label: "回收站", icon: Trash2, tintClass: "text-destructive" },
} satisfies Record<string, ModuleMeta>
