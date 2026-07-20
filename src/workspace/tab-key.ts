import type { TabDescriptor } from "./types"

/** 标签去重 key: 同 kind(+params) 视为同一标签。
 *  params 按键排序后序列化, 避免顺序差异 (如 {a,b} vs {b,a}) 造成同一标签开成两个实例。 */
export function tabKey(d: TabDescriptor): string {
  if (!d.params) return d.kind
  const sorted = Object.keys(d.params)
    .sort()
    .map((k) => `${k}=${d.params![k]}`)
    .join("&")
  return `${d.kind}:${sorted}`
}
