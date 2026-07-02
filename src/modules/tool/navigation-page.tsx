import { ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card"
import { PinToolButton } from "@/shared/feeders"

// 工具·导航视图 (由工作区 registry 作为标签内容渲染; 不再是独立路由页)。
type Site = { name: string; url: string; desc?: string }
type Category = { title: string; sites: Site[] }

const categories: Category[] = [
  {
    title: "开发",
    sites: [
      { name: "GitHub", url: "https://github.com", desc: "代码托管" },
      { name: "Stack Overflow", url: "https://stackoverflow.com", desc: "技术问答" },
      { name: "MDN", url: "https://developer.mozilla.org/zh-CN", desc: "Web 文档" },
      { name: "npm", url: "https://www.npmjs.com", desc: "JS 包仓库" },
      { name: "Can I use", url: "https://caniuse.com", desc: "兼容性查询" },
      { name: "DevDocs", url: "https://devdocs.io", desc: "API 文档聚合" },
    ],
  },
  {
    title: "AI 与效率",
    sites: [
      { name: "Hugging Face", url: "https://huggingface.co", desc: "模型社区" },
      { name: "Excalidraw", url: "https://excalidraw.com", desc: "手绘白板" },
      { name: "Notion", url: "https://www.notion.so", desc: "笔记协作" },
      { name: "TinyPNG", url: "https://tinypng.com", desc: "图片压缩" },
      { name: "JSON Crack", url: "https://jsoncrack.com", desc: "JSON 可视化" },
      { name: "Regex101", url: "https://regex101.com", desc: "正则调试" },
    ],
  },
  {
    title: "设计",
    sites: [
      { name: "Figma", url: "https://www.figma.com", desc: "界面设计" },
      { name: "Dribbble", url: "https://dribbble.com", desc: "设计灵感" },
      { name: "Unsplash", url: "https://unsplash.com", desc: "免费图库" },
      { name: "Coolors", url: "https://coolors.co", desc: "配色方案" },
      { name: "Iconfont", url: "https://www.iconfont.cn", desc: "矢量图标" },
      { name: "Lucide", url: "https://lucide.dev", desc: "开源图标" },
    ],
  },
  {
    title: "资讯",
    sites: [
      { name: "Hacker News", url: "https://news.ycombinator.com", desc: "科技资讯" },
      { name: "少数派", url: "https://sspai.com", desc: "数字生活" },
      { name: "36氪", url: "https://36kr.com", desc: "创投资讯" },
      { name: "InfoQ", url: "https://www.infoq.cn", desc: "技术资讯" },
      { name: "知乎", url: "https://www.zhihu.com", desc: "问答社区" },
      { name: "V2EX", url: "https://www.v2ex.com", desc: "创意社区" },
    ],
  },
]

export default function ToolNavigationPage() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {categories.map((category) => (
        <Card key={category.title}>
          <CardHeader>
            <CardTitle className="text-base">{category.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {category.sites.map((site) => (
                <div key={site.name} className="relative">
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col gap-0.5 rounded-xl border p-2.5 pr-7 transition-colors hover:border-spoke-tool/40 hover:bg-spoke-tool/5"
                  >
                    <span className="flex items-center gap-1 text-sm font-medium">
                      {site.name}
                      <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                    </span>
                  </a>
                  <PinToolButton
                    name={site.name}
                    url={site.url}
                    className="absolute right-1 top-1"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
