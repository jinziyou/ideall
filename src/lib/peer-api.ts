// 用户(peer)发布层取数 facade —— 公开内容由 remote.server FileSystem 读取，
// 发布与删除经同一 provider 的显式 action 执行。
import type { Publication, PublishDraft } from "@protocol/server-port"
import {
  invokeRemoteServerAction,
  readRemoteServerFile,
  remotePeerPublicationsRef,
  remotePeersRef,
  type RemotePeerPublicationsResult,
  type RemotePeersResult,
} from "@/filesystem/remote-server-file-system"
import type { ApiResult } from "@/lib/api"

export type { Publication, PeerPublisher } from "@protocol/server-port"

/** 社区发布者列表 (公开)。 */
export function getPeers() {
  return readRemoteServerFile<RemotePeersResult>(remotePeersRef())
}

/** 某发布者的发布列表 (公开)。 */
export function getPeerPublications(id: string) {
  return readRemoteServerFile<RemotePeerPublicationsResult>(remotePeerPublicationsRef(id))
}

/** 发布一条 (需登录 token)。 */
export function publish(token: string, input: PublishDraft) {
  return invokeRemoteServerAction<ApiResult<Publication>>("publish", { token, draft: input })
}

/** 删除自己的一条发布 (需登录 token)。 */
export function deletePublication(token: string, id: string) {
  return invokeRemoteServerAction<ApiResult<unknown>>("delete-publication", { token, id })
}
