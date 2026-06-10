import HubDashboard from "./hub-dashboard"

// 我的首页 = 中枢仪表盘 (活的概览, 数据全部来自本机 IndexedDB)。
// 子区 (订阅 / AI 助手 / 发布 / 资源 / 书签) 各自独立路由, 由 home/layout 提供分区导航。
export default function HomePage() {
  return <HubDashboard />
}
