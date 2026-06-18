// info 领域类型 —— 由 myos 自有协议 `@protocol/server-port` 派生 (不再依赖 super/server wire DTO)。
// 任何实现了 ServerPort 的 super-node 都按这些类型供给; wire→domain 映射在 HTTP 适配器内。
export type {
  Info,
  InfoEvent,
  NameEntity,
  Publisher,
  RelatedInfo,
  EntityDetail,
  EntityBrief,
  EntityStats,
} from "@protocol/server-port"
