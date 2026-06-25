// 「我的」(home) 域类型聚合 —— 契约类型在 @protocol; 此处再导出以兼容现有 `./model` / `../model` 引用。
// (AI 助手类型已随 agent 插件迁出, 见 @/plugins/agent/lib/model。)
export type {
  StoredFile,
  FileMeta,
  BookmarkFolder,
  Bookmark,
  Note,
  NoteMeta,
  NoteContent,
  NewNote,
} from "@protocol/files"
export type { Subscription } from "@protocol/subscription"
