import { AppHeader } from "@/components/app-header"
import InfoList from "./list"

export default function Info() {
  return (
    <main className="flex min-h-screen flex-col gap-3 p-2 sm:p-4 2xl:mx-auto 2xl:w-full 2xl:max-w-screen-2xl">
      <AppHeader
        title="资讯"
        dotClass="bg-spoke-info"
        description="聚合多方来源的事件流 —— 订阅来源或实体, 内容会回流到我的空间。"
      />
      {/* TODO: 新闻分类未实现 (/info/news 路由不存在), 暂禁用占位以免点击 404。 */}
      {/* TODO: 时间段筛选未接线 —— 选中值应转成 timestamp_from_to 传入 fetchInfoEvents, 暂禁用。 */}

      <div className="w-full">
        <InfoList />
      </div>
    </main>
  )
}
