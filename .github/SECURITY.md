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

## 威胁模型与信任边界

- **第一方 webview（可信）**：ideall 前端 + 本地数据层（IndexedDB）+ 凭证（account token / BYO apiKey / 同步码）存于宿主 origin 的 `localStorage`。
- **跨域嵌入页（半信任）**：`info`/`community` 默认嵌入 `wonita.link` 的 iframe，独立部署/独立供应链，经 MCP-over-postMessage 桥与宿主通信。
- **模型端点（用户自选外部锚）**：BYO-key 直连，agent 发送的一切它都可见。
- **后端 / 网络（不可信）**：同步后端只存不透明密文；网络中间人在 TLS 下不可破，但后端本身视为敌手。

核心承诺：**个人数据默认不离开设备**；**跨端同步端到端加密、仅上传密文**；**BYO 密钥不经服务端、不过嵌入桥**。涉及 `sync-crypto`、密钥派生、密文存储、嵌入桥能力面、agent 隐私闸的问题请优先报告。

## 本轮加固（2026-06）

- **同步入站时间戳上界**（`@protocol/sync` 的 `isSaneSyncTimestamp` + `isValidRemoteSub`/`isValidRemoteNote`）：拒绝远未来 `createdAt/updatedAt/deletedAt` 与块墓碑 `del`，关闭「持正确同步码但失陷/老旧的对端用远未来时间戳永久赢 LWW、钉死被投毒项或造 GC 清不掉的不死墓碑」路径。
- **CSP `frame-src` 去明文源**：移除 `http://www.wonita.link`/`http://wonita.link`，仅保留 https，杜绝 MITM 在被白名单的明文源上投放页并领取一方嵌入能力。
- **根错误兜底** `app/global-error.tsx`：根 layout 自身崩溃也有恢复 UI。

## 已知取舍（有意接受，非疏漏）

- **凭证明文存 `localStorage`**（account token / BYO apiKey / 同步码）：纯客户端静态分发无 httpOnly cookie，同源 XSS 可读取——这是 XSS 的核心失窃面。纵深靠 `safe-url` 协议白名单（渲染/入库/MCP 写四处收口）压制注入。**路线**：评估迁 OS 安全存储（keychain / Tauri stronghold）。
- **CSP `script-src 'unsafe-inline'`**：Next.js 静态导出向 HTML 注入大量内联 hydration 脚本（单文件 70+），单 hash 无法覆盖、静态导出又无法用 nonce，故暂留 `unsafe-inline`。**路线**：迁移到可去内联脚本的 CSP 方案后移除。
- **`connect-src` 宽放 + Tauri `http:default` 放行任意 URL**：支持 BYO-key 任意端点与自建后端的有意放宽。注意 App 形态出站实际走 Rust `plugin-http`（不受 webview CSP 约束），故仅收窄 webview `connect-src` 不能完全阻断 XSS 后的密钥外传。**路线**：在 App 内验证全部出站确走 plugin-http 后，将 webview `connect-src` 收窄为 `'self' tauri:`。
- **E2E 同步密码学**：AES-256-GCM + 每次随机 IV + HKDF 域分离，后端读不到/伪造不了明文（单测钉死）。固定共享 `salt` + 单轮 HKDF **安全当且仅当同步码为 128bit 机器随机**——禁口令式/用户自拟低熵码（`join` 只应粘贴本 App 生成的码）。当前无前向保密 / 密钥轮换，「关闭同步」不删服务端密文。写入侧无密码学授权（`storageId` 即 bearer 写能力，泄露可 DoS）；`updated_at` 未进 AAD（不可信后端可回滚/扣留旧密文）。**路线**：写授权 MAC、AAD 绑 `storageId`+单调版本、码轮换 + 删云端、`join` 前熵校验。
- **嵌入应用一方自动授权、无运行期吊销面板**：`info`/`community` 一方 manifest 自动获发布/改资料/增删关注书签等能力，无逐次 consent，被嵌页失陷即以一方身份继承全部已授能力。**路线**：落地只读「已连接应用」面板（展示 origin + 已授位）+ 一键吊销。
- **agent 隐私不对称**：`fs.readBlob` 仅受 `fs:read` 闸、无逐项 consent，资源文件二进制可随 agent 读取发往模型端点（与 note/thread 正文的 `fs.notes:read` + 单条 consent 不对称）；`ui.openTab` 自激活可让 agent 把当前活动节点正文经 referenced-context 注入模型。**路线**：为 blob 读加同级 consent 闸（`fs.blobs:read`）、referenced 注入只认「用户手动激活」的节点。
- **X25519 登录口令加密**：仅防传输中被动记录，**不替代 TLS、不对服务端或主动 MITM 保密**（服务端持临时私钥解密；临时公钥未签名/钉定）。真正的口令机密性来自 TLS。**路线**：对临时公钥做服务端长期密钥签名 + 客户端校验。
