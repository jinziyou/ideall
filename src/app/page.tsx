import { redirect } from "next/navigation"

// 中枢即首屏: 打开 myos 直接进入「我的空间」中枢仪表盘。
export default function Home() {
  redirect("/home")
}
