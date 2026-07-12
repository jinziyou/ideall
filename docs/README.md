# 文档索引

本目录按“当前事实优先、历史设计明确归档”组织。修改代码时先看对应的现行文档；设计记录用于理解取舍，不覆盖当前代码与现行契约。

## 现行架构与开发规范

| 文档 | 用途 |
| --- | --- |
| [architecture.md](architecture.md) | 架构总览、领域模型、模块边界、数据流与关键不变量 |
| [file-system-engine-architecture.md](file-system-engine-architecture.md) | Storage → FileSystem → IdeallFile → Engine → Display 五层契约 |
| [extensions.md](extensions.md) | 扩展概念模型、信任边界与当前落地范围 |
| [development.md](development.md) | 目录结构、依赖边界、开发命令与贡献约定 |
| [design/ui-style.md](design/ui-style.md) | UI 视觉和组件规范 |
| [../.github/SECURITY.md](../.github/SECURITY.md) | 安全策略与漏洞报告方式 |

## 操作手册

| 文档 | 用途 |
| --- | --- |
| [app.md](app.md) | Tauri 开发、构建、平台矩阵、签名与发布 |
| [scripts.md](scripts.md) | 验证、冒烟、API codegen 与维护脚本 |
| [ideall-embed-bridge.md](ideall-embed-bridge.md) | iframe + MCP 嵌入桥协议及宿主安全边界 |

## 决策与后续设计

这些文档记录特定决策或尚未全部落地的方案；其中的“现状”以文首状态说明和现行架构文档为准。

| 文档 | 状态 |
| --- | --- |
| [sync-lww-tradeoff.md](sync-lww-tradeoff.md) | 已落地：关注同步的 LWW、墓碑传播与 GC 取舍 |
| [extension-registry-design.md](extension-registry-design.md) | 历史红队设计基线；运行时 FileSystem + Engine 注册已落地，部分能力/端口扩展仍是方向 |
| [local-data-provider.md](local-data-provider.md) | P1 已落地；运行期连接查看/断开已实现，持久 consent 与外部 transport 停放 |

## 历史归档

| 文档 | 用途 |
| --- | --- |
| [app-history.md](app-history.md) | App-only 与 Tauri 化阶段记录；当前操作以 `app.md` 为准 |
| [design/archive/README.md](design/archive/README.md) | 已完成或废弃的设计稿、原型与路径快照索引 |

维护文档时应同时更新本索引；路径、命令和部署口径必须以仓库当前实现为准，历史数字不要复制到现行说明中。
