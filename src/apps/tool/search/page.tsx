import QuickJump, { type Provider } from "../quick-jump"

export const metadata = {
  title: "搜索 | 工具 | wonita",
  description: "一键将关键词跳转到各大搜索引擎。",
}

const engines: Provider[] = [
  {
    name: "Google",
    home: "https://www.google.com",
    queryUrl: "https://www.google.com/search?q={q}",
    accent: "bg-blue-500",
    hint: "全球综合搜索",
  },
  {
    name: "Bing",
    home: "https://www.bing.com",
    queryUrl: "https://www.bing.com/search?q={q}",
    accent: "bg-teal-600",
    hint: "微软必应",
  },
  {
    name: "百度",
    home: "https://www.baidu.com",
    queryUrl: "https://www.baidu.com/s?wd={q}",
    accent: "bg-blue-600",
    hint: "中文综合搜索",
  },
  {
    name: "DuckDuckGo",
    home: "https://duckduckgo.com",
    queryUrl: "https://duckduckgo.com/?q={q}",
    accent: "bg-orange-500",
    hint: "注重隐私",
  },
  {
    name: "搜狗",
    home: "https://www.sogou.com",
    queryUrl: "https://www.sogou.com/web?query={q}",
    accent: "bg-amber-500",
    hint: "微信/知乎内容",
  },
  {
    name: "360搜索",
    home: "https://www.so.com",
    queryUrl: "https://www.so.com/s?q={q}",
    accent: "bg-green-600",
    hint: "360 综合搜索",
  },
  {
    name: "Yandex",
    home: "https://yandex.com",
    queryUrl: "https://yandex.com/search/?text={q}",
    accent: "bg-red-500",
    hint: "俄语/图片搜索",
  },
  {
    name: "知乎",
    home: "https://www.zhihu.com",
    queryUrl: "https://www.zhihu.com/search?type=content&q={q}",
    accent: "bg-blue-500",
    hint: "问答社区",
  },
  {
    name: "GitHub",
    home: "https://github.com",
    queryUrl: "https://github.com/search?q={q}",
    accent: "bg-neutral-800",
    hint: "代码与项目",
  },
  {
    name: "微博",
    home: "https://weibo.com",
    queryUrl: "https://s.weibo.com/weibo?q={q}",
    accent: "bg-red-500",
    hint: "社交热点",
  },
  {
    name: "哔哩哔哩",
    home: "https://www.bilibili.com",
    queryUrl: "https://search.bilibili.com/all?keyword={q}",
    accent: "bg-pink-500",
    hint: "视频内容",
  },
  {
    name: "MDN",
    home: "https://developer.mozilla.org",
    queryUrl: "https://developer.mozilla.org/zh-CN/search?q={q}",
    accent: "bg-neutral-700",
    hint: "Web 开发文档",
  },
]

export default function ToolSearchPage() {
  return (
    <QuickJump
      title="搜索"
      description="输入关键词, 一键跳转到各大搜索引擎。"
      placeholder="输入要搜索的关键词…"
      providers={engines}
      historyKey="tool:search:history"
    />
  )
}
