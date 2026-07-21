# 0.2 数据与扩展基线

0.2 是一次有意的破坏性基线升级。应用首次启动时会自动清理旧版管理的 IndexedDB、
Web Storage、安全凭据和扩展授权状态，然后以空工作区启动。外部文件和用户选择的 Git
仓库目录不会被删除，但需要重新授权。

升级前如需保留内容，必须先由 0.1 导出带 CRC32 manifest 的 V2 完整工作区归档；0.2
不接受 V1 归档，也不再读取旧工作区标签、旧同步 blob、旧 Agent/ACP 设置或旧扩展字段。

当前基线只接受：

- FileRef + Engine 工作区标签；
- V2 generation/parts/manifest 加密同步；
- V2 完整工作区归档；
- `risk` 字段的 FileAction；
- 当前版本的 Agent 凭据以及经现行校验器验证的扩展 manifest 与授权 receipt；
- `/home/following`、`/activity/deleted`、`/apps/local-apps`、`/settings/ai` 等规范路由。

若系统凭据库或 IndexedDB 清理失败，应用会停在启动错误页，修复环境后可重新加载重试；
数据 epoch 只有在全部耐久清理成功后才会推进。
