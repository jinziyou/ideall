import { redirect } from "next/navigation"

// 中枢即首屏: 打开 ideall 直接进入「我的」中枢仪表盘。
export default function Home() {
  redirect("/home")
}
