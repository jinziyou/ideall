// 内置技能 (agent 侧预置提示模板) —— P-先行 skill 切片 (Path B)。
//
// 一个技能 = 一条声明式记录: 触发时把 prompt 当一条 user 消息直接喂进现有 send() 回路;
// 其所需的「当前节点」上下文由已有的 gatherReferencedContext()/buildSystemPrompt() 同一管线注入,
// 技能本身只产「指令文本」, 不改传输/协议/授权层。
//
// 不走 MCP Prompts: provider==consumer 同进程下那只是把字符串绕 JSON-RPC 一圈、当前无跨进程消费方
// = 易成死代码 (见 docs/extension-registry-design.md「Path A 推迟」)。与 docs/extensions.md 的
// 「skill = MCP Prompts」关系: 本表是其 agent 侧前身, 出现跨进程消费方 (iframe/出站外部 MCP) 时再升级,
// 二者共享同一份内置模板数据源。

export interface AgentSkill {
  id: string
  /** 短名 (技能菜单)。 */
  label: string
  /** 一句说明 (菜单副标题)。 */
  hint: string
  /** 发给模型的 user 消息 (技能即一条预置提示)。 */
  prompt: string
  /** 需要当前打开的节点 (note/thread) 作上下文; 缺则触发前提示用户先打开 (见 AgentPanel.runSkill)。 */
  needsActiveNode?: boolean
  /** 默认开智能体模式 (要工具读写「我的」数据的技能)。 */
  agentMode?: boolean
}

export const BUILTIN_SKILLS: AgentSkill[] = [
  {
    id: "summarize-active",
    label: "总结当前",
    hint: "概括你正打开的笔记或对话",
    prompt: "请聚焦我当前打开的内容（见上下文），用简洁中文给出摘要与关键要点。",
    needsActiveNode: true,
  },
  {
    id: "feed-digest",
    label: "关注速览",
    hint: "根据你关注的来源给条速览",
    prompt: "根据我关注的来源，最近有什么值得关注？给一条简短速览，并按重要性排序。",
  },
]
