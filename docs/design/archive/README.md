# 历史设计稿归档

本目录只保留仍被现行架构引用的历史决策记录，用于追溯方案取舍与雷区，不作为当前架构权威；
改代码前先看 [docs/architecture.md](../../architecture.md)。已失效的 UI 任务书和静态视觉 mockup
不再随源码维护，必要时可从 Git 历史查阅。

- `ai-native-redesign.md` — 已落地的「个人信息终端 / 一切皆文件 / 一切皆标签页 / fs.* AI 层 / 笔记块级合并」完整推导。现状权威已回写 [architecture.md](../../architecture.md)。
- `resource-vfs-refactor.md` — 已落地的 Resource/VFS 统一模型历史设计。现状权威见 [architecture.md](../../architecture.md) 与当前 `src/filesystem/resource-sources` / `src/filesystem/resource-file-system.ts` / `src/workspace` 代码；`src/vfs` 已退休。
