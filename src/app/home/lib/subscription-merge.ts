// 订阅跨端合并的纯逻辑已上移到 @protocol/sync (契约 + 可独立单测)。
// 此处再导出以兼容现有引用与既有测试 (subscription-merge.test.ts)。
export { unionMerge, subsEqual } from "@protocol/sync"
