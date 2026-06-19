// info 领域类型 —— 由 ideall 自有协议 `@protocol/server-port` 派生 (不再依赖 wonita 服务 wire DTO)。
// 任何实现了 ServerPort 的后端都按这些类型供给; wire→domain 映射在 HTTP 适配器内。
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
