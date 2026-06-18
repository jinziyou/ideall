// 用户(peer)发布层取数 facade —— 经 `@protocol/server-port` 的 ServerPort (官方实现为 HTTP 适配器)。
// 公开发现/读取 + 带 token 的发布/删除。
import { getServerPort, type PublishDraft } from "@protocol/server-port"

export type { Publication, PeerPublisher } from "@protocol/server-port"

/** 社区发布者列表 (公开)。 */
export function getPeers() {
  return getServerPort().listPeers()
}

/** 某发布者的发布列表 (公开)。 */
export function getPeerPublications(id: string) {
  return getServerPort().getPeerPublications(id)
}

/** 发布一条 (需登录 token)。 */
export function publish(token: string, input: PublishDraft) {
  return getServerPort().publish(token, input)
}

/** 删除自己的一条发布 (需登录 token)。 */
export function deletePublication(token: string, id: number) {
  return getServerPort().deletePublication(token, id)
}
