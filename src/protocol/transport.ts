// 传输契约 —— 所有 Server Action 对外的统一返回信封与 fetch 封装。
// 实现物理留在 lib (零内部依赖); protocol 是各子项目消费的稳定入口。
export { apiFetch } from "@/components/lib/api"
export type { ApiResult, ApiFetchOptions } from "@/components/lib/api"
