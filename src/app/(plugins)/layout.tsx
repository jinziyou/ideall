// 插件分区布局: 活动栏「插件」模块下的终端/Git/数据库等路由; 导航由工作区壳提供, 此处仅透传。
export default function PluginsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
