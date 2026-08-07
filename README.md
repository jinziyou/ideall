# Ideall

Ideall 是一个由 Flutter 构建的多端统一个人信息终端。它借鉴 ideall2 的安静画布、清晰层级和“信息可运行”思想，把创作、管理、浏览、连接与发布收敛为一个本地优先的最小完整应用。

首版仅面向五个原生平台：Android、iOS、Windows、macOS、Linux；不包含 Web。应用标识统一为 `org.wonita.ideall`。

## 已实现

- “我的 / 活动 / 浏览 / 连接 / 设置”五区自适应导航
- 文件夹、富文本笔记、HTTP(S) 书签与发布关联
- Quill Delta 块编辑与行内格式、700 ms 自动保存、撤销/重做、Markdown 发布投影
- 独立 Drift SQLite 数据库、FTS5 全文检索、回收站、JSON 导入/导出（移动端使用系统分享/存储面板）
- 无账户即可完整使用本地功能
- Wonita 公共语料搜索与文章阅读
- Wonita X25519 + XChaCha20-Poly1305 登录、轮换 refresh token、安全存储
- notes / bookmarks / subscriptions 三域手动端到端加密同步，含跨设备删除墓碑
- 明确触发的云端草稿、公开/不列出发布、CAS 更新、不可变版本历史与版本恢复
- 简体中文与英文

## 隐私边界

本地笔记不会自动上传。只有用户点击“立即同步”时，选定同步码加密后的快照才会发送给 Wonita；只有点击“上传为云端草稿”或“发布”时，当前文稿的 Markdown 投影才会进入发布服务。应用不支持任意附件、脚本、插件或用户代码执行。

本项目复用旧应用包名，但使用全新的 `ideall_terminal_v1.sqlite`，不会读取或修改旧 `ideall.db`。测试替换安装时建议使用干净的应用配置目录；首版不提供 ideall2 本地数据迁移。

## 开发

工具链固定为 Flutter 3.44.8 / Dart 3.12.2（见 `.fvmrc`）。

```bash
flutter pub get
dart run build_runner build
flutter run -d linux # 或已连接的 Android/iOS/desktop 设备
```

Linux 构建还需要 CMake、Ninja、GTK 3、libsecret 和 jsoncpp 开发包。例如 Debian/Ubuntu：

```bash
sudo apt install clang cmake ninja-build pkg-config libgtk-3-dev libsecret-1-dev libjsoncpp-dev
```

验证命令：

```bash
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
```

CI 会在对应宿主机上构建 Android、iOS、Windows、macOS 和 Linux 调试产物，并检查 Drift、l10n 与依赖锁文件没有遗漏生成。

## Wonita

默认服务地址为 `https://api.wonita.link`，可在设置中替换为其他 HTTPS 部署。客户端兼容当前公开语料、认证与分区同步协议，并使用新增的发布生命周期 API。后端契约与部署顺序见 [docs/wonita-contract.md](docs/wonita-contract.md)。

更多设计说明：

- [架构与数据模型](docs/architecture.md)
- [安全与隐私](docs/security.md)
- [Wonita 接口契约](docs/wonita-contract.md)

## License

Apache-2.0，见 [LICENSE](LICENSE)。
