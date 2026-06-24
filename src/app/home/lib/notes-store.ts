// 笔记本地存储仓库 —— 基于 IndexedDB。Notion 式「目录即页面」递归页树:
// 每个 Note 既是页面又是目录, 经 parentId 无限嵌套; 同级以 sortKey (fractional index) 排序。
// 照 bookmarks-store / files-store 的本地优先模式: 列表只回元数据 + 摘要, 完整正文按需单取。
// 删除走软删墓碑 (deletedAt, 与订阅一致), 以便跨端传播删除; 读路径过滤墓碑。
import { Note, NoteMeta, NoteContent, NewNote } from "../model"
import type { NodeKind } from "@protocol/node"
import { genId } from "@/components/lib/id"
import { isLive, expiredTombstoneIdsToDelete } from "@protocol/sync"
import { sortKeyBetween } from "./sort-key"
import { planNotesTreeMigration } from "./notes-migrate"
import { planNodesSeed } from "./nodes-migrate"
import { effectiveParentId, buildParentOf, cmpSibling } from "./notes-tree-util"
import {
  seedBlockMeta,
  diffBlocks,
  applyBlockPatch,
  blockMapById,
  type Block,
  type BlockMetaMap,
} from "./note-blocks"
import {
  idbBulkDelete,
  idbBulkPut,
  idbBulkPutDelete,
  idbGet,
  idbGetAll,
  idbPut,
  idbReadModifyWrite,
  STORE_NOTES,
  STORE_NOTEBOOKS,
  STORE_NODES,
} from "@/components/lib/idb"
import { notifyHubUpdated } from "./flowback"

/** 笔记的物理存储形态 = Note + kind 辨识位 (统一 nodes 仓库按 kind 收纳)。 */
type NoteRow = Note & { kind: "note" }
const KIND_NOTE: NodeKind = "note"

/** 给一条 Note 打上 kind:"note" (写 nodes 仓库前归一)。 */
function asNoteRow(note: Note): NoteRow {
  return { ...note, kind: "note" }
}

/** 稳定的本设备 id (块级 LWW 的 by; 跨设备 tiebreak 确定性)。 */
let deviceIdCache: string | null = null
function deviceId(): string {
  if (deviceIdCache) return deviceIdCache
  try {
    const k = "ideall:device:v1"
    let v = typeof localStorage !== "undefined" ? localStorage.getItem(k) : null
    if (!v) {
      v = genId("dev")
      try {
        localStorage.setItem(k, v)
      } catch {
        /* 隐私模式 → 仅本会话内存稳定 */
      }
    }
    deviceIdCache = v
  } catch {
    deviceIdCache = "local"
  }
  return deviceIdCache
}

/** 确保笔记带稳定块 id + blockMeta (旧记录懒补; content 归一为非空)。返回归一后的 content+blockMeta。 */
function ensureBlocks(note: NoteRow): { content: NoteContent; blockMeta: BlockMetaMap } {
  const content =
    Array.isArray(note.content) && note.content.length ? note.content : emptyNoteContent()
  if (note.blockMeta && Object.keys(note.blockMeta).length) {
    return { content, blockMeta: note.blockMeta }
  }
  const seeded = seedBlockMeta(note.id, content as Block[], deviceId())
  return { content: seeded.content as NoteContent, blockMeta: seeded.blockMeta }
}

/** 空文档: 单个空段落 (Plate 段落块 type "p")。 */
export function emptyNoteContent(): NoteContent {
  return [{ type: "p", children: [{ text: "" }] }]
}

/**
 * 递归收集块文档里的纯文本 —— 用于搜索与列表摘要。
 * 零依赖, 不引 platejs: 任何带字符串 `text` 的节点取其文本, 带 `children` 数组的递归下钻。
 */
export function noteText(content: NoteContent): string {
  const parts: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const n = node as { text?: unknown; children?: unknown }
    if (typeof n.text === "string") parts.push(n.text)
    if (Array.isArray(n.children)) {
      for (const child of n.children) walk(child)
    }
  }
  for (const block of content) walk(block)
  // 块间以空格分隔, 折叠多余空白, 便于摘要与大小写无关搜索
  return parts.join(" ").replace(/\s+/g, " ").trim()
}

/**
 * 剥离完整 content, 回列表元数据 (含纯文本摘要 + 全文 + 是否有子页)。
 * withText=false 时跳过递归遍历块树取全文 (excerpt/search 留空) —— 供只需 标题/时间 的消费方提速。
 */
function toMeta(note: Note, hasChildren: boolean, withText: boolean): NoteMeta {
  const text = withText ? noteText(note.content) : ""
  return {
    id: note.id,
    title: note.title,
    parentId: note.parentId,
    sortKey: note.sortKey,
    tags: note.tags,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    excerpt: text.slice(0, 160),
    search: text,
    hasChildren,
  }
}

// ---- 懒迁移: 旧「笔记本→笔记」扁平模型 → 递归页树 ----

let migrationPromise: Promise<void> | null = null

/**
 * 幂等懒迁移 (模块级 once): notebookId→parentId + sortKey, 旧笔记本→根级目录页 (复用 notebook.id)。
 * 每个读写入口先 await 此函数。失败不缓存 (置回 null), 下次读路径可重试 (上层 toast)。
 * 不放在 idb 的 onupgradeneeded 内: 那里报错会 abort DB open 且无恢复 UI、大库经 onblocked 冻结全部读写。
 */
export function migrateNotesTreeOnce(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = doMigrateNotesTree().catch((e) => {
      migrationPromise = null
      throw e
    })
  }
  return migrationPromise
}

async function doMigrateNotesTree(): Promise<void> {
  const [rawNotes, rawNotebooks] = await Promise.all([
    idbGetAll<Record<string, unknown>>(STORE_NOTES),
    idbGetAll<Record<string, unknown>>(STORE_NOTEBOOKS),
  ])
  const plan = planNotesTreeMigration(rawNotes, rawNotebooks, Date.now())
  if (!plan) return // 无存量 / 已迁移
  // 先写 notes (目录页 + 转换后笔记) 再清空旧 noteNotebooks; 顺序 put→delete 不丢数据, 探测保证幂等。
  if (plan.puts.length) await idbBulkPut(STORE_NOTES, plan.puts)
  if (plan.deleteNotebookIds.length) await idbBulkDelete(STORE_NOTEBOOKS, plan.deleteNotebookIds)
}

// ---- 懒迁移: 折叠步 A —— 笔记播种进统一 nodes 仓库 (加 kind:"note") ----

let seedPromise: Promise<void> | null = null

/**
 * 折叠步 A 懒迁移 (模块级 once): 先跑旧「笔记本→树」迁移 (STORE_NOTES), 再把笔记播种进 STORE_NODES
 * (加 kind:"note") 并清空旧 notes 仓库 (单一真相)。所有读写入口先 await 此函数。
 * 失败不缓存 (置回 null), 下次读路径可重试。不放 onupgradeneeded 内 (同 migrateNotesTreeOnce 理由)。
 */
export function seedNodesOnce(): Promise<void> {
  if (!seedPromise) {
    seedPromise = doSeedNodes().catch((e) => {
      seedPromise = null
      throw e
    })
  }
  return seedPromise
}

async function doSeedNodes(): Promise<void> {
  await migrateNotesTreeOnce() // 步 A 之前: 旧扁平笔记本 → 递归树 (仍在 STORE_NOTES 内)
  const [rawNotes, existingNodes] = await Promise.all([
    idbGetAll<Record<string, unknown>>(STORE_NOTES),
    idbGetAll<{ id: string }>(STORE_NODES),
  ])
  const plan = planNodesSeed(rawNotes, new Set(existingNodes.map((n) => n.id)))
  if (!plan) return // 旧 notes 仓库已空 (无存量 / 已播种清空)
  // 先写 nodes 再清空旧 notes; 顺序 put→delete 不丢数据, existingNodeIds 探测保证幂等。
  if (plan.puts.length) await idbBulkPut(STORE_NODES, plan.puts)
  if (plan.drainNoteIds.length) await idbBulkDelete(STORE_NOTES, plan.drainNoteIds)
}

/**
 * 取 nodes 仓库内全部「笔记」节点 (按 kind 过滤, 含墓碑)。其余 kind 节点 (后续折叠 B/C/D 入库) 不返回 ——
 * 这是 notes-store 在统一 nodes 仓库下只见笔记的边界, 防 listNotes / 同步 GC 误伤其它 kind。
 */
async function allNoteNodes(): Promise<NoteRow[]> {
  const all = await idbGetAll<Partial<NoteRow> & { id: string; kind?: NodeKind }>(STORE_NODES)
  return all.filter((n): n is NoteRow => n.kind === KIND_NOTE)
}

// ---- 内部: 子树 / sortKey 计算 ----

/** 从 rootId 向下 BFS, 收集其整棵子树的 id (含 rootId 自身)。 */
function collectSubtreeIds(rootId: string, notes: Note[]): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const n of notes) {
    if (n.parentId == null) continue
    const arr = childrenOf.get(n.parentId) ?? []
    arr.push(n.id)
    childrenOf.set(n.parentId, arr)
  }
  const ids = new Set<string>([rootId])
  const queue: string[] = [rootId]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const child of childrenOf.get(cur) ?? []) {
      if (!ids.has(child)) {
        ids.add(child)
        queue.push(child)
      }
    }
  }
  return ids
}

/**
 * 为某父页下「新增 / 移动」的项算同级 sortKey。pos.afterSortKey:
 *   - undefined (pos 省略) → 追加同级末尾
 *   - null                → 插到同级开头 (拖到首位之前)
 *   - "<键>"              → 插到该兄弟键之后
 * excludeId 在移动时排除自身, 避免与自己的旧键比较。
 */
type InsertPos = { afterSortKey?: string | null }
function computeSortKey(
  live: Note[],
  parentId: string | null,
  pos: InsertPos | undefined,
  excludeId?: string,
): string {
  const parentOf = buildParentOf(live)
  const siblingKeys = live
    .filter((n) => n.id !== excludeId && effectiveParentId(n.id, n.parentId, parentOf) === parentId)
    .map((n) => n.sortKey)
    .filter((k) => typeof k === "string" && k.length > 0)
    .sort()
  const first = siblingKeys.length ? siblingKeys[0] : null
  const last = siblingKeys.length ? siblingKeys[siblingKeys.length - 1] : null
  const append = () => sortKeyBetween(last, null)
  const after = pos?.afterSortKey
  if (after === undefined) return append()
  if (after === null) {
    try {
      return sortKeyBetween(null, first)
    } catch {
      return append()
    }
  }
  const idx = siblingKeys.indexOf(after)
  if (idx === -1) return append()
  const next = idx + 1 < siblingKeys.length ? siblingKeys[idx + 1] : null
  try {
    return sortKeyBetween(after, next)
  } catch {
    // 退化键 (跨端并发产生失序/重复键) 兜底: 追加末尾。
    return append()
  }
}

// ---- 笔记 (读) ----

/**
 * 列出所有活跃笔记元数据 (过滤墓碑, 不含完整 content), 默认按最近编辑倒序。
 * 树结构由 parentId + sortKey 表达, 调用方 (页树 UI) 自行按 effectiveParent + sortKey 组装层级。
 * opts.text=false 跳过全文 walk (excerpt/search 留空), 供只用 标题/时间 的消费方提速。
 */
export async function listNotes(opts?: { text?: boolean }): Promise<NoteMeta[]> {
  await seedNodesOnce()
  const withText = opts?.text !== false
  const all = await allNoteNodes()
  const live = all.filter(isLive)
  const parentOf = buildParentOf(live)
  const parentsWithChildren = new Set<string>()
  for (const n of live) {
    const ep = effectiveParentId(n.id, n.parentId, parentOf)
    if (ep != null) parentsWithChildren.add(ep)
  }
  return live
    .map((n) => toMeta(n, parentsWithChildren.has(n.id), withText))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 列出某父页下的活跃直接子页面 (按同级序)。parentId=null 为根级。 */
export async function listNoteChildren(parentId: string | null): Promise<NoteMeta[]> {
  await seedNodesOnce()
  const all = await allNoteNodes()
  const live = all.filter(isLive)
  const parentOf = buildParentOf(live)
  const parentsWithChildren = new Set<string>()
  for (const n of live) {
    const ep = effectiveParentId(n.id, n.parentId, parentOf)
    if (ep != null) parentsWithChildren.add(ep)
  }
  return live
    .filter((n) => effectiveParentId(n.id, n.parentId, parentOf) === parentId)
    .map((n) => toMeta(n, parentsWithChildren.has(n.id), false))
    .sort(cmpSibling)
}

/** 取从根到「该页的直接父」的祖先链 (不含自身), 面包屑用。按 effectiveParentId 上溯, 与页树一致 (环成员归根)。 */
export async function getAncestors(id: string): Promise<NoteMeta[]> {
  await seedNodesOnce()
  const all = await allNoteNodes()
  const live = all.filter(isLive)
  const byId = new Map(live.map((n) => [n.id, n]))
  const parentOf = buildParentOf(live)
  const chain: NoteMeta[] = []
  const seen = new Set<string>([id])
  const start = byId.get(id)
  let curParent = start ? effectiveParentId(start.id, start.parentId, parentOf) : null
  while (curParent != null && byId.has(curParent) && !seen.has(curParent)) {
    seen.add(curParent)
    const parent = byId.get(curParent) as Note
    chain.unshift(toMeta(parent, true, false))
    curParent = effectiveParentId(parent.id, parent.parentId, parentOf)
  }
  return chain
}

/** 读取单条完整笔记 (含 content); 已删除 (墓碑) 或非笔记 kind 视为不存在。 */
export async function getNote(id: string): Promise<Note | undefined> {
  await seedNodesOnce()
  const note = await idbGet<NoteRow>(STORE_NODES, id)
  if (!note || note.kind !== KIND_NOTE || !isLive(note)) return undefined
  // 确保带稳定块 id + blockMeta (旧记录懒补; 编辑器据此与本地块版本对齐); 空正文归一为合法空文档。
  const { content, blockMeta } = ensureBlocks(note)
  return { ...note, content, blockMeta }
}

/** 活跃笔记数 (过滤墓碑) —— 数量徽标用。目录页也计入 (「目录也是文件」)。 */
export async function countNotes(): Promise<number> {
  await seedNodesOnce()
  const all = await allNoteNodes()
  return all.filter(isLive).length
}

// ---- 笔记 (写) ----

export async function addNote(input: NewNote = {}): Promise<Note> {
  await seedNodesOnce()
  const all = await allNoteNodes()
  const live = all.filter(isLive)
  const parentId = input.parentId ?? null
  // NewNote.afterSortKey: null/缺省 = 追加末尾; 字符串 = 插到该兄弟之后。
  const sortKey = computeSortKey(
    live,
    parentId,
    input.afterSortKey == null ? undefined : { afterSortKey: input.afterSortKey },
  )
  const now = Date.now()
  const id = genId("note")
  // 补稳定块 id + 初始 blockMeta (§7): 新笔记一落库即块级就绪, 后续编辑/同步走块级合并。
  const seeded = seedBlockMeta(id, (input.content ?? emptyNoteContent()) as Block[], deviceId())
  const note: Note = {
    id,
    title: input.title?.trim() ?? "",
    content: seeded.content as NoteContent,
    parentId,
    sortKey,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
    blockMeta: seeded.blockMeta,
  }
  await idbPut(STORE_NODES, asNoteRow(note))
  notifyHubUpdated({ kind: "note", id })
  return note
}

/** 更新笔记 (标题 / 正文 / 标签 / 父 / 排序); 自动刷新 updatedAt。单事务读-改-写防并发丢更新。 */
export async function updateNote(
  id: string,
  patch: Partial<Pick<Note, "title" | "content" | "tags" | "parentId" | "sortKey">>,
): Promise<Note | undefined> {
  await seedNodesOnce()
  const next = await idbReadModifyWrite<NoteRow>(STORE_NODES, id, (current) => {
    if (!current || current.kind !== KIND_NOTE) return undefined // 不存在 / 非笔记 kind → 不写
    const now = Date.now()
    const base = ensureBlocks(current) // 当前存量的 content+blockMeta (带稳定块 id)
    let content = base.content
    let blockMeta = base.blockMeta
    // 正文变更 → 块级补丁维护 blockMeta (§7): 相对存量算 diff, per-block v 自增, 未变块沿用旧 (sk/v)。
    // 注: 这里 base = 存量 (非编辑器 mount-base), 故能正确递增 v 且无版本 skip; 代价是与并发追加块的
    // 严格防夹击 (§7.3 编辑器 mount-base) 留作 P5 后续 —— 跨端合并 (主场景) 已由 notes-sync 块级合并保障。
    if (patch.content !== undefined) {
      // 为缺 id 的块补 id (NodeIdPlugin 通常已注入; 防御非编辑器调用方传入无 id 块)。
      const cur = (patch.content as Block[]).map((b) =>
        typeof b.id === "string" && b.id ? b : { ...b, id: genId("blk") },
      )
      const bp = diffBlocks(blockMapById(base.content as Block[]), blockMeta, cur, deviceId())
      const applied = applyBlockPatch(base.content as Block[], blockMeta, bp, now)
      content = applied.content as NoteContent
      blockMeta = applied.blockMeta
    }
    const { content: _ignored, ...rest } = patch // content 已经块级处理, 不再原样覆盖
    void _ignored
    return { ...current, ...rest, content, blockMeta, kind: "note", updatedAt: now }
  })
  if (next) notifyHubUpdated({ kind: "note", id })
  return next
}

/**
 * 移动页面到新父 (+ 可选插到某兄弟之后)。带环检测: 禁止移到自身或其后代之下 (从 id 向下 BFS 收后代集)。
 * 只改本节点一行 (parentId + sortKey + updatedAt)。
 */
export async function moveNote(
  id: string,
  newParentId: string | null,
  pos?: InsertPos,
): Promise<Note | undefined> {
  await seedNodesOnce()
  const all = await allNoteNodes()
  const live = all.filter(isLive)
  if (!live.some((n) => n.id === id)) return undefined
  const subtree = collectSubtreeIds(id, live) // 含 id 自身
  if (newParentId !== null && subtree.has(newParentId)) {
    throw new Error("不能把页面移动到它自己的子页面下")
  }
  const sortKey = computeSortKey(live, newParentId, pos, id)
  const next = await idbReadModifyWrite<NoteRow>(STORE_NODES, id, (current) =>
    current && current.kind === KIND_NOTE
      ? { ...current, parentId: newParentId, sortKey, updatedAt: Date.now() }
      : undefined,
  )
  if (next) notifyHubUpdated()
  return next
}

/**
 * 级联删除整棵子树 (软删墓碑): 整棵子树写 deletedAt + 清空 content (压缩墓碑; 撤销靠返回的内存快照)。
 * 返回被删的完整笔记 (含正文), 供 restoreSubtree 撤销。
 */
export async function deleteNote(id: string): Promise<Note[]> {
  await seedNodesOnce()
  const all = await allNoteNodes()
  const live = all.filter(isLive)
  const subtreeIds = collectSubtreeIds(id, live)
  const byId = new Map(live.map((n) => [n.id, n]))
  const captured = [...subtreeIds].map((i) => byId.get(i)).filter((n): n is NoteRow => n != null)
  if (!captured.length) return []
  const now = Date.now()
  // 墓碑: deletedAt 置位 + 正文清空 (墓碑只需进合并/传播删除; 撤销用 captured 内存快照)。
  const tombstones: NoteRow[] = captured.map((n) => ({
    ...n,
    kind: "note",
    content: [],
    deletedAt: now,
    updatedAt: now,
  }))
  await idbBulkPut(STORE_NODES, tombstones)
  notifyHubUpdated()
  return captured
}

/**
 * 撤销级联删除: 把捕获的整棵子树原样写回 (含正文), 清除墓碑并 bump updatedAt
 * (使复活在 LWW 下胜过刚写的墓碑, 跨端不被重新删除)。
 */
export async function restoreSubtree(notes: Note[]): Promise<void> {
  if (!notes.length) return
  const now = Date.now()
  const revived = notes.map((n) => {
    const copy: NoteRow = { ...n, kind: "note", updatedAt: now }
    delete copy.deletedAt
    return copy
  })
  await idbBulkPut(STORE_NODES, revived)
  notifyHubUpdated()
}

// ---- 跨端同步钩子 (供 sync 插件经 HubDataPort 调用) ----

/** 列出全部笔记含墓碑 + 完整正文 —— 同步合并/上传用。 */
export async function listAllNotes(): Promise<Note[]> {
  await seedNodesOnce()
  return allNoteNodes()
}

/** 同步落地: 写入合并 + GC 后的权威全集, 并物理清除集合外的过期墓碑 (一次事务批处理)。 */
export async function bulkPutNotes(notes: Note[]): Promise<void> {
  await seedNodesOnce()
  // 写前归一 kind:"note" (远端/旧端记录可能无 kind), 同步块加 kind 对旧端向后兼容 (额外字段被忽略)。
  const rows = notes.map(asNoteRow)
  // existing 按 note 作用域取 —— 过期墓碑 GC 只针对笔记, 绝不波及 nodes 仓库内其它 kind 的记录。
  const existing = await allNoteNodes()
  const keepIds = new Set(rows.map((n) => n.id))
  const toDelete = expiredTombstoneIdsToDelete(existing, keepIds, Date.now())
  await idbBulkPutDelete(STORE_NODES, rows, toDelete)
  notifyHubUpdated()
}
