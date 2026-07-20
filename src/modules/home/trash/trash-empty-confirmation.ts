import type { TrashFileItem } from "@/filesystem/trash-file-system"
import { trashCollectionVersion } from "@/filesystem/trash-file-system"

type TrashEmptySnapshotItem = Pick<TrashFileItem, "id" | "kind" | "updatedAt" | "deletedAt">
type TrashCollectionVersioner = (items: readonly TrashEmptySnapshotItem[]) => Promise<string>

export type TrashEmptyConfirmation = Readonly<{
  kind: "empty"
  expectedVersion: string
  count: number
}>

export type TrashEmptyConfirmationRequestGate = Readonly<{
  begin(): number
  cancel(): void
  isCurrent(request: number): boolean
}>

/** 让其它确认、mutation 或卸载能同步使尚未完成的摘要请求失效。 */
export function createTrashEmptyConfirmationRequestGate(): TrashEmptyConfirmationRequestGate {
  let generation = 0
  return Object.freeze({
    begin() {
      generation += 1
      return generation
    },
    cancel() {
      generation += 1
    },
    isCurrent(request) {
      return request === generation
    },
  })
}

/** 点击时同步冻结投影；后续 SHA-256 await 与列表 refresh 都只能观察这份快照。 */
export async function prepareTrashEmptyConfirmation(
  items: readonly TrashEmptySnapshotItem[],
  version: TrashCollectionVersioner = trashCollectionVersion,
): Promise<TrashEmptyConfirmation> {
  const snapshot = Object.freeze(
    items.map(({ id, kind, updatedAt, deletedAt }) =>
      Object.freeze({ id, kind, updatedAt, deletedAt }),
    ),
  )
  const count = snapshot.length
  return { kind: "empty", expectedVersion: await version(snapshot), count }
}
