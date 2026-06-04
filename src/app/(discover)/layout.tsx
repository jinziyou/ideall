import DiscoverNav from "./discover-nav"

export const metadata = {
  title: "发现 | wonita",
  description: "资讯、社区与工具的聚合入口 —— 浏览并(后续)订阅, 回流服务于「我的空间」。",
}

/**
 * 「发现」分区布局: 把 info / community / tool 三个聚合模块统一到「发现」之下,
 * 共享顶部分区导航。各模块页面自带 <main>, 故此处只用 <div> 包裹, 避免 <main> 嵌套。
 */
export default function DiscoverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-2 pt-2 sm:px-4 sm:pt-4">
        <DiscoverNav />
      </div>
      {children}
    </div>
  )
}
