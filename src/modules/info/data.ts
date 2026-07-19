// info 取数 facade —— 远程对象先由 remote.server FileSystem 投影为文件，再读取其内容。
// provider 内部仍消费可替换 ServerPort，保留同构与后端可换语义。
import type { InfoQuery } from "@protocol/server-port"
import {
  readRemoteServerFile,
  remoteEntityRef,
  remoteInfoQueryRef,
  remoteInfoRef,
  remoteRelatedInfoRef,
  type RemoteEntityResult,
  type RemoteInfoQueryResult,
  type RemoteInfoResult,
  type RemoteRelatedInfoResult,
} from "@/filesystem/remote-server-file-system"

/** 信息查询参数 (= ServerPort 的 InfoQuery)。 */
export type QueryParams = InfoQuery

/** 最新信息列表。 */
export function fetchLatestInfo(params: InfoQuery | Record<string, unknown>) {
  return readRemoteServerFile<RemoteInfoQueryResult>(remoteInfoQueryRef(params as InfoQuery))
}

/** 某条信息的「全面报道」：由 V2 稳定文章 ID 查图关联的其它来源。 */
export function getRelatedInfo(url: string) {
  return readRemoteServerFile<RemoteRelatedInfoResult>(remoteRelatedInfoRef(url))
}

/** 实体详情聚合。名称由适配器解析为 V2 稳定实体 ID；拿不到返回 null。 */
export function getEntityDetail(label: string, name: string) {
  return readRemoteServerFile<RemoteEntityResult>(remoteEntityRef(label, name))
}

/** 单条信息详情 (全面报道整页主链路)。返回 ApiResult: `ok:false` 取数失败可重试; `ok:true & data:null` 真不存在。 */
export function getInfo(url: string) {
  return readRemoteServerFile<RemoteInfoResult>(remoteInfoRef(url))
}
