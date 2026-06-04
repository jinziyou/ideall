import { redirect } from "next/navigation"

// 我的空间默认进入「订阅」流 (信息中枢首页)。订阅 / 资源 / 书签各自独立路由, 由 home/layout 提供分区导航。
export default function HomePage() {
  redirect("/home/subscriptions")
}
