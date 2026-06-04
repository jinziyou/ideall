import QuickJump, { type Provider } from "../quick-jump"

export const metadata = {
  title: "AI | 工具 | wonita",
  description: "一键将提问跳转到各大 AI 助手。",
}

// 支持 queryUrl 的直接带词跳转; 不支持的回退到复制关键词 + 打开首页
const assistants: Provider[] = [
  {
    name: "ChatGPT",
    home: "https://chatgpt.com",
    queryUrl: "https://chatgpt.com/?q={q}",
    accent: "bg-emerald-600",
    hint: "OpenAI",
  },
  {
    name: "Claude",
    home: "https://claude.ai",
    queryUrl: "https://claude.ai/new?q={q}",
    accent: "bg-orange-500",
    hint: "Anthropic",
  },
  {
    name: "Perplexity",
    home: "https://www.perplexity.ai",
    queryUrl: "https://www.perplexity.ai/search?q={q}",
    accent: "bg-teal-600",
    hint: "联网问答",
  },
  {
    name: "Gemini",
    home: "https://gemini.google.com/app",
    accent: "bg-blue-500",
    hint: "Google · 复制后粘贴",
  },
  {
    name: "Grok",
    home: "https://grok.com",
    queryUrl: "https://grok.com/?q={q}",
    accent: "bg-neutral-800",
    hint: "xAI",
  },
  {
    name: "DeepSeek",
    home: "https://chat.deepseek.com",
    accent: "bg-blue-600",
    hint: "深度求索 · 复制后粘贴",
  },
  {
    name: "Kimi",
    home: "https://www.kimi.com",
    accent: "bg-violet-600",
    hint: "月之暗面 · 复制后粘贴",
  },
  {
    name: "通义千问",
    home: "https://www.tongyi.com/qianwen",
    accent: "bg-indigo-600",
    hint: "阿里 · 复制后粘贴",
  },
  {
    name: "豆包",
    home: "https://www.doubao.com/chat",
    accent: "bg-sky-500",
    hint: "字节 · 复制后粘贴",
  },
  {
    name: "文心一言",
    home: "https://yiyan.baidu.com",
    accent: "bg-blue-500",
    hint: "百度 · 复制后粘贴",
  },
  {
    name: "Phind",
    home: "https://www.phind.com",
    queryUrl: "https://www.phind.com/search?q={q}",
    accent: "bg-purple-600",
    hint: "面向开发者",
  },
  {
    name: "You.com",
    home: "https://you.com",
    queryUrl: "https://you.com/search?q={q}",
    accent: "bg-fuchsia-600",
    hint: "AI 搜索",
  },
]

export default function ToolAiPage() {
  return (
    <QuickJump
      title="AI"
      description="输入问题, 一键跳转到各大 AI 助手。部分平台不支持带词跳转, 会自动复制到剪贴板, 打开后粘贴即可。"
      placeholder="输入要向 AI 提问的内容…"
      providers={assistants}
    />
  )
}
