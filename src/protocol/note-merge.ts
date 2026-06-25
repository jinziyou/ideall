// note 块级合并的跨端契约 (§7.4 / §8) —— 与 unionMerge 同层 (@protocol/sync), 供 sync 插件 (plugin) 与
// notes-store (app) 共用 (守 components↛app 边界)。纯逻辑, 不引 platejs / 不生成 sortKey (只比较)。
// 块级三件套: 稳定 id + per-block (v,by) LWW + 块 sortKey + 墓碑 + 纯 join/GC 分离。

export type BlockId = string

/** 单个顶层块的并发元数据 (sidecar)。 */
export interface BlockMeta {
  v: number
  by: string
  sk: string
  del?: number
}
export type BlockMetaMap = Record<BlockId, BlockMeta>

/** Plate 顶层块 (带稳定 id)。 */
export type Block = { id?: string } & Record<string, unknown>

function blockMapById(blocks: Block[]): Map<BlockId, Block> {
  const m = new Map<BlockId, Block>()
  // 防御: 跳过 null / 非对象元素 (污染数据), 取 .id 不崩。
  for (const b of blocks)
    if (b && typeof b === "object" && typeof b.id === "string" && b.id) m.set(b.id, b)
  return m
}

/** 块级稳定比较: 先 sk 字典序, 并列以 id 兜底。 */
export function cmpBlock(am: BlockMeta, bm: BlockMeta, aid: BlockId, bid: BlockId): number {
  if (am.sk !== bm.sk) return am.sk < bm.sk ? -1 : 1
  return aid < bid ? -1 : aid > bid ? 1 : 0
}

/** LWW 取胜方: 高 v 胜; v 并列以 by 兜底, 再以 sk 兜底 (对称确定性 → 可交换)。 */
export function pickMeta(a: BlockMeta | undefined, b: BlockMeta | undefined): BlockMeta {
  if (!a) return b as BlockMeta
  if (!b) return a
  if (a.v !== b.v) return a.v > b.v ? a : b
  if (a.by !== b.by) return a.by < b.by ? a : b
  if (a.sk !== b.sk) return a.sk < b.sk ? a : b
  return a
}

/** 由 id→块 映射 + blockMeta 重建活跃块数组 (过滤墓碑, 按 (sk,id) 排序)。 */
export function rebuildContent(byId: Map<BlockId, Block>, meta: BlockMetaMap): Block[] {
  const live: Block[] = []
  for (const [id, b] of byId) if (meta[id] && meta[id].del == null) live.push(b)
  return live.sort((x, y) =>
    cmpBlock(meta[x.id as string], meta[y.id as string], x.id as string, y.id as string),
  )
}

/**
 * 跨端纯 join 合并 (§7.4 雷B: 不接收 now、不丢任何 id、过期墓碑照样保留):
 * per-block (v,by) 取胜 + (sk,id) 排序, 墓碑以更高 v 压制陈旧活跃副本 → 交换/结合/幂等成立。GC 分离。
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
      const block =
        (win === a ? lBlocks.get(id) : rBlocks.get(id)) ?? lBlocks.get(id) ?? rBlocks.get(id)
      if (block) byId.set(id, block)
    }
  }
  return { content: rebuildContent(byId, meta), blockMeta: meta }
}

/** 块墓碑 TTL: 90 天 (与 node 级一致)。 */
export const BLOCK_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** 块墓碑 GC (单独一步, 合并后对权威全集统一应用)。纯函数 (now 注入)。 */
export function pruneBlockTombstones(
  meta: BlockMetaMap,
  now: number,
  ttlMs = BLOCK_TOMBSTONE_TTL_MS,
): BlockMetaMap {
  const out: BlockMetaMap = {}
  for (const [id, m] of Object.entries(meta)) {
    if (m.del != null && now - m.del > ttlMs) continue
    out[id] = m
  }
  return out
}
