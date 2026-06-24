// note 块级并发合并的**写侧**逻辑 (§7) —— 编辑器/存储用 (app 层, 用 sortKey 生成器)。
// 跨端合并/GC 等纯契约在 @protocol/note-merge (与 unionMerge 同层, sync 插件共用); 此处 re-export 以便就近引用。
import { sortKeyBetween } from "./sort-key"
import {
  rebuildContent,
  type Block,
  type BlockId,
  type BlockMeta,
  type BlockMetaMap,
} from "@protocol/note-merge"

export type { Block, BlockId, BlockMeta, BlockMetaMap }
export {
  mergeNoteContent,
  pruneBlockTombstones,
  BLOCK_TOMBSTONE_TTL_MS,
  cmpBlock,
  pickMeta,
} from "@protocol/note-merge"

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

/**
 * 按当前块顺序分配 sk: 沿用 base 中仍单调的块键, 仅对"新块 / 物理顺序相对前块变了"的块在前块之后重算
 * (§9: sk 只对移动块重算)。未移动块沿用旧 sk → 跨端并发编辑按稳定 sk 合并不串位。
 */
function assignBlockSks(currentIds: BlockId[], base: BlockMetaMap): Map<BlockId, string> {
  const out = new Map<BlockId, string>()
  let prev: string | null = null
  for (const id of currentIds) {
    const baseSk = base[id]?.sk
    if (baseSk && (prev === null || baseSk > prev)) {
      out.set(id, baseSk)
      prev = baseSk
    } else {
      let sk: string
      try {
        sk = sortKeyBetween(prev, null)
      } catch {
        sk = sortKeyBetween(null, null)
      }
      out.set(id, sk)
      prev = sk
    }
  }
  return out
}

/**
 * 相对 mount-time base 算块补丁 (§7.3 雷A): delete 被 base.keys 严格上界 ⇒ 并发追加块永不入 del;
 * upsert 只含 新块 / 内容变 / sk 变的块; v = base.v + 1 (落地侧再加守卫防陈旧覆盖)。
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

/**
 * 把块补丁原子应用到存量 note (§7.3): 只 set/delete 被点名的块, 未点名块 (并发追加的 B4) 原样保留。
 * upsert v 守卫 (§9): 仅 patch.v > 现有才覆盖, 落地 v = max(u.v, cur.v+1)。delete = 写墓碑。
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
    if (cur && u.v <= cur.v) continue // 陈旧 → 跳过, 不复活 live-merge 的高版本
    meta[u.id] = { v: Math.max(u.v, (cur?.v ?? 0) + 1), by: u.by, sk: u.sk }
    byId.set(u.id, u.block)
  }
  for (const id of patch.delete) {
    const cur = meta[id]
    if (cur?.del != null) continue
    meta[id] = { v: (cur?.v ?? 0) + 1, by: cur?.by ?? "", sk: cur?.sk ?? "", del: now }
    byId.delete(id)
  }
  return { content: rebuildContent(byId, meta), blockMeta: meta }
}

// ── 存量补块 id + blockMeta (§7.2 / §9: 确定性 hash, 两端独立迁移得同 id) ──

function hash36(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** 存量块的确定性 id: 两端独立迁移同一笔记得同 id, 消跨端竞争。 */
export function deterministicBlockId(noteId: string, index: number, block: Block): string {
  return `blk_${hash36(noteId)}_${index}_${hash36(JSON.stringify(block))}`
}

/**
 * 为存量 note 补稳定 id + 初始 blockMeta。已有 id 沿用; 缺 id 用确定性 hash。空 content 归一为带稳定 id
 * 的空段落 (§7.4: 否则两端各发不同 genId 的空段落, union 当两块永不收敛)。
 */
export function seedBlockMeta(
  noteId: string,
  content: Block[],
  by: string,
): { content: Block[]; blockMeta: BlockMetaMap } {
  const blocks: Block[] = content.length ? content : [{ type: "p", children: [{ text: "" }] }]
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
