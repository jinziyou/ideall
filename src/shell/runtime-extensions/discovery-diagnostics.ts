export type RuntimeExtensionPackageRejection = Readonly<{
  directory: string
  code: string
}>

let rejections: readonly RuntimeExtensionPackageRejection[] = Object.freeze([])
const listeners = new Set<() => void>()

export function runtimeExtensionPackageRejections(): readonly RuntimeExtensionPackageRejection[] {
  return rejections
}

export function subscribeRuntimeExtensionPackageRejections(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 仅桌面发现适配器写入；拒绝项不会注册为 factory，也没有任何管理动作。 */
export function replaceRuntimeExtensionPackageRejections(
  value: readonly RuntimeExtensionPackageRejection[],
): void {
  const next = Object.freeze(
    value
      .map((item) => Object.freeze({ directory: item.directory, code: item.code }))
      .sort((left, right) => left.directory.localeCompare(right.directory)),
  )
  if (
    next.length === rejections.length &&
    next.every(
      (item, index) =>
        item.directory === rejections[index]?.directory && item.code === rejections[index]?.code,
    )
  ) {
    return
  }
  rejections = next
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // 诊断已经提交；观察者故障不回滚发现结果。
    }
  }
}
