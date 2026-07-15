// 笔记本地存储仓库 —— 基于 IndexedDB。Notion 式「目录即页面」递归页树:
// 每个 Note 既是页面又是目录, 经 parentId 无限嵌套; 同级以 sortKey (fractional index) 排序。
// 照 bookmarks-store / files-store 的本地优先模式: 列表只回元数据 + 摘要, 完整正文按需单取。
// 删除走软删标记 (deletedAt, 与关注一致), 以便跨端传播删除; 读路径过滤删除标记。
import { Note, NoteMeta, NoteContent, NewNote } from "@protocol/files"
import type { Node, NodeKind, NodeOfKind } from "@protocol/node"
import { genId } from "@/lib/id"
import { isLive, expiredTombstoneIdsToDelete, recordsEqual } from "@protocol/sync"
import { StorageSyncConflictError } from "@protocol/storage-sync"
import { sortKeyBetween } from "@/files/sort-key"
import { effectiveParentId, buildParentOf, cmpSibling } from "@/files/notes-tree-util"
import {
  seedBlockMeta,
  diffBlocks,
  applyBlockPatch,
  blockMapById,
  type Block,
  type BlockMetaMap,
} from "@/files/note-blocks"
import {
  idbBulkPut,
  idbGet,
  idbGetAllFromIndex,
  idbReadModifyWrite,
  idbRunTransaction,
  INDEX_NODES_KIND,
  STORE_NODES,
  STORE_TRASH_SNAPSHOTS,
} from "@/lib/idb"
import { notifyFilesUpdated } from "@protocol/flowback"
import type { TrashSnapshot } from "@/files/stores/trash-store"
import { addNodeAtKindTail } from "@/files/stores/node-tail-transaction"
import {
  assertNodeMutationExpectation,
  type NodeMutationExpectation,
} from "@/files/stores/node-mutation"
import { noteText } from "@/files/note-text"
import { nextUpdatedAt } from "@/files/version"

export { noteText } from "@/files/note-text"

/** 笔记的物理存储形态 = Note + kind 辨识位 (统一 nodes 仓库按 kind 收纳)。 */
type NoteRow = Note & { kind: "note" }
const KIND_NOTE: NodeKind = "note"

/** 给一条 Note 打上 kind:"note" (写 nodes 仓库前规范化)。 */
function asNoteRow(note: Note): NoteRow {
  return { ...note, kind: "note" }
}

function noteRowToNote(row: NoteRow): Note {
  const { kind: _kind, ...note } = row
  return note
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

/** 确保笔记带稳定块 id + blockMeta (旧记录懒补; content 规范化为非空)。返回规范化后的 content+blockMeta。 */
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
function emptyNoteContent(): NoteContent {
  return [{ type: "p", children: [{ text: "" }] }]
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

/**
 * 取 nodes 仓库内全部「笔记」节点 (按 kind 过滤, 含删除标记)。其余 kind 节点 (后续折叠 B/C/D 入库) 不返回 ——
 * 这是 notes-store 在统一 nodes 仓库下只见笔记的边界, 防 listNotes / 同步 GC 误伤其它 kind。
 */
async function allNoteNodes(): Promise<NoteRow[]> {
  const all = await idbGetAllFromIndex<Partial<NoteRow> & { id: string; kind?: NodeKind }>(
    STORE_NODES,
    INDEX_NODES_KIND,
    KIND_NOTE,
  )
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
 * 列出所有活跃笔记元数据 (过滤删除标记, 不含完整 content), 默认按最近编辑倒序。
 * 树结构由 parentId + sortKey 表达, 调用方 (页树 UI) 自行按 effectiveParent + sortKey 组装层级。
 * opts.text=false 跳过全文 walk (excerpt/search 留空), 供只用 标题/时间 的消费方提速。
 */
export async function listNotes(opts?: { text?: boolean }): Promise<NoteMeta[]> {
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

/** 读取单条完整笔记 (含 content); 已删除 (删除标记) 或非笔记 kind 视为不存在。 */
export async function getNote(id: string): Promise<Note | undefined> {
  const note = await idbGet<NoteRow>(STORE_NODES, id)
  if (!note || note.kind !== KIND_NOTE || !isLive(note)) return undefined
  // 确保带稳定块 id + blockMeta (旧记录懒补; 编辑器据此与本地块版本对齐); 空正文规范化为合法空文档。
  const { content, blockMeta } = ensureBlocks(note)
  return { ...note, content, blockMeta }
}

// ---- 笔记 (写) ----

/** 新建笔记并返回同一写事务实际提交的统一 Node。 */
export async function addNoteWithNode(input: NewNote = {}): Promise<NodeOfKind<"note">> {
  const parentId = input.parentId ?? null
  const now = Date.now()
  const id = genId("note")
  // 补稳定块 id + 初始 blockMeta (§7): 新笔记一落库即块级就绪, 后续编辑/同步走块级合并。
  const seeded = seedBlockMeta(id, (input.content ?? emptyNoteContent()) as Block[], deviceId())
  const buildNote = (sortKey: string): Note => ({
    id,
    title: input.title?.trim() ?? "",
    content: seeded.content as NoteContent,
    parentId,
    sortKey,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
    blockMeta: seeded.blockMeta,
  })
  const node = await idbRunTransaction<NoteRow>(
    [STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      // NewNote.afterSortKey: null/缺省 = 追加末尾。kind 全局上界一定晚于目标 parent
      // 的全部 siblings，因此默认路径无需读取、更无需 clone 任意笔记正文。
      if (input.afterSortKey == null) {
        const append = () =>
          addNodeAtKindTail(
            store,
            { kind: "note", parentId },
            (sortKey) => asNoteRow(buildNote(sortKey)),
            setResult,
            abort,
          )
        if (parentId === null) append()
        else {
          const parentRequest = store.get(parentId)
          parentRequest.onerror = () =>
            abort(parentRequest.error ?? new Error("读取目标父页面失败"))
          parentRequest.onsuccess = () => {
            try {
              const parent = parentRequest.result as Node | undefined
              if (!parent || parent.kind !== KIND_NOTE || !isLive(parent)) {
                throw new Error("目标父页面不存在或已删除")
              }
              append()
            } catch (error) {
              abort(error)
            }
          }
        }
        return
      }
      // 显式“插到某兄弟之后”仍需 sibling 快照；读取与 add 保持在同一写事务，
      // 防止另一个窗口在计算与提交之间插入相同 sortKey。
      const request = store.index(INDEX_NODES_KIND).getAll(KIND_NOTE)
      request.onerror = () => abort(request.error ?? new Error("读取笔记同级排序快照失败"))
      request.onsuccess = () => {
        try {
          const all = (request.result as Array<Partial<NoteRow> & { id: string }>).filter(
            (row): row is NoteRow => row.kind === KIND_NOTE,
          )
          const live = all.filter(isLive)
          if (parentId !== null && !live.some((row) => row.id === parentId)) {
            throw new Error("目标父页面不存在或已删除")
          }
          const sortKey = computeSortKey(live, parentId, {
            afterSortKey: input.afterSortKey,
          })
          const created = asNoteRow(buildNote(sortKey))
          store.add(created)
          setResult(created)
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  notifyFilesUpdated({ kind: "note", id })
  return node
}

/** 兼容既有 FilesPort DTO；创建真相由 addNoteWithNode 返回。 */
export async function addNote(input: NewNote = {}): Promise<Note> {
  return noteRowToNote(await addNoteWithNode(input))
}

type NoteWritePatch = Partial<Pick<Note, "title" | "content" | "tags">> & {
  parentId?: string | null
}

function applyNoteFields(current: NoteRow, patch: NoteWritePatch, now: number): NoteRow {
  const base = ensureBlocks(current)
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
  // 只投影允许的字段；不能用 ...patch，否则运行期调用方可夹带 sortKey/deletedAt
  // 绕过树结构校验或复活 tombstone。
  return {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    content,
    blockMeta,
    kind: "note",
    updatedAt: now,
  }
}

/** 更新笔记字段及可选父页面；父级校验、排序与字段写入保持在同一事务。 */
export async function updateNote(
  id: string,
  patch: NoteWritePatch,
  expected?: NodeMutationExpectation,
): Promise<Note | undefined> {
  const next =
    patch.parentId === undefined
      ? await idbReadModifyWrite<NoteRow>(STORE_NODES, id, (current) => {
          assertNodeMutationExpectation(current, expected)
          if (!current) return undefined
          if (current.kind !== KIND_NOTE || !isLive(current)) return undefined
          return applyNoteFields(current, patch, nextUpdatedAt(current.updatedAt))
        })
      : await idbRunTransaction<NoteRow | undefined>(
          [STORE_NODES],
          "readwrite",
          (transaction, setResult, abort) => {
            const store = transaction.objectStore(STORE_NODES)
            const currentRequest = store.get(id)
            currentRequest.onerror = () =>
              abort(currentRequest.error ?? new Error("读取待更新笔记失败"))
            currentRequest.onsuccess = () => {
              try {
                const current = currentRequest.result as NoteRow | undefined
                assertNodeMutationExpectation(current, expected)
                if (!current) {
                  setResult(undefined)
                  return
                }
                if (current.kind !== KIND_NOTE || !isLive(current)) {
                  setResult(undefined)
                  return
                }

                const request = store.index(INDEX_NODES_KIND).getAll(KIND_NOTE)
                request.onerror = () => abort(request.error ?? new Error("读取笔记树快照失败"))
                request.onsuccess = () => {
                  try {
                    const all = (request.result as Array<Partial<NoteRow> & { id: string }>).filter(
                      (row): row is NoteRow => row.kind === KIND_NOTE,
                    )
                    const live = all.filter(isLive)
                    const parentId = patch.parentId as string | null
                    if (parentId !== null) {
                      if (!live.some((row) => row.id === parentId)) {
                        throw new Error("目标父页面不存在或已删除")
                      }
                      if (collectSubtreeIds(id, live).has(parentId)) {
                        throw new Error("不能把页面移动到它自己的子页面下")
                      }
                    }
                    const parentChanged = current.parentId !== parentId
                    const candidate = parentChanged
                      ? live.map((row) => (row.id === id ? { ...row, parentId } : row))
                      : live
                    const updated: NoteRow = {
                      ...applyNoteFields(current, patch, nextUpdatedAt(current.updatedAt)),
                      parentId,
                      sortKey: parentChanged
                        ? computeSortKey(candidate, parentId, undefined, id)
                        : current.sortKey,
                    }
                    const putRequest = store.put(updated)
                    putRequest.onerror = () =>
                      abort(putRequest.error ?? new Error("更新笔记字段与位置失败"))
                    putRequest.onsuccess = () => setResult(updated)
                  } catch (error) {
                    abort(error)
                  }
                }
              } catch (error) {
                abort(error)
              }
            }
          },
        )
  if (next) notifyFilesUpdated({ kind: "note", id })
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
  expected?: NodeMutationExpectation,
): Promise<Note | undefined> {
  const next = await idbRunTransaction<Note | undefined>(
    [STORE_NODES],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const currentRequest = store.get(id)
      currentRequest.onerror = () => abort(currentRequest.error ?? new Error("读取待移动笔记失败"))
      currentRequest.onsuccess = () => {
        try {
          const current = currentRequest.result as NoteRow | undefined
          assertNodeMutationExpectation(current, expected)
          if (!current) {
            setResult(undefined)
            return
          }
          if (current.kind !== KIND_NOTE || !isLive(current)) {
            setResult(undefined)
            return
          }

          const request = store.index(INDEX_NODES_KIND).getAll(KIND_NOTE)
          request.onerror = () => abort(request.error ?? new Error("读取笔记树快照失败"))
          request.onsuccess = () => {
            try {
              const all = (request.result as Array<Partial<NoteRow> & { id: string }>).filter(
                (row): row is NoteRow => row.kind === KIND_NOTE,
              )
              const live = all.filter(isLive)
              if (newParentId !== null) {
                if (!live.some((row) => row.id === newParentId)) {
                  throw new Error("目标父页面不存在或已删除")
                }
                if (collectSubtreeIds(id, live).has(newParentId)) {
                  throw new Error("不能把页面移动到它自己的子页面下")
                }
              }
              // 用移动后的候选拓扑计算 effective siblings；既有损坏环在被拆开时也能得到正确根序。
              const candidate = live.map((row) =>
                row.id === id ? { ...row, parentId: newParentId } : row,
              )
              const moved: NoteRow = {
                ...current,
                parentId: newParentId,
                sortKey: computeSortKey(candidate, newParentId, pos, id),
                updatedAt: nextUpdatedAt(current.updatedAt),
              }
              const putRequest = store.put(moved)
              putRequest.onerror = () => abort(putRequest.error ?? new Error("移动页面失败"))
              putRequest.onsuccess = () => {
                const { kind: _kind, ...note } = moved
                setResult(note)
              }
            } catch (error) {
              abort(error)
            }
          }
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (next) notifyFilesUpdated({ kind: "note", id })
  return next
}

/**
 * 级联删除整棵子树 (软删标记): 快照、整棵子树的 deletedAt 与正文压缩在同一跨 store 事务提交。
 * 返回被删的完整笔记 (含正文), 供当前调用栈撤销；耐久恢复使用同事务写入的 trash snapshot。
 */
export async function deleteNote(id: string, expected?: NodeMutationExpectation): Promise<Note[]> {
  const captured = await idbRunTransaction<NoteRow[]>(
    [STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const nodeStore = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const currentRequest = nodeStore.get(id)
      currentRequest.onerror = () => abort(currentRequest.error ?? new Error("读取待删除笔记失败"))
      currentRequest.onsuccess = () => {
        try {
          const current = currentRequest.result as NoteRow | undefined
          assertNodeMutationExpectation(current, expected)
          if (!current) {
            setResult([])
            return
          }
          if (current.kind !== KIND_NOTE || !isLive(current)) {
            setResult([])
            return
          }

          const request = nodeStore.index(INDEX_NODES_KIND).getAll(KIND_NOTE)
          request.onerror = () => abort(request.error ?? new Error("读取待删除笔记子树失败"))
          request.onsuccess = () => {
            try {
              const live = (request.result as Array<Partial<NoteRow> & { id: string }>)
                .filter((row): row is NoteRow => row.kind === KIND_NOTE)
                .filter(isLive)
              const subtreeIds = collectSubtreeIds(id, live)
              const captured = live.filter((note) => subtreeIds.has(note.id))
              if (!captured.some((note) => note.id === id)) {
                setResult([])
                return
              }
              const now = Date.now()
              for (const note of captured) {
                trashStore.put({
                  id: note.id,
                  node: note,
                  capturedAt: now,
                } satisfies TrashSnapshot)
                nodeStore.put({
                  ...note,
                  kind: "note",
                  content: [],
                  deletedAt: now,
                  updatedAt: nextUpdatedAt(note.updatedAt, now),
                } satisfies NoteRow)
              }
              setResult(captured)
            } catch (error) {
              abort(error)
            }
          }
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  // 级联删除会同时改变整棵子树；kind 级事件可让集合与任意后代的精确 watcher 失效。
  if (captured.length) notifyFilesUpdated({ kind: "note" })
  return captured
}

/**
 * 撤销级联删除: 把捕获的整棵子树原样写回 (含正文), 清除删除标记并 bump updatedAt
 * (使恢复在 LWW 下胜过刚写的删除标记, 跨端不被重新删除)。
 */
export async function restoreSubtree(notes: Note[]): Promise<void> {
  if (!notes.length) return
  const now = Date.now()
  const currentById = new Map((await allNoteNodes()).map((note) => [note.id, note]))
  const revived = notes.map((n) => {
    const previous = currentById.get(n.id)
    const copy: NoteRow = {
      ...n,
      kind: "note",
      updatedAt: nextUpdatedAt(previous?.updatedAt ?? n.updatedAt, now),
    }
    delete copy.deletedAt
    return copy
  })
  await idbBulkPut(STORE_NODES, revived)
  // 恢复可能写回多个后代，不能只广播根节点 id。
  notifyFilesUpdated({ kind: "note" })
}

// ---- 跨端同步钩子 (仅由 core StorageSyncPort adapter 暴露给 sync 插件) ----

/** 列出全部笔记含删除标记 + 完整正文 —— 同步合并/上传用。 */
export async function listAllNotes(): Promise<Note[]> {
  return (await allNoteNodes()).map(noteRowToNote)
}

/** 仅当本地仍匹配同步读取快照时，原子写入合并结果与 GC；否则拒绝覆盖并发本地编辑。 */
export async function bulkPutNotes(notes: Note[], expectedLocal: Note[]): Promise<Note[]> {
  // Note 域类型不带 kind, 写 nodes 仓库前规范化为 NoteRow (打 kind:"note", 统一库按 kind 收纳)。
  const rows = notes.map(asNoteRow)
  const outcome = await idbRunTransaction<{ items: Note[]; changed: boolean }>(
    [STORE_NODES, STORE_TRASH_SNAPSHOTS],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_NODES)
      const trashStore = transaction.objectStore(STORE_TRASH_SNAPSHOTS)
      const request = store.index(INDEX_NODES_KIND).getAll(KIND_NOTE)
      request.onerror = () => abort(request.error ?? new Error("读取笔记同步提交快照失败"))
      request.onsuccess = () => {
        try {
          const existing = (request.result as Array<Partial<NoteRow> & { id: string }>).filter(
            (row): row is NoteRow => row.kind === KIND_NOTE,
          )
          const actual = existing.map(noteRowToNote)
          const desired = rows.map(noteRowToNote)
          if (recordsEqual(actual, desired)) {
            for (const row of rows) {
              if (isLive(row)) trashStore.delete(row.id)
            }
            setResult({ items: actual, changed: false })
            return
          }
          if (!recordsEqual(actual, expectedLocal)) {
            throw new StorageSyncConflictError("笔记")
          }
          // 过期删除标记 GC 只针对笔记, 绝不波及 nodes 仓库内其它 kind 的记录。
          const existingById = new Map(existing.map((row) => [row.id, row]))
          const batchIds = new Set<string>()
          const writes = rows.map((row) => {
            if (batchIds.has(row.id)) throw new Error(`笔记同步批次包含重复 id: ${row.id}`)
            batchIds.add(row.id)
            return { row, exists: existingById.has(row.id) }
          })
          const keepIds = new Set(rows.map((note) => note.id))
          const now = Date.now()
          const toDelete = expiredTombstoneIdsToDelete(existing, keepIds, now)
          for (const { row, exists } of writes) {
            const current = existingById.get(row.id)
            if (isLive(row)) {
              trashStore.delete(row.id)
            } else if (current && isLive(current)) {
              trashStore.put({
                id: current.id,
                node: current,
                capturedAt: now,
              } satisfies TrashSnapshot)
            }
            // 新 id 使用 add，使同主键的其它 kind 节点触发 ConstraintError 并回滚整批。
            if (exists) store.put(row)
            else store.add(row)
          }
          for (const id of toDelete) {
            store.delete(id)
            trashStore.delete(id)
          }
          setResult({ items: desired, changed: true })
        } catch (error) {
          abort(error)
        }
      }
    },
  )
  if (outcome.changed) notifyFilesUpdated({ kind: "note" })
  return outcome.items
}
