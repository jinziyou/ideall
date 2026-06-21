// 已弃用 (DEPRECATED)。横向头部「我的」链接随壳层重构 (图标轨 + 底部标签栏) 移除;
// 其回流计数逻辑已抽至 use-hub-count.ts, 由 rail.tsx / bottom-tab-bar.tsx 共用。
// 运行环境暂无法删除本文件; 已无任何引用, 可安全删除。保留一个再导出以免悬空。
export { useHubCount } from "./use-hub-count"
