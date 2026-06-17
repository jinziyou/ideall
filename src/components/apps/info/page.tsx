import { AppHeader } from "@/components/app-header"
import HotEntities from "./hot-entities"
import InfoList from "./list"

export default function Info() {
  return (
    <main className="flex min-h-screen flex-col gap-3 p-2 sm:p-4 2xl:mx-auto 2xl:w-full 2xl:max-w-screen-2xl">
      <AppHeader
        title="资讯"
        dotClass="bg-spoke-info"
        description="聚合多方来源的事件流，订阅后回流到「我的」。"
      />
      <HotEntities />
      <div className="w-full">
        <InfoList />
      </div>
    </main>
  )
}
