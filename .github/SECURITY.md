# 安全策略

## 适用范围

本策略仅覆盖 **ideall 客户端**（本仓库）。

- ✅ ideall 前端、本地数据层、跨端同步加密（`src/lib/sync-crypto.ts`）、插件、Tauri App 壳
- ❌ **官方信息服务后端**（采集 / NLP / 知识图谱 / 鉴权 API）不在本仓库范围内；相关问题请通过官方服务渠道反馈

## 报告漏洞

**请勿在公开 Issue / PR / Discussion 中披露安全漏洞。**

请通过 GitHub 私密通道报告：

- 仓库 **Security → Report a vulnerability**（GitHub Security Advisories）—— 当前唯一正式渠道

报告请尽量包含：受影响版本 / 形态（Web 或 App）、复现步骤、影响评估、可能的修复建议。

> 官方域名（`wonita.*`）上线后将增设 `security@` 邮箱与 PGP 公钥，并在此更新。

## 处理流程与预期

- ideall 由小团队 / 个人维护，我们会尽力在合理时间内确认与响应（best-effort）
- 修复发布后会在 Release notes 中致谢报告者（如你愿意具名）
- 请给予合理的协调披露窗口，在修复发布前不公开细节

## 特别关注

跨端同步采用端到端加密（同步码派生密钥，仅上传密文）。涉及 `sync-crypto`、密钥派生、密文存储的问题请优先报告。
