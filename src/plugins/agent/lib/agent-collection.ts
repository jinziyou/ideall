// 本地优先集合 store 工厂 —— 把「localStorage 持久化 + 订阅 + 稳定快照」收敛为一处。
// 供 AI 注册表 (规则 / MCP server / 自定义技能 / 任务) 复用; 与 agent-settings / agent-workspace 同范式
// (纯 store + subscribe/get, 组件侧自行 useSyncExternalStore)。仅存本机, 不入 IndexedDB / 不跨端同步 (MVP)。

export interface Identified {
  id: string
}

export interface Collection<T extends Identified> {
  subscribe(cb: () => void): () => void
  /** 客户端快照 (引用稳定: 仅 commit 时变)。 */
  get(): T[]
  /** 服务端 / 首帧快照 (稳定空集, 避免 SSR 读 localStorage)。 */
  getServer(): T[]
  byId(id: string): T | undefined
  /** 存在则替换 (刷新 updatedAt), 否则追加。 */
  upsert(item: T): void
  remove(id: string): void
  replaceAll(items: T[]): void
}

const EMPTY: readonly never[] = Object.freeze([])

/**
 * 建一个 {id} 主键的本地集合 store。
 * @param key      localStorage 键
 * @param seed     首次 (空存储) 的种子项
 * @param migrate  逐项容旧 (缺字段补默认)
 */
export function createCollection<T extends Identified>(
  key: string,
  seed: () => T[] = () => [],
  migrate: (raw: Partial<T>) => T = (raw) => raw as T,
): Collection<T> {
  let state: T[] | null = null
  const listeners = new Set<() => void>()

  function load(): T[] {
    if (typeof localStorage === "undefined") return EMPTY as unknown as T[]
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<T>[]
        if (Array.isArray(parsed)) return parsed.map(migrate)
      }
    } catch {
      /* 损坏数据 → 落种子 */
    }
    return seed()
  }

  function ensure(): T[] {
    if (!state) state = load()
    return state
  }

  function persist(s: T[]) {
    if (typeof localStorage === "undefined") return
    try {
      localStorage.setItem(key, JSON.stringify(s))
    } catch {
      /* 隐私模式 / 配额满 → 放弃持久化 */
    }
  }

  function commit(next: T[]) {
    state = next
    persist(next)
    for (const l of listeners) l()
  }

  return {
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    get: ensure,
    getServer: () => EMPTY as unknown as T[],
    byId: (id) => ensure().find((x) => x.id === id),
    upsert(item) {
      const s = ensure()
      const next = s.some((x) => x.id === item.id)
        ? s.map((x) => (x.id === item.id ? item : x))
        : [...s, item]
      commit(next)
    },
    remove(id) {
      commit(ensure().filter((x) => x.id !== id))
    },
    replaceAll(items) {
      commit(items)
    },
  }
}
