# 历史设计稿归档

本目录是**历史设计稿归档**。内容用于追溯方案取舍与雷区,不作为当前架构权威;改代码前先看 [docs/architecture.md](../../architecture.md)。

- `ai-native-redesign.md` — 已落地的「个人信息终端 / 一切皆文件 / 一切皆标签页 / fs.* AI 层 / 笔记块级合并」完整推导。现状权威已回写 [architecture.md](../../architecture.md)。
- `resource-vfs-refactor.md` — 已落地的 Resource/VFS 统一模型历史设计。现状权威见 [architecture.md](../../architecture.md) 与当前 `src/filesystem/resource-sources` / `src/filesystem/resource-file-system.ts` / `src/workspace` 代码；`src/vfs` 已退休。
- `UI-REDESIGN-PROMPT.md` — 当年「IDE 面板工作区」重构的任务书。其中「工作台 / 中枢 (hub) / spoke 模块 / 订阅回流」等定位与语汇已全站弃用(现为「个人信息终端」+「我的 + 发现模块」+「一切皆文件 / 一切皆标签页」,用户文案「订阅」已统一为「关注」);引用的 `shell/discover-layout.tsx`、`HubNavLink`、`info/analysis/graph.tsx` 等文件/符号已不存在。
- `ui-redesign-proposals.html` / `ui-redesign-chosen.html` / `ui-ai-box-options.html` — 选型探索期的视觉 mockup(含「便当工作台」等提案期方案),不反映已落地 UI。
