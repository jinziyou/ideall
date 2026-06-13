// peer (用户发布层) 契约 —— 公开发现/读取 + 带 token 的发布/删除。
// 数据访问 (同构) 实现物理留在 lib/peer-api.ts; 经此暴露给 core/app。
export {
  getPeers,
  getPeerPublications,
  publish,
  deletePublication,
} from "@/components/lib/peer-api"
export type { Publication, PeerPublisher } from "@/components/lib/peer-api"
