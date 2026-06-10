import SubscriptionFeed from "./subscription-feed"
import SyncPanel from "./sync-panel"

export const metadata = {
  title: "订阅 | wonita",
  description: "已订阅来源的最新内容，汇聚到「我的空间」。",
}

export default function SubscriptionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <SyncPanel />
      <SubscriptionFeed />
    </div>
  )
}
