import type { Provider } from "./quick-jump"

// 聚合搜索引擎单一真相源: 工具·搜索标签 与 左侧栏聚合搜索 共用。
// 带 queryUrl 的支持「{q}」直接带词跳转 (link-out, 在新标签打开)。
export const SEARCH_ENGINES: Provider[] = [
  {
    name: "Google",
    home: "https://www.google.com",
    queryUrl: "https://www.google.com/search?q={q}",
    hint: "全球综合搜索",
  },
  {
    name: "Bing",
    home: "https://www.bing.com",
    queryUrl: "https://www.bing.com/search?q={q}",
    hint: "微软必应",
  },
  {
    name: "百度",
    home: "https://www.baidu.com",
    queryUrl: "https://www.baidu.com/s?wd={q}",
    hint: "中文综合搜索",
  },
  {
    name: "DuckDuckGo",
    home: "https://duckduckgo.com",
    queryUrl: "https://duckduckgo.com/?q={q}",
    hint: "注重隐私",
  },
  {
    name: "搜狗",
    home: "https://www.sogou.com",
    queryUrl: "https://www.sogou.com/web?query={q}",
    hint: "微信/知乎内容",
  },
  {
    name: "360搜索",
    home: "https://www.so.com",
    queryUrl: "https://www.so.com/s?q={q}",
    hint: "360 综合搜索",
  },
  {
    name: "Yandex",
    home: "https://yandex.com",
    queryUrl: "https://yandex.com/search/?text={q}",
    hint: "俄语/图片搜索",
  },
  {
    name: "知乎",
    home: "https://www.zhihu.com",
    queryUrl: "https://www.zhihu.com/search?type=content&q={q}",
    hint: "问答社区",
  },
  {
    name: "GitHub",
    home: "https://github.com",
    queryUrl: "https://github.com/search?q={q}",
    hint: "代码与项目",
  },
  {
    name: "微博",
    home: "https://weibo.com",
    queryUrl: "https://s.weibo.com/weibo?q={q}",
    hint: "社交热点",
  },
  {
    name: "哔哩哔哩",
    home: "https://www.bilibili.com",
    queryUrl: "https://search.bilibili.com/all?keyword={q}",
    hint: "视频内容",
  },
  {
    name: "MDN",
    home: "https://developer.mozilla.org",
    queryUrl: "https://developer.mozilla.org/zh-CN/search?q={q}",
    hint: "Web 开发文档",
  },
]
