import QuickJump, { type Provider } from "../quick-jump"

export const metadata = {
  title: "AI | 工具 | wonita",
  description: "一键将提问跳转到各大 AI 站点。",
}

// 支持 queryUrl 的直接带词跳转; 不支持的回退到复制关键词 + 打开首页
const assistants: Provider[] = [
  {
    name: "ChatGPT",
    home: "https://chatgpt.com",
    queryUrl: "https://chatgpt.com/?q={q}",
    hint: "OpenAI",
  },
  {
    name: "Claude",
    home: "https://claude.ai",
    queryUrl: "https://claude.ai/new?q={q}",
    hint: "Anthropic",
  },
  {
    name: "Perplexity",
    home: "https://www.perplexity.ai",
    queryUrl: "https://www.perplexity.ai/search?q={q}",
    hint: "联网问答",
  },
  {
    name: "Gemini",
    home: "https://gemini.google.com/app",
    hint: "Google · 复制后粘贴",
  },
  {
    name: "Grok",
    home: "https://grok.com",
    queryUrl: "https://grok.com/?q={q}",
    hint: "xAI",
  },
  {
    name: "DeepSeek",
    home: "https://chat.deepseek.com",
    hint: "深度求索 · 复制后粘贴",
  },
  {
    name: "Kimi",
    home: "https://www.kimi.com",
    hint: "月之暗面 · 复制后粘贴",
  },
  {
    name: "通义千问",
    home: "https://www.tongyi.com/qianwen",
    hint: "阿里 · 复制后粘贴",
  },
  {
    name: "豆包",
    home: "https://www.doubao.com/chat",
    hint: "字节 · 复制后粘贴",
  },
  {
    name: "文心一言",
    home: "https://yiyan.baidu.com",
    hint: "百度 · 复制后粘贴",
  },
  {
    name: "Phind",
    home: "https://www.phind.com",
    queryUrl: "https://www.phind.com/search?q={q}",
    hint: "面向开发者",
  },
  {
    name: "You.com",
    home: "https://you.com",
    queryUrl: "https://you.com/search?q={q}",
    hint: "AI 搜索",
  },
]

export default function ToolAiPage() {
  return (
    <QuickJump
      title="AI"
      description="输入问题，一键跳转到各大 AI 站点。不支持带词的会自动复制，打开后粘贴。"
      placeholder="输入要提问的内容…"
      providers={assistants}
    />
  )
}
