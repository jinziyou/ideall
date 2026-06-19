# ideall 开源清单

发布 ideall 为独立开源仓库前，按本清单逐项确认。本仓库 [`jinziyou/ideall`](https://github.com/jinziyou/ideall) 为源码权威仓库；官方信息服务（采集 / NLP / 知识图谱 / 鉴权）闭源、由官方运营，不在本仓库范围内。

## 1. 法律与品牌

- [x] **[LICENSE](LICENSE)** — Apache 2.0 已就位；版权人为 **lyping**（个人）；jinziyou 注册为法律实体后再 assign 至公司
- [ ] **[TRADEMARK.md](TRADEMARK.md)** — 商标边界已阅读；填写文末联系邮箱
- [ ] **package.json** — `"private": false`，`"license": "Apache-2.0"`
- [ ] （可选）**NOTICE** — 若需额外声明第三方依赖版权，新增 `NOTICE` 文件
- [ ] （建议）**商标/商号注册** — 在核心类别注册 Wonita（独立于本仓库，属法务动作）

## 2. 文档

- [ ] **[README.md](README.md)** — 含「开源客户端 vs 官方信息服务」分层说明
- [ ] **[.env.example](.env.example)** — 含官方 / 本地自托管 / Docker 三种 `SERVER_ADDR` 说明
- [x] （建议）**CONTRIBUTING.md** — PR 规范、开发环境、只接受 ideall 范围改动；含 DCO 签名要求（暂不启用 CLA）
- [x] （建议）**SECURITY.md** — 漏洞报告渠道（`.github/SECURITY.md`，联系邮箱待填）
- [ ] （可选）**.github/FUNDING.yml** — GitHub Sponsors / 爱发电等赞助链接

## 3. 仓库与边界

- [ ] ideall **独立仓库**为源码权威；wonita 仅 submodule 引用
- [ ] **wonita 服务**（server / form / admin）保持私有或独立闭源许可，**不**随 ideall 发布
- [ ] `openapi/server.json` 可公开（API 契约）；采集配置、NLP prompt、图谱数据**不**进入 ideall 仓库
- [ ] CI（`.github/workflows/ci.yml`）在公开仓库可正常运行（无私有 secret 依赖）

## 4. 默认体验

- [ ] 官方发行版默认后端地址指向**官方 API** `https://api.wonita.link`（见 `.env.example` 模式 A / `NEXT_PUBLIC_SERVER_ADDR`）
- [ ] **home / tool** 在无 wonita 服务时可独立使用（本地优先）；**info / community** 文档中说明依赖后端
- [ ] 关于页或 README 链到 [TRADEMARK.md](TRADEMARK.md) 与官方服务条款（TODO: 服务条款 URL）

## 5. 官方 API 运营（wonita 服务侧，非本仓）

- [ ] 官方 wonita 服务发布 **API Terms of Service**（禁止未授权商业镜像、批量再分发数据等）
- [ ] 鉴权、rate limit、滥用监控就绪
- [ ] 对外公布**唯一**官方 API 基址（与 ideall 默认配置一致）

## 6. 发布日

- [ ] 将 ideall 仓库设为 **Public**
- [ ] 打首个 tag（如 `v0.1.0`）并写 Release notes，强调：客户端开源、信息服务官方运营
- [ ] wonita monorepo README 已指向 ideall 开源仓库（通常已存在 submodule 链接）
- [ ] （可选）HN / V2EX / 社群公告，附赞助链接

## 许可选型备忘

当前默认为 **Apache 2.0**（利于社区与插件生态）。若更担心 SaaS fork 改 UI 对外托管，可改为 **AGPL-3.0**（需同步改 LICENSE、README、package.json，并评估对贡献者的影响）。

## 相关链接

| 文档 | 用途 |
| --- | --- |
| [LICENSE](LICENSE) | 源码版权与再分发条款 |
| [TRADEMARK.md](TRADEMARK.md) | 品牌与命名边界 |
| [README.md](README.md) | 用户与开发者入口 |
