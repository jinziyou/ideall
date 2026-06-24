// note 块级并发合并的纯逻辑 (§7) —— 把 §4 的三件套 (稳定 id + LWW + sortKey + 墓碑 + 纯 join/GC 分离)
// 下沉到 note 内顶层块。不引 Yjs/Automerge。合并粒度 = 顶层块: 同块并发 LWW 一方胜 (§7.5 可接受代价),
// 跨块并发无损。解决: ① AI 与用户并发写笔记不丢; ② 笔记跨端并发同步无损; ③ 块级 v 支撑只传变更块。
//
// 模型 (§7.1, sidecar 不 inline): content = Plate 顶层块数组 (每块带稳定 id); blockMeta 与之并列,
// 按块 id 记 {v(版本), by(作者), sk(块级 fractional sortKey), del?(墓碑)}。content 只含活跃块 (墓碑只在
// blockMeta 留记录, 不渲染); 合并后 content 由活跃块按 (sk,id) 重排得出。所有操作严格只取顶层块, 不下钻嵌套。
import { sortKeyBetween } from "./sort-key"

export type BlockId = string

/** 单个顶层块的并发元数据 (sidecar)。 */
export interface BlockMeta {
  /** 版本号 (每次本块被改 +1; LWW 比较主键)。 */
  v: number
  /** 最后改动方 (设备/作者 id; v 并列时的确定性 tiebreak)。 */
  by: string
  /** 块级 fractional sortKey (跨端并发插入按此定序; 仅本块物理顺序相对前块变了才重算)。 */
  sk: string
  /** 软删墓碑 (epoch ms); 缺省 = 活跃。墓碑以更高 v 压制陈旧活跃副本, 删除跨端传播。 */
  del?: number
}

export type BlockMetaMap = Record<BlockId, BlockMeta>

/** Plate 顶层块 (带 NodeIdPlugin 注入的稳定 id)。 */
export type Block = { id?: string } & Record<string, unknown>

/** 一次写的块级补丁 (相对 mount-time base 算出): 点名 upsert / delete 的块, 未点名块原样保留。 */
export interface BlockPatch {
  upsert: { id: BlockId; block: Block; v: number; by: string; sk: string }[]
  delete: BlockId[]
}

/** content (块数组) → id→块 映射 (只取有 id 的顶层块)。 */
export function blockMapById(blocks: Block[]): Map<BlockId, Block> {
  const m = new Map<BlockId, Block>()
  for (const b of blocks) if (typeof b.id === "string" && b.id) m.set(b.id, b)
  return m
}

/** 顶层块 id 列表 (按当前顺序; 仅有 id 者)。 */
export function blockIds(blocks: Block[]): BlockId[] {
  return blocks.map((b) => b.id).filter((x): x is string => typeof x === "string" && x.length > 0)
}

/** 块级稳定比较: 先 sk 字典序, 并列以 id 兜底 (跨端并发可能产生相同键)。 */
function cmpBlock(am: BlockMeta, bm: BlockMeta, aid: BlockId, bid: BlockId): number {
  if (am.sk !== bm.sk) return am.sk < bm.sk ? -1 : 1
  return aid < bid ? -1 : aid > bid ? 1 : 0
}

/** LWW 取胜方: 高 v 胜; v 并列以 by 字典序兜底 (再并列以 del 状态/原样, 保证对称→可交换)。 */
function pickMeta(a: BlockMeta | undefined, b: BlockMeta | undefined): BlockMeta {
  if (!a) return b as BlockMeta
  if (!b) return a
  if (a.v !== b.v) return a.v > b.v ? a : b
  if (a.by !== b.by) return a.by < b.by ? a : b
  // v 与 by 都并列: 以 sk 再兜底 (对称确定性); 仍并列则取 a (内容应一致)。
  if (a.sk !== b.sk) return a.sk < b.sk ? a : b
  return a
}

/**
 * 按当前块顺序分配 sk: 沿用 base 中仍保持单调的块键, 仅对"新块 / 物理顺序相对前块变了"的块在前块之后重算
 * (§9: sk 只对移动块重算)。未移动块沿用旧 sk → 跨端并发编辑按稳定 sk 合并不串位。
 */
function assignBlockSks(currentIds: BlockId[], base: BlockMetaMap): Map<BlockId, string> {
  const out = new Map<BlockId, string>()
  let prev: string | null = null
  for (const id of currentIds) {
    const baseSk = base[id]?.sk
    if (baseSk && (prev === null || baseSk > prev)) {
      out.set(id, baseSk) // 仍单调 → 保留 (未移动)
      prev = baseSk
    } else {
      let sk: string
      try {
        sk = sortKeyBetween(prev, null)
      } catch {
        sk = sortKeyBetween(null, null)
      }
      out.set(id, sk) // 新块 / 移动 → 在前块之后重算
      prev = sk
    }
  }
  return out
}

/**
 * 相对 mount-time base 算块补丁 (§7.3 雷A fix-holds):
 * - delete 被 `base.keys()` 严格上界 ⇒ AI/远端在编辑期并发追加的块 (不在 base) 从不进 delete, 永不被本次写清掉;
 * - upsert 只含新块 / 内容变 / sk 变的块; v = base.v + 1 (落地侧再加守卫防陈旧覆盖)。
 * baseBlocks/baseMeta 取"首次 onChange 规范化后"的值 (§9: 防加载期 normalize 伪脏 → 伪 v bump)。
 */
export function diffBlocks(
  baseBlocks: Map<BlockId, Block>,
  baseMeta: BlockMetaMap,
  current: Block[],
  by: string,
): BlockPatch {
  const curIds = blockIds(current)
  const curIdSet = new Set(curIds)
  const sks = assignBlockSks(curIds, baseMeta)
  const upsert: BlockPatch["upsert"] = []
  for (const b of current) {
    const id = b.id
    if (typeof id !== "string" || !id) continue
    const sk = sks.get(id) as string
    const baseB = baseBlocks.get(id)
    const contentChanged = !baseB || JSON.stringify(b) !== JSON.stringify(baseB)
    const skChanged = !baseMeta[id] || baseMeta[id].sk !== sk
    if (contentChanged || skChanged) {
      upsert.push({ id, block: b, v: (baseMeta[id]?.v ?? 0) + 1, by, sk })
    }
  }
  const del = [...baseBlocks.keys()].filter((id) => !curIdSet.has(id))
  return { upsert, delete: del }
}

/** 由 content + blockMeta 重建活跃块数组 (过滤墓碑, 按 (sk,id) 排序)。 */
function rebuildContent(byId: Map<BlockId, Block>, meta: BlockMetaMap): Block[] {
  const live: Block[] = []
  for (const [id, b] of byId) if (meta[id] && meta[id].del == null) live.push(b)
  return live.sort((x, y) => cmpBlock(meta[x.id as string], meta[y.id as string], x.id as string, y.id as string))
}

/**
 * 把块补丁原子应用到存量 note (§7.3): 只 set/delete 被点名的块, 未点名块 (并发追加的 B4) 原样保留。
 * upsert v 守卫 (§9): 仅 patch.v > 现有才覆盖, 落地 v = max(u.v, cur.v+1) —— 防 live-merge 并入的高版本块
 * 被陈旧 base 低版本 upsert 复活。delete = 写墓碑 (del + bump v + 从 content 移除)。
 */
export function applyBlockPatch(
  content: Block[],
  blockMeta: BlockMetaMap,
  patch: BlockPatch,
  now: number,
): { content: Block[]; blockMeta: BlockMetaMap } {
  const byId = blockMapById(content)
  const meta: BlockMetaMap = { ...blockMeta }
  for (const u of patch.upsert) {
    const cur = meta[u.id]
    if (cur && u.v <= cur.v) continue // 陈旧 (live-merge 已并入更高版本) → 跳过, 不复活
    meta[u.id] = { v: Math.max(u.v, (cur?.v ?? 0) + 1), by: u.by, sk: u.sk }
    byId.set(u.id, u.block)
  }
  for (const id of patch.delete) {
    const cur = meta[id]
    if (cur?.del != null) continue // 已是墓碑
    meta[id] = { v: (cur?.v ?? 0) + 1, by: cur?.by ?? "", sk: cur?.sk ?? "", del: now }
    byId.delete(id)
  }
  return { content: rebuildContent(byId, meta), blockMeta: meta }
}

/**
 * 跨端纯 join 合并 (§7.4 雷B fix-breaks: 不接收 now、不丢任何 id、过期墓碑照样保留):
 * per-block (v,by) 取胜 + (sk,id) 排序, 墓碑始终以更高 v 压制陈旧活跃副本 → 交换/结合/幂等成立。
 * 墓碑 GC 是单独一步 (pruneBlockTombstones), 不混进此处。
 */
export function mergeNoteContent(
  localContent: Block[],
  localMeta: BlockMetaMap,
  remoteContent: Block[],
  remoteMeta: BlockMetaMap,
): { content: Block[]; blockMeta: BlockMetaMap } {
  const lBlocks = blockMapById(localContent)
  const rBlocks = blockMapById(remoteContent)
  const ids = new Set<BlockId>([...Object.keys(localMeta), ...Object.keys(remoteMeta)])
  const meta: BlockMetaMap = {}
  const byId = new Map<BlockId, Block>()
  for (const id of ids) {
    const a = localMeta[id]
    const b = remoteMeta[id]
    const win = pickMeta(a, b)
    meta[id] = win
    if (win.del == null) {
      // 取胜方一侧的块内容 (墓碑无内容); 兜底另一侧 (防一侧缺块)。
      const block = (win === a ? lBlocks.get(id) : rBlocks.get(id)) ?? lBlocks.get(id) ?? rBlocks.get(id)
      if (block) byId.set(id, block)
    }
  }
  return { content: rebuildContent(byId, meta), blockMeta: meta }
}

/** 块墓碑 TTL: 90 天 (与 node 级一致)。 */
export const BLOCK_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * 块墓碑 GC (§7.4 单独一步, 合并后对权威全集统一应用): 移除已过保留期的墓碑; 活跃 + 未过期墓碑保留。
 * 纯函数 (now 注入)。合并阶段块墓碑只增不减, GC 只在此处。
 */
export function pruneBlockTombstones(
  meta: BlockMetaMap,
  now: number,
  ttlMs = BLOCK_TOMBSTONE_TTL_MS,
): BlockMetaMap {
  const out: BlockMetaMap = {}
  for (const [id, m] of Object.entries(meta)) {
    if (m.del != null && now - m.del > ttlMs) continue // 过期墓碑 → GC
    out[id] = m
  }
  return out
}

// ── 存量补块 id + blockMeta (§7.2 / §9: 确定性 hash, 两端独立迁移得同 id) ──

/** djb2 字符串 hash → base36 (确定性, 跨端一致)。 */
function hash36(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** 存量块的确定性 id: blk_<noteId 指纹>_<块序>_<内容指纹> —— 两端独立迁移同一笔记得同 id, 消跨端竞争。 */
export function deterministicBlockId(noteId: string, index: number, block: Block): string {
  return `blk_${hash36(noteId)}_${index}_${hash36(JSON.stringify(block))}`
}

/**
 * 为存量 note (content 无块 id / 无 blockMeta) 补稳定 id + 初始 blockMeta。
 * 已有 id 的块沿用其 id (NodeIdPlugin 已注入); 缺 id 的用确定性 hash 补。空 content 注入带稳定 id 的空段落
 * (§7.4: 空块归一化堵漏, 否则两端各发不同 genId 的空段落, union 当两块永不收敛)。
 */
export function seedBlockMeta(
  noteId: string,
  content: Block[],
  by: string,
): { content: Block[]; blockMeta: BlockMetaMap } {
  const blocks: Block[] = content.length
    ? content
    : [{ type: "p", children: [{ text: "" }] }]
  const out: Block[] = []
  const meta: BlockMetaMap = {}
  let prevSk: string | null = null
  blocks.forEach((b, i) => {
    const id = typeof b.id === "string" && b.id ? b.id : deterministicBlockId(noteId, i, b)
    const sk = sortKeyBetween(prevSk, null)
    prevSk = sk
    out.push({ ...b, id })
    meta[id] = { v: 1, by, sk }
  })
  return { content: out, blockMeta: meta }
}
