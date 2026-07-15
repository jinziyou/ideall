// 同级排序键 —— fractional indexing (零依赖, 移植自 David Greenspan「Implementing Fractional Indexing」/
// rocicorp `fractional-indexing`, 与 sync-crypto / idb 一样手写无三方依赖)。
// 生成「严格介于两个键之间」的字符串键, 字典序即显示序:
//   - 同级末尾追加 = sortKeyBetween(当前最大键, null)
//   - 同级开头插入 = sortKeyBetween(null, 当前最小键)
//   - 在 x、y 之间插入 = sortKeyBetween(x, y)
// 重排只改动一行记录的 sortKey → 与单行 idbPut 及跨端 LWW 同步天然兼容 (无需重写整列)。
// 键由「整数幅度前缀 + 小数部分」构成, 故反复在头/尾插入不会退化, 也不产生以 0 结尾的非法键。

// base62, 升序 ASCII (0-9 < A-Z < a-z), 故字符串字典序与数值序一致。
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const ZERO = DIGITS[0]
// 最小整数键 ("A" 头表示最长的负幅度); 它本身非法 (保留为下界), 故 validateOrderKey 拒之。
const SMALLEST_INTEGER = "A" + ZERO.repeat(26)

/** 整数部分长度: 头字符 (a-z 正幅度 / A-Z 负幅度) 编码其后跟随的数字位数。 */
function getIntegerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2
  throw new Error("非法排序键头: " + head)
}

function getIntegerPart(key: string): string {
  const len = getIntegerLength(key[0])
  if (len > key.length) throw new Error("非法排序键: " + key)
  return key.slice(0, len)
}

function validateInteger(int: string): void {
  if (int.length !== getIntegerLength(int[0])) throw new Error("非法整数部分: " + int)
}

/** 校验一个外部传入的排序键合法 (整数长度自洽、小数部分不以 0 结尾、非保留下界)。 */
function validateOrderKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error("非法排序键: " + key)
  const i = getIntegerPart(key)
  const f = key.slice(i.length)
  if (f.slice(-1) === ZERO) throw new Error("非法排序键 (小数部分以 0 结尾): " + key)
}

/** 在持久化边界校验已有排序键；损坏数据应显式失败，不能静默回退并制造重复键。 */
export function assertValidSortKey(key: string): void {
  validateOrderKey(key)
}

/** 小数部分的严格中点: 返回 m 使 a < m < b (b 为 null 表示无上界)。要求 a < b 且均不以 0 结尾。 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(a + " >= " + b)
  if (a.slice(-1) === ZERO || (b !== null && b.slice(-1) === ZERO))
    throw new Error("小数部分不得以 0 结尾")
  if (b !== null) {
    // 跳过公共前缀 (a 不足处以 0 补齐), 在首个相异位求中点。
    let n = 0
    while ((a[n] ?? ZERO) === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const digitA = a === "" ? 0 : DIGITS.indexOf(a[0])
  const digitB = b === null ? DIGITS.length : DIGITS.indexOf(b[0])
  if (digitB - digitA > 1) {
    const mid = Math.round(0.5 * (digitA + digitB))
    return DIGITS[mid]
  }
  // 首位相邻: 取 a 的首位再向更深一位递归 (或借用 b 的首位)。
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[digitA] + midpoint(a.slice(1), null)
}

function incrementInteger(x: string): string | null {
  validateInteger(x)
  const head = x[0]
  const digs = x.slice(1).split("")
  let carry = true
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1
    if (d === DIGITS.length) digs[i] = ZERO
    else {
      digs[i] = DIGITS[d]
      carry = false
    }
  }
  if (carry) {
    if (head === "Z") return "a" + ZERO
    if (head === "z") return null
    const h = String.fromCharCode(head.charCodeAt(0) + 1)
    if (h > "a") digs.push(ZERO)
    else digs.pop()
    return h + digs.join("")
  }
  return head + digs.join("")
}

function decrementInteger(x: string): string | null {
  validateInteger(x)
  const head = x[0]
  const digs = x.slice(1).split("")
  let borrow = true
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1
    if (d === -1) digs[i] = DIGITS[DIGITS.length - 1]
    else {
      digs[i] = DIGITS[d]
      borrow = false
    }
  }
  if (borrow) {
    if (head === "a") return "Z" + DIGITS[DIGITS.length - 1]
    if (head === "A") return null
    const h = String.fromCharCode(head.charCodeAt(0) - 1)
    if (h < "Z") digs.push(DIGITS[DIGITS.length - 1])
    else digs.pop()
    return h + digs.join("")
  }
  return head + digs.join("")
}

/**
 * 生成严格介于 a、b 之间的排序键 (a < 结果 < b)。
 * a 为 null = 无下界 (插到最前); b 为 null = 无上界 (追加到最后); 两者皆 null = 首个键。
 * 要求 a < b (调用方按当前同级顺序传入), 否则抛错。
 */
export function sortKeyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateOrderKey(a)
  if (b !== null) validateOrderKey(b)
  if (a !== null && b !== null && a >= b) throw new Error(a + " >= " + b)
  if (a === null) {
    if (b === null) return "a" + ZERO
    const ib = getIntegerPart(b)
    const fb = b.slice(ib.length)
    if (ib === SMALLEST_INTEGER) return ib + midpoint("", fb)
    if (ib < b) return ib
    const res = decrementInteger(ib)
    if (res === null) throw new Error("已到最小键, 无法再向前插入")
    return res
  }
  if (b === null) {
    const ia = getIntegerPart(a)
    const fa = a.slice(ia.length)
    const i = incrementInteger(ia)
    return i === null ? ia + midpoint(fa, null) : i
  }
  const ia = getIntegerPart(a)
  const fa = a.slice(ia.length)
  const ib = getIntegerPart(b)
  const fb = b.slice(ib.length)
  if (ia === ib) return ia + midpoint(fa, fb)
  const i = incrementInteger(ia)
  if (i === null) throw new Error("无法递增整数键")
  if (i < b) return i
  return ia + midpoint(fa, null)
}

/** 首个排序键 (空同级列表的第一项)。 */
export function initialSortKey(): string {
  return sortKeyBetween(null, null)
}

/** 返回集合中的最大非空排序键；删除标记也应由调用方保留在集合中。 */
export function maxSortKey(items: readonly { sortKey?: unknown }[]): string | null {
  let max: string | null = null
  for (const item of items) {
    const key = item.sortKey
    if (typeof key === "string" && key.length > 0 && (max === null || key > max)) max = key
  }
  return max
}

/** 在末尾追加一个键；遇到损坏或已耗尽的旧键时回退到首个合法键。 */
export function appendSortKey(after: string | null): string {
  try {
    return sortKeyBetween(after, null)
  } catch {
    return initialSortKey()
  }
}

/** 自 after 起生成 count 个严格递增的追加键。 */
export function appendSortKeys(after: string | null, count: number): string[] {
  const keys: string[] = []
  let previous = after
  for (let i = 0; i < count; i++) {
    previous = appendSortKey(previous)
    keys.push(previous)
  }
  return keys
}

/**
 * 为一批「按目标顺序排列」的项依次生成递增排序键 (迁移 / 批量导入用)。
 * 返回与 count 等长的严格递增键数组。
 */
export function sequentialSortKeys(count: number): string[] {
  return appendSortKeys(null, count)
}
