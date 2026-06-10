# myos UI 重新设计 (redesign spec)

> 本文档由 myos-ui-redesign 多智能体工作流综合产出 (理解定位 → 3 方案设计 → 评审 → 综合)。
> 脊柱方案: 中枢仪表盘 (Hub-as-living-dashboard) × 身份层 × 透明落库 chip。

> ⚑ **配色已定稿 (覆盖下文 §5 的 ember 方案)**: 经效果图多轮比选, 最终采用 **Ink 纯墨灰 (monochrome)** ——
> 整体黑白灰, `--primary`/`--pop` 皆为墨色, 关键动作 (收入中枢/回流) 靠「墨色填充 + 字重」突出, 不靠彩色;
> `--spoke-*` 三色 (资讯蓝 / 社区绿 / 工具紫) 仅用于小圆点 / 卡顶边 / spoke rail 做功能归类。
> 真相源为 `src/app/globals.css` 的 token 块 (Phase 0 已落地)。暗色用自写轻量控制器 (THEME_INIT 内联脚本 +
> ThemeApplier 兜底 + ThemeToggle), **不依赖 next-themes** (沙箱内 registry 不可达)。品牌字形 `wonita.svg`/`icon.svg`
> 已优化为暗色安全 (currentColor + favicon prefers-color-scheme)。下文 §5 的 ember HSL 值仅作历史参考。


> 权威最终稿。脊柱 = **方向 A「中枢仪表盘 / Hub-as-living-dashboard」**（三位评委一致排名第一，44.3 / 43.7 / 43.4）。在其结构上**嫁接**方向 C 的「暖纸墨 + ember-amber 身份层 + 本地·此设备所有权链」（评委一致点名的最高 distinctiveness/最低风险皮肤）与方向 B 的**透明工具调用 chip**（`✓ 已写入本机 / 撤销`，三位评委一致点名为最佳「per-action local-first 具象化」）。**拒绝**把 agent 做成产品脊柱（B 的结构性赌注）——评委一致认定其依赖不可靠的 BYO-key、且其兜底恰是 A 的 dashboard。
>
> 全部改动落在 Next.js 16 App Router + Tailwind v4 `@theme` + shadcn/ui，**不新增并行 UI 库**，**不为 home 数据新增 server 依赖**，**不破坏 info→super/server 契约**（DTO 仍从 `src/components/lib/api/server.d.ts` 派生）。暗色采用**自写轻量方案**（`THEME_INIT` 内联脚本 + `ThemeApplier` + `lib/theme.ts`），**不引入 `next-themes`**（沙箱内 registry 不可达）。所有面向用户文案保持简体中文。

---

## 1. 设计原则 (Design principles)

**P1 · 中枢即首屏 (Hub is the first screen).** 打开 myos 第一眼 = 你自己的中枢概览，而非欢迎卡。`/` 与 `/home` 渲染同一块**活的 dashboard**。重心从「home vs 发现 平级四 tab」反转为「一个看得见的家 + 三条带东西回家的路」。任何让 spoke 看起来与 hub 同色同权重的设计即违背模型。

**P2 · 回流必须落到看得见的地方 (Flow-back must land somewhere visible).** 「回流 (收入中枢)」是第一类、贯穿式交互。每个 spoke 的**每一个条目**（不止来源粒度——文章/事件/分析图/搜索词/地图点）都有统一的 `<SaveToHub>` 控件；每次成功都有「飞回家」动效 + header 计数 +1，并**实时落进 dashboard 的「最近回流」时间线**——回流第一次有了肉眼可见的目的地。

**P3 · 本地优先要被「看见」而非「论证」(Local-first felt, not argued).** 全局 chrome 常驻一枚 `本地 · 此设备 🔒` 所有权药丸 + 同步状态芯片；同步码 / storageId / domain / peer id 一律 mono 字体（「终端」质感）；区分「本地恒在」与「联网才有」两类加载/错误态。所有权从 prose 升级为持续可见的身份。

**P4 · 墨重拥有感，冷色借来感 (Ink weight = mine, cool hue = borrowed).** 用视觉**重量**表达 hub-and-spoke（配色定稿为 Ink 纯墨灰，**不靠色温**）：hub = 墨色 2px 左轨（`border-pop`）+ 「本地恒在」芯片；spoke = 各自 spoke-hue 2px 顶边 + 较轻的卡 + 「联网才有」芯片。墨色（`--pop` == `--flowback`）同时是「拥有」与「回流」的语义色——「这进了我的中枢」始终是同一抹墨；spoke 三色仅作小圆点/顶边/rail 的功能归类。

**P5 · 不破坏既有能力，复用先于重写 (Reuse over rebuild).** myos 已远超「默认 shadcn 欢迎卡」：IndexedDB 五仓库、E2E 同步、8 轮 agent 工具循环、subscription-feed live fetch 全部已建成。本次是**表达层重塑**：~80% 建立在已有本地查询与组件上，net-new 主要是装配与皮肤，不是新后端能力。

---

## 2. 信息架构与导航 (IA & Navigation)

### 2.1 路由树（新/改/删 标注）

```
src/app/
├── layout.tsx                 [改] THEME_INIT 内联脚本 (无闪烁) + <ThemeApplier/> 水合兜底 + <html lang="zh-CN" suppressHydrationWarning>; 字体走 globals.css 的 --font-sans/--font-mono (无 next/font)
├── page.tsx                   [改] throwaway 欢迎卡 → 渲染 <HubDashboard/> (与 /home 同组件)
├── header.tsx                 [改] nav-config 单一真相源驱动桌面+移动; hub-primary; <CommandPalette/> ⌘K; <LocalDeviceChip/> 本地药丸; <ThemeToggle/> 主题切换; <HubNavLink/> 回流计数 badge
├── command-palette.tsx        [新] 死 disabled input → ⌘K CommandPalette (无独立 search.tsx; cmdk 包装在 components/ui/command.tsx)
├── not-found.tsx              [改] 「返回首页」目标 / → /home
├── account-menu.tsx           [改] 退出后跳转 / → /home
│
├── home/  ───────────────────  HUB / 我的空间 (信息中枢, 本地优先)
│   ├── layout.tsx             [改] 墨色左轨 + 本地·此设备框架; 顶栏统一; 子页共享
│   ├── page.tsx               [改] redirect("/home/subscriptions") → <HubDashboard/>  ★关键反转
│   ├── home-nav.tsx           [改] 顶部新增「概览」入口; 墨色 active 态 (bg-pop/10 + border-pop); usage bar bg-primary; +同步状态行
│   ├── hub-dashboard.tsx      [已交付] 中枢仪表盘本体 (被 / 与 /home 共用)
│   ├── recent-flowback.tsx    [已交付] 「最近回流」跨 store merge-sort 时间线 ★脊柱
│   ├── hub-stat-tiles.tsx     [已交付] 所有权一览 (复用 home-nav 查询)
│   ├── live-spoke-peek.tsx    [未实现·规划] 「关注的新内容」live 区暂未拆出独立组件
│   ├── hub-composer.tsx       [未实现·规划] 内联 agent composer 暂未拆出独立组件
│   ├── save-to-hub.tsx        [已交付] 统一回流原语 (按对象 bookmark/publisher 分派, 见 §4.0)
│   ├── lib/flowback.ts        [已交付] HUB_UPDATED 进程内事件 + notifyHubUpdated() 计数广播 (取代规划中的 flowback-anim.tsx)
│   ├── subscribe-button.tsx   [留] 订阅开关 (独立于 SaveToHub; 对外签名 prop sub: NewSubscription 不变)
│   ├── pin-tool-button.tsx    [留] 「钉到 home」开关 (独立于 SaveToHub)
│   ├── subscriptions/         [留] 订阅流 (SyncPanel + SubscriptionFeed) — 同步码 mono 化
│   ├── agent/                 [留] AI 助手; chat-message tool chip 已为「已写入本机」(Lock)/「仅读取」(Eye) 角标
│   ├── publications/ resources/ bookmarks/   [留] 内容不变, 套用新框架; 空态目前各页内联
│   └── lib/                   [留] +新增 agent 工具 (规划, 见 §7)
│
└── (discover)/  ─────────────  SPOKES (路由组, URL 无 /discover)
    ├── layout.tsx             [改] 顶部分区导航统一; 每 spoke 顶边 hue; 右上「↩ 回流去向: 我的空间」
    ├── discover-nav.tsx       [改] pill 带 spoke-hue dot + icon tint
    ├── info/                  [留+回流] 列表/搜索/实体/发布者/analysis; 复活 disabled actions dropdown
    ├── community/             [留+回流] 地图 popover 就地订阅; peer 卡增强 (文库/分享占位路由已移除)
    └── tool/
        ├── layout.tsx         [改] 取消二级 pill 套娃 → 页内 segmented control
        ├── search/ ai/ navigation/  [留+回流] 结果回流; rainbow → --spoke-tool token
```

**净新增路由**：无（原 PLANNED 的 `/community/library`、`/community/shared` 文库/分享占位路由已**移出本次范围**——community 回流暂以「订阅 peer」为唯一路径；文库/分享待后续单独立项再议）。
**净移除**：throwaway `/` 卡（重写为 dashboard）；`tool` 的第二层 pill 套娃；文库/分享占位路由（不做）。
**合并**：`/` 与 `/home` 共用 `<HubDashboard>`；404 / 退出默认目标 `/` → `/home`。
**URL/契约不动**：三 spoke 仍为 `/info`、`/community`、`/tool`；info→super/server 契约不变。

### 2.2 全局 Header（重写 `header.tsx`，单一 nav config 驱动桌面 + 移动）

中枢获视觉首位，spoke 显式从属。**一份 `navConfig` 数组**同时驱动桌面与移动 Sheet（消除手抄漂移）。

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [◆wonita]  我的空间●³⁴       发现· ⬤资讯  ⬤社区  ⬤工具      [⌘K 搜索/问助手]  🌓 [本地·此设备🔒▾] [账户▾] │
│  amber mark  ▲PRIMARY,粗,amber下划线  ───次级 spoke 簇, 各带 hue dot───   命令台      主题  所有权药丸+同步态     │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **「我的空间」= 唯一主项**：左锚、加粗、active 时墨色实心下划线，挂一枚**回流计数 badge**（订阅+书签，`HUB_UPDATED` 事件驱动，回流成功时 count-up）。点击 → `/home`（dashboard）。它**不再与「发现」平级**。组件为 `src/app/shell/hub-nav-link.tsx`。
- **「发现」= 明确次级 spoke 簇**：三条 spoke 内联平铺为轻量文字链接（**不是隐藏 dropdown**），各前缀 spoke-hue 圆点（info 蓝 / community 绿 / tool 紫）。整体重量明显轻于「我的空间」。
- **⌘K 命令台**（组件 `src/app/shell/command-palette.tsx`，**无独立 `search.tsx`**）：shadcn `Command`（cmdk 已装，包装在 `src/components/ui/command.tsx`）。统一入口：跳 spoke / 过滤 `/info` 标题 / 把 query 交给 home agent / 新建书签。对「总控终端」这是定义性控件。
- **本地·此设备 🔒 药丸**（组件 `src/app/shell/local-device-chip.tsx`，常驻）：`HardDrive`/lock 图标 + 墨色文案。hover/点开展开「你的数据存在这台设备，没有上传服务器」+ 同步状态（已同步码 N 设备 / 未开启）+ 本地存储用量（`navigator.storage.estimate()`，从 home-nav 提升到全局）+ 链到同步面板。
- **🌓 主题切换**（组件 `src/app/shell/theme-toggle.tsx`）：调 `lib/theme.ts` 的 `setThemeChoice`，复活已存在的 `.dark` 块（自写方案，**不依赖 `next-themes`**）。
- **账户菜单**：复用，退出跳 `/home`。

### 2.3 Hub nav（`home-nav.tsx`，子页左侧栏，统一所有权语言）

dashboard 是入口；深入子区时左侧栏保留（已有 counts + usage bar——全应用唯一 feel local-first 的导航），扩为 6 项 + 同步行：

```
◆ 概览 (Overview)        ← 新增, = dashboard 本体, /home
⬡ 订阅流          (12)
⬡ AI 助手          (5)
⬡ 我的发布         (3)   ← 补上现 null badge: 登录后 getPeerPublications(self)
⬡ 资源管理         (8)
⬡ 书签管理         (34)
─────────────────────
▤ 本地存储 ▓▓▓▓░ 38%      ← usage bar 保留, amber 填充
🔒 同步: 已开 · 3 设备     ← 新增同步状态行 (读 getSyncCode)
```

active 态（已实现）：`bg-pop/10 font-medium text-foreground` + 2px 墨色左轨（`md:border-l-2 md:border-pop`，替换平 `bg-accent`）；usage bar 填充为 `bg-primary`（墨）。

### 2.4 Spoke nav（`discover-nav.tsx` + `tool/layout.tsx`）

- 顶部分区导航保留 pill，但每个 pill 带 **spoke-hue dot + icon tint**；每个 spoke 页右上常驻「**↩ 回流去向：我的空间**」+ 该 spoke 已回流计数（§0.4 设计法则的视觉词汇）。
- **tool 取消二级 pill 套娃**：`/tool/search|ai|navigation` 改为页内 segmented control（文字 + 下划线，从属于「tool 的三种透镜」，不再 pill-in-pill）。三 spoke 导航形态从此一致。

### 2.5 Mobile

同一 `navConfig` 驱动移动 Sheet（单一真相源）。结构：顶部「我的空间」全宽 amber 框主磁贴 + 下方「发现」三 spoke 分组列表（带 hue dot）+ ⌘K 入口 + 本地药丸 + 主题切换。底部常驻轻量 tab bar 可选：`概览 / 资讯 / 社区 / 工具`，中枢居首。

### 2.6 hub-and-spoke 心智模型（ASCII，§0.4）

```
                     ┌──────────────────────────────┐
                     │      ◆ 我的空间 (HUB)         │   暖 amber
                     │   信息中枢 · 本地 · 此设备 🔒  │   恒在 / 拥有
                     │  订阅·发布·资源·书签·端上AI    │
                     └───▲──────────▲──────────▲─────┘
       聚合资讯回流 ─────┘   他人/分享回流 ┘   外部能力回流 ┘
            │                  │                  │
       ┌────┴────┐        ┌────┴────┐        ┌────┴────┐
       │ ⬤资讯   │        │ ⬤社区   │        │ ⬤工具   │   冷 spoke-hue
       │  info   │        │community│        │  tool   │   联网 / 借来
       │ (蓝)    │        │ (绿)    │        │ (紫)    │
       └─────────┘        └─────────┘        └─────────┘
   唯一消费 super/server   发布者地图+peer    搜索/AI/导航

   箭头全部指向 home。回流 = <SaveToHub> 把 spoke 对象落进本地 store 的一次动作。
   任何让箭头看起来双向平级的设计 = 违背模型。
```

---

## 3. 着陆页与中枢仪表盘 (Landing + Hub Dashboard)

`/` 与 `/home` 渲染同一个 `<HubDashboard>`。自适应三态：**空中枢**（onboarding，教模型）/ **有数据**（聚合视图）/ **离线**（本地恒在区先渲染，联网区降级）。所有数据来自已有本地查询 + 已有 spoke fetch，**零新 server 依赖**。

### 3.1 有数据态（ASCII 线框）

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ▌我的空间 · 信息中枢          欢迎回来 · 你的数据存在这里     本地·此设备 🔒  已同步 ✓   │  ← amber 左轨
│   wonita · 想你所想 · 链接我你TA                                                       │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ① 所有权一览 (stat tiles, amber, tabular-nums)  ─── 纯本地, 首屏即渲染 ───            │
│ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌────────────────────────────┐               │
│ │订阅 12││书签 34││文件 8 ││对话 5 ││发布 3 ││ 本地存储 ▓▓▓▓░░ 38% · 0.6/2GB│             │
│ └──────┘└──────┘└──────┘└──────┘└──────┘└────────────────────────────┘               │
├───────────────────────────────────────┬─────────────────────────────────────────────┤
│ ② 最近回流 (THE SPINE) ─ 纯本地, 首屏  │ ④ 问问我的中枢 (内联 agent composer)          │
│   跨 store merge-sort by createdAt      │  ┌──────────────────────────────────────┐    │
│   分组 今天 / 本周, 每行 spoke-hue dot  │  │ 问问你的中枢…       [智能体模式 ▸]    │    │
│   ⤵ 今天                                │  └──────────────────────────────────────┘    │
│    ⬤蓝 订阅了发布者「界面新闻」  2分钟   │   动态建议 (由真实 counts 生成):              │
│    ⬤紫 钉了工具「Perplexity」    1小时   │   ▷ 你有 7 个未分组书签，要我归类吗？         │
│    ⬤amber 收藏书签「…」→ 阅读夹  3小时   │   ▷ 总结我订阅源今天的更新                    │
│   ⤵ 本周                                │   ▷ 把「界面新闻」最新一篇存成书签            │
│    ⬤绿 订阅 peer「张三」               │   ┌─ 最近会话 ─┐                              │
│    ⬤蓝 订阅搜索「大模型@36kr」          │   │ · 整理本周资讯│  · 写发布草稿               │
│   [ 查看全部回流 → ]                    │   └─────────────┘                            │
├───────────────────────────────────────┴─────────────────────────────────────────────┤
│ ③ 关注的新内容 · 实时 (live spoke peek) ─── 联网才有, 异步带次 + 骨架 + per-source 隔离 ─│
│ ┌─────────────┐┌─────────────┐┌─────────────┐                                         │
│ │⬤蓝 界面新闻  ││⬤蓝 实体:OpenAI││⬤绿 peer:张三 │   [ 进订阅流看全部 → ]               │
│ │ 最新 3 条    ││ 最新 3 条    ││ 最新 3 条    │   (只取前 3-4 个来源, 保首屏)         │
│ └─────────────┘└─────────────┘└─────────────┘                                         │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ ⑤ 已钉工具 (chip launcher, 复用)   🔍 浏览器  🤖 Perplexity  📚 ...                     │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ ⑥ 去发现，带东西回家 (spoke entry, 框定为「回流入口」, 非平级 tab)                       │
│   ⬤蓝 资讯 → 订阅发布者/实体 · 保存文章   ⬤绿 社区 → 订阅 peer · 接收他人发布            │
│   ⬤紫 工具 → 钉工具 · 存搜索              三条进料口, 箭头都指向上方中枢                 │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 各区数据来源（全部已存在，零新 server 依赖）

| 区 | 数据来源（已有） | 加载分级 | 说明 |
| --- | --- | --- | --- |
| ① 所有权一览 | `listSubscriptions/listBookmarks/listFiles/listThreads`（home-nav 已查）+ `getPeerPublications(self)`（补 null badge）+ `navigator.storage.estimate()` | **本地恒在·首屏** | `tabular-nums` 工程感 |
| ② **最近回流** | 跨 `subscriptions/bookmarks/files/agentThreads/publications` 按 `createdAt`/`updatedAt` client-side merge-sort | **本地恒在·首屏** | **脊柱**：回流唯一可见落点 |
| ③ 关注的新内容 (live) | `subscription-feed` 的 `loadFeed`/`fetchLatestInfo`/`getPeerPublications` | **联网才有·异步带次** | 只取前 3–4 来源 + 骨架 + per-source error 隔离 |
| ④ 问问我的中枢 | 内联 `agent-panel` composer + `listThreads()` | 本地（agent 联网） | 动态建议替换 3 条静态串；未配 key → 退化为「配置助手」引导 |
| ⑤ 已钉工具 | `subscriptions` 中 `type:"tool"` | 本地恒在 | 复用现 chip launcher |
| ⑥ 去发现 | 静态 spoke 入口 + 各 spoke 已回流计数 | 本地恒在 | 显式 hub-and-spoke 拓扑 |

**首屏性能 / 三态护栏**：纯本地区（①②④⑤⑥）先渲染；联网区（③）异步补、带骨架、per-source error 隔离（已有口径）。未登录 → 隐藏「发布」tile / publications badge 显 0、live peek 仍工作（订阅本地）。离线 → ③ 显「联网才有，当前离线」降级条，其余照常。

### 3.3 空中枢态（onboarding，教模型）

替换现 `subscription-feed` 的 bare `<p>` 与 throwaway `/` 卡，用统一 `<EmptyState>`：一张 **hub-and-spoke 迷你示意图**（home amber 居中，三条 spoke-hue 箭头指向它），每条 spoke 一个「去这里带东西回家 →」CTA：

```
┌──────────────────────────────────────────────────────────────┐
│             ◆ 我的空间还是空的 —— 去带点东西回家               │
│                                                              │
│                    ┌──────────────┐                          │
│                    │ ◆ 我的空间   │  ← 你的数据会落在这里      │
│                    └──▲───▲───▲───┘                          │
│             ┌─────────┘   │   └─────────┐                    │
│        ⬤蓝 资讯          ⬤绿 社区        ⬤紫 工具             │
│     [订阅发布者 →]    [订阅 peer →]    [钉工具 →]            │
│   聚合资讯回流       他人/分享回流      外部能力回流           │
└──────────────────────────────────────────────────────────────┘
```

把死屏变成产品心智模型的第一课。

---

## 4. 三条 spoke 的重新设计 + 显式回流

### 4.0 统一回流原语 `<SaveToHub>`（§7 净新增核心）

`<SaveToHub>` 是一个**墨色风格**的「收入中枢」控件，按对象类型分派落库（已落地于 info `columns.tsx` 等处）。它与既有 `SubscribeButton`（publisher/entity/search/peer）、`PinToolButton`（tool）**并存**——三者各自直接调本地 store，`<SaveToHub>` 不是前两者的内部实现：

| 动作 | 落库 | store API（已存在） | 适用对象 |
| --- | --- | --- | --- |
| **订阅** | `subscriptions` | `addSubscription` | 发布者 / 实体 / 搜索 / peer |
| **收藏** | `bookmarks`（可选文件夹） | `addBookmark` | 文章 / 事件 / 链接 / 导航站 / coverage 组 |
| **钉住** | `subscriptions type:"tool"` | `addSubscription` | 工具卡 |
| **问助手** | 把对象 title+url 作为上下文塞进 `?ask=` 召唤 `/home/agent` | 复用 agent | 文章 / 事件 / 实体 / 分析图 / tool query |

所有写入复用现有 stores（`addSubscription` / `addBookmark`），不新增 server 依赖；成功后均 `notifyHubUpdated()` 广播 `HUB_UPDATED`，共享同一套墨色回流余晖动效（`animate-flowback`，§6）。`SubscribeButton` / `PinToolButton` 维持现签名与独立实现不变（避免改既有调用点）。

### 4.1 info · 资讯（蓝 spoke，唯一消费 super/server）

**框架**：列表左 **spoke-info 蓝** accent rail；顶部「知识图谱来自 super 共享节点 · 联网」状态芯片（区分「联网才有」与 hub「本地恒在」）；右上「↩ 回流去向：我的空间 · 已回流 N」。

**新增 item 级回流（填补 brief 点名的最大缺口——文章/事件/分析图无法回流）：**

- **列表/事件行**：复活 `info/columns.tsx` 那个 every-item-disabled 的 actions dropdown（确认存在、带 TODO，正好是空位），接 `<SaveToHub>` 菜单：① **收藏文章到书签**（选文件夹）→ `addBookmark`；② **订阅发布者** → `addSubscription`；③ **发送到 AI 助手**「让我的中枢总结这个事件」→ `?ask=`。
- **`/info/search`**：保留「订阅此搜索」，每行加「收藏到书签」。
- **实体页 / 发布者页**：保留订阅，新增「收藏此实体的报道集」「发送到 agent 总结」。
- **`/info/analysis`「全面报道」+ G6 知识图谱**（全应用最 Wisdom 级产物，今天零回流）：加「**保存这组报道**」（bulk bookmark 进自动命名文件夹）+「**让 AI 总结这个事件**」（把 coverage 内容喂给 home agent，一句话综述、可一键存为资源）。**这是 Wisdom 接到脊柱的高光。**
- **修死筛选**：`/info` 的 disabled 新闻 toggle / 时间段 Select、`list.tsx` 热度 tab——要么实现要么移除，去掉「未完成」观感。

### 4.2 community · 社区（绿 spoke）

**框架**：spoke-community 绿 accent；顶部分段 `地图 · 社区发布者`。

- **地图回流**（今天地图只是路由跳转，非回流）：点地图点 → popover 直接「**订阅此发布者**」+「收藏此城市的发布者集为搜索订阅」，无需再跳目标页点订阅。
- **peer 卡升级**：加 avatar（需 `avatar` 原语）+ 最近 3 条发布预览（订阅前先看 `/peer/{id}/publications` 摘要）+「订阅 peer」「将其最新发布收藏到书签」「让助手对比这几位发布者」。
- **文库 / 分享（已移出本次范围）**：原 PLANNED 的 `/community/library`、`/community/shared` 占位路由不做；community 回流暂以「订阅 peer」为唯一路径。content-carrying 回流（文库 item 直接落成 home resource/bookmark）、hub→community 出向分享等语义，待后续单独立项再议，不在本次重设计内立占位。

### 4.3 tool · 工具（紫 spoke）

**框架**：spoke-tool 紫 accent；取消双层 pill → 页内 segmented；**12 色 rainbow 收敛为 `--spoke-tool` 紫色调 token**（暗色上线硬前置）。

- **搜索/AI 输入框旁双动作**：「在外部引擎打开」+「**存为搜索订阅 / 发送到我的 AI 助手**」——把今天只活在 `/info/search` 的搜索订阅、和被无视的 `/home/agent` 接进来。**修复 `/tool/ai` 的讽刺缺口**（深链外部助手却看不见本地 home agent）：每个 AI 卡加「改用我的中枢助手处理」。
- **「最近搜索」历史**（本地优先，今天困在 tool）：每条加「存为搜索订阅 / 存为书签」，提升进 hub。补 `/tool/ai` 的 `historyKey`（现无，与 search 不对称）。
- **导航站卡**：`PinToolButton` 之外加「收藏为书签（选文件夹）」——不再只能 pin 成 dumb launcher。

---

## 5. 视觉设计系统 (Visual Design System)

身份（**定稿 = Ink 纯墨灰 monochrome**，已落地 `globals.css`）：**整体黑白灰，无彩色品牌色**。`--primary` 与 `--pop` 皆为墨色，关键动作（收入中枢 / 回流）靠「墨色填充 + 字重」突出，**不靠彩色**。三 spoke 色（资讯蓝 / 社区绿 / 工具紫）**仅作小圆点 / 卡顶边 / spoke rail 的功能归类**，绝不大面积 fill。`--pop == --flowback ==` 关键动作 / 回流语义色（= 墨）。

> 注：本节早期稿采用「暖纸墨 + ember-amber」方案（见顶部 ⚑ banner），经效果图多轮比选后**整体改为 Ink 纯墨灰**。下文 token 以 `globals.css` `:root` / `.dark` 真实块为准。

### 5.1 Token（`globals.css` 真实块，**已落地**；Ink 纯墨灰，无 ember）

> 真相源为 `src/app/globals.css`（HSL 三元组，无 `--chart-*` 系列——当前未声明 chart token）。下方与文件逐字一致。

```css
:root {
  --radius: 0.625rem;
  --background: 210 20% 99%;
  --foreground: 215 28% 15%;
  --card: 0 0% 100%;
  --card-foreground: 215 28% 15%;
  --popover: 0 0% 100%;
  --popover-foreground: 215 28% 15%;
  --primary: 215 28% 18%;            /* 墨 — 主动作填充 (非彩色) */
  --primary-foreground: 210 20% 99%;
  --secondary: 210 16% 96%;
  --secondary-foreground: 215 28% 15%;
  --muted: 210 16% 96%;
  --muted-foreground: 215 12% 45%;
  --accent: 212 18% 93%;
  --accent-foreground: 215 28% 20%;
  --destructive: 4 72% 52%;
  --destructive-foreground: 210 20% 99%;
  --border: 212 16% 90%;
  --input: 212 16% 90%;
  --ring: 215 28% 18%;
  /* 关键动作 / 回流 语义色 (墨) + 其前景 — myos 独有 token */
  --pop: 215 18% 28%;
  --pop-foreground: 0 0% 100%;
  --flowback: 215 18% 28%;
  /* spoke 分类色 — 仅小色块 (圆点/顶边/rail), 绝不做 fill */
  --spoke-info: 224 68% 58%;         /* 蓝 — 外部知识图谱 */
  --spoke-community: 150 46% 42%;    /* 绿 — 地图/他人 */
  --spoke-tool: 270 50% 60%;         /* 紫 — 外部能力 */
}

.dark {
  --background: 215 24% 8%;
  --foreground: 210 16% 92%;
  --card: 215 20% 11%;
  --card-foreground: 210 16% 92%;
  --popover: 215 20% 11%;
  --popover-foreground: 210 16% 92%;
  --primary: 210 16% 92%;            /* 暗色下主动作翻为亮墨 */
  --primary-foreground: 215 28% 12%;
  --secondary: 215 14% 17%;
  --secondary-foreground: 210 16% 92%;
  --muted: 215 14% 16%;
  --muted-foreground: 210 12% 64%;
  --accent: 215 16% 20%;
  --accent-foreground: 210 16% 92%;
  --destructive: 4 60% 48%;
  --destructive-foreground: 210 16% 92%;
  --border: 215 12% 21%;
  --input: 215 12% 21%;
  --ring: 210 16% 92%;
  --pop: 210 12% 84%;
  --pop-foreground: 215 28% 12%;
  --flowback: 210 12% 84%;
  --spoke-info: 224 62% 66%;  --spoke-community: 150 46% 52%;  --spoke-tool: 270 52% 70%;
}
```

### 5.2 `@theme inline` 注册（`globals.css` 顶部 `@theme inline {...}` 块内，**已落地**）

```css
  /* 单色墨灰: --pop = 关键动作填充色 (墨); spoke-* 仅做分类圆点/顶边/rail, 永不做大面积 fill */
  --color-pop: hsl(var(--pop));
  --color-pop-foreground: hsl(var(--pop-foreground));
  --color-flowback: hsl(var(--flowback));
  --color-spoke-info: hsl(var(--spoke-info));
  --color-spoke-community: hsl(var(--spoke-community));
  --color-spoke-tool: hsl(var(--spoke-tool));

  /* 字体: 系统 sans 栈 (含 PingFang SC CJK) + 等宽栈 (标识符)。无 --font-display, 不用 next/font */
  --font-sans: system-ui, -apple-system, ..., "PingFang SC", ..., sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", "Menlo", ..., monospace;

  /* 回流「收入中枢」成功时的余晖脉冲 (motion-reduce 下由组件守卫) */
  --animate-flowback: flowback-settle 0.5s cubic-bezier(0.22, 1, 0.36, 1);

  @keyframes flowback-settle {
    0%   { box-shadow: 0 0 0 0 hsl(var(--flowback) / 0.5); transform: scale(1); }
    45%  { transform: scale(1.06); }
    100% { box-shadow: 0 0 0 14px hsl(var(--flowback) / 0); transform: scale(1); }
  }
```

→ 产出工具类 `bg-pop`、`text-pop`、`bg-flowback`、`border-spoke-info`、`text-spoke-community`、`font-mono`、`animate-flowback`。**无 `font-display` 工具类**（已弃用）；`--font-sans` / `--font-mono` 为静态系统字体栈（直接写在 `globals.css`），不经 `next/font` 注入。

### 5.3 排版（typography scale & 字体）

- **正文**：现有 system-ui-led + PingFang SC CJK 栈（`--font-sans`，CJK 渲染正确）——**不动**。
- **无独立 display 字体**：H1 / 品牌 / 数字仍用 `--font-sans`，靠字号 + 字重 + `tracking-tight` 区分（`--font-display` 方案已弃用，全 src 零引用）。数字工程感用 `tabular-nums`（Tailwind `tabular-nums` 工具类，非自定义字体特性）。
- **`--font-mono`**（系统等宽栈，写死在 `globals.css`，非 `next/font`）：**同步码 / storageId / domain / peer id / hash**——给 local-first/P2P 标识符「终端」质感。
- **真实尺度**（从今天两档 2xl/sm 收紧）：

| 角色 | class |
| --- | --- |
| hub H1 | `text-3xl font-semibold tracking-tight`（用 `--font-sans`，无 display 字体） |
| section | `text-lg` |
| card title | `text-base font-semibold`（**从 `text-2xl` 收紧**） |
| body | `text-sm` |
| meta / mono | `text-xs font-mono` |

### 5.4 半径 / 密度 / elevation / 动效

- **半径**：`0.625rem`（10px）；mono/code chip 用 `rounded-sm` 做战术对比。
- **密度**（向「control terminal」）：card padding `p-6 → p-5`；表头 `h-12 → h-10`；表体 `p-4 → p-3`。
- **elevation**：卡用极轻阴影 `shadow-sm` + `border`；hub 卡叠加 2px 墨色左轨（`border-l-2 border-pop` 或 `border-primary`，均为墨）；spoke 卡叠加 2px spoke-hue 顶边（`border-t-2 border-spoke-*`）；弹层（popover/dialog）`shadow-md`。避免重投影，保持克制。
- **动效**：在 `tailwindcss-animate` 之上加 `flowback-settle`（§5.2），全部 `motion-reduce:` 守卫。

### 5.5 暗色切换（**自写轻量方案，不依赖 `next-themes`**；已落地）

沙箱内 npm registry 不可达，故**不引入 `next-themes`**，改用自写控制器：

- **`src/components/lib/theme.ts`**：`ThemeChoice = "light" | "dark" | "system"`，选择存 `localStorage("wonita-theme")`（`THEME_KEY`）；`applyTheme` / `setThemeChoice` / `getThemeChoice` 切 `<html>` 的 `.dark` 类；`updateFavicon` 让 tab favicon 跟随手动主题（用 `lib/brand.ts` 的 `BRAND_INK` + `WONITA_PATH`）。
- **`THEME_INIT` 内联脚本**：`layout.tsx` 在 `<body>` 顶部 `<script dangerouslySetInnerHTML>` 同步注入，首帧前打 `.dark` 类，**无闪烁**。
- **`src/app/shell/theme-applier.tsx`（`<ThemeApplier/>`）**：水合后兜底重新断言主题（防根树重渲染抹掉 `.dark`）。
- **`src/app/shell/theme-toggle.tsx`（`<ThemeToggle/>`）**：header 内 Sun/Moon 切换，调 `setThemeChoice`。
- `<html lang="zh-CN" suppressHydrationWarning>` 已在 `layout.tsx`。
- **硬前置**：tool 二级 pill 套娃已收敛为页内 segmented control（`tool/layout.tsx`，muted 底单行分段），无 12 色 rainbow 残留；全局色全走 token（`bg-pop` / `text-spoke-*` 等），暗色自动翻转。

### 5.6 图标 / hub-vs-spoke 视觉语言

- hub = 墨色，icon `Hexagon`/`◆` 品牌字形 + `HardDrive`/lock（所有权）。spoke 各持一色一图标：资讯 `Newspaper`(蓝)、社区 `Map`(绿)、工具 `Wrench`(紫)，全局一致（header dot / spoke rail / dashboard / live peek 卡同一 hue）。回流成功 = `Check` 套墨色 `flowback-settle` 余晖脉冲（非彩色 ring）。
- **lucide-react 为 v1.8.0**（非 0.x，见 `package.json`），实现时按该版本图标导出名核对（已在用：`Hexagon`、`HardDrive`、`Newspaper`、`Map`、`Wrench`、`Search`、`Bookmark`、`Lock`、`Eye`、`Plus`、`Check`、`Pin` 等）。

| | HUB (home) | SPOKE (info/community/tool) |
| --- | --- | --- |
| 框架 | 墨色 2px 左轨（`border-pop`）+ 卡 | spoke-hue 2px 顶边 + 较轻卡 |
| 主色 | 墨 `--primary` / `--pop` | spoke hue（仅 rail/dot/icon，不 fill） |
| 芯片 | `本地 · 此设备 🔒`（墨，恒在） | `联网 · 来自 super/外部`（muted，联网才有） |
| 权重 | 最重（H1 字号+字重，粗计数） | 次级（较轻标题） |
| 回流控件 | （目的地，最近回流时间线） | 每个 item 一枚墨色 `<SaveToHub>` |

### 5.7 品牌（已落地 dark-safe）

品牌字形已改为 **dark-safe 内联 SVG**：`src/components/wonita-mark.tsx`（`<WonitaMark/>`）内联 `<svg fill="currentColor">` + `src/components/lib/brand.ts` 的 `WONITA_PATH`，跟随文字色，暗色不消失（不用 `<img src="/wonita.svg">`——`<img>` 取不到 CSS `currentColor`）。favicon 由 `lib/theme.ts` 的 `updateFavicon` 用 `BRAND_INK`（`{ light: "#1b222e", dark: "#e8ecf2" }`）按手动主题动态生成，`public/icon.svg` 用 `prefers-color-scheme` 处理首帧。wordmark 用 `--font-sans`（无 display 字体）。tagline「链接我你TA / 想你所想」可在 dashboard 首屏露出。
**`components.json` `baseColor` 已是 `neutral`（非 slate）——此项已完成，无需再改。**

---

## 6. 标志性交互 (Signature interactions)

### 6.1 「收入中枢」飞回家微动效（核心招牌，progressive enhancement）

回流从「toast-only」升级为**看得见的「到家」动作**。**分级实现，下限永远可用**：

1. **基线（永远工作，motion-reduce 安全）**：点 `<SaveToHub>` → 源控件 `animate-flowback`（墨色 box-shadow 余晖脉冲 + 0.5s settle，`cubic-bezier(0.22,1,0.36,1)`，色用 `--flowback`），icon `Plus → Check`；`<HubNavLink>`「我的空间」计数 badge 经 `HUB_UPDATED` 事件 **count-up +1**，闪一下；toast 降为次要。
2. **增强（progressive enhancement，可降级）**：一枚墨色小菱形粒子从按钮位置经 `getBoundingClientRect` 计算轨迹，**飞向 header「我的空间」**锚点（一次性 CSS transform 元素，portal，无需动画库）。
3. **落点**：dashboard「最近回流」时间线实时插入一行（`wonita:hub-updated` = `lib/flowback.ts` 的 `HUB_UPDATED` 事件驱动）——**回流闭环肉眼可见**。
4. `motion-reduce:` → 退化为纯 `Check` 切换 + toast，不飞行。

> 风险控制（三位评委一致）：**header count-up + 源 pulse 先上线（始终可用）**，跨组件飞行粒子作为 progressive enhancement，避免不同布局下抖动。

### 6.2 ⌘K 中枢命令台（记忆点之一）

`<CommandPalette>`（`src/app/shell/command-palette.tsx`，**取代设想中的 `search.tsx`**）→ shadcn `Command`（cmdk 已装，包装在 `src/components/ui/command.tsx`）。统一入口：跳 spoke / 过滤 `/info` 标题 / 把当前页「焦点对象」（一篇 info、一个实体、一组 coverage、一条 tool query）作为上下文交给 home agent / 新建书签。对「总控终端」，随手可唤的命令台是定义性体验。

### 6.3 透明工具调用「落库」chip（嫁接方向 B 的灵魂，记忆点之二）

home agent 每次调用本地工具，对话内联一枚 chip：图标 + summary + **`✓ 已写入本机` / `🔒 仅读取`** 角标 + `撤销`/`查看` 链接。复用现有 `chat-message.tsx` 的 tool-event chip 渲染，只升级标注与可操作性。把 local-first 的「所有权 + 隐私」变成每次操作旁边的具体语言，而非 prose。**destructive 工具（delete/remove）强制 `撤销` + 二次确认**——把「可解释/可撤销」做实，反成 local-first 信任卖点。（agent 仍是 dashboard 上的增强层，**不是产品脊柱**。）

---

## 7. 组件清单变化 (Component inventory)

### 7.1 改动的既有组件

| 文件 | 改动 |
| --- | --- |
| `src/app/layout.tsx` | `THEME_INIT` 内联脚本 + `<ThemeApplier/>` + `<html lang="zh-CN" suppressHydrationWarning>`；字体走 `globals.css` 字体栈（**无 `next/font`、无 `<ThemeProvider>`**） |
| `src/app/shell/header.tsx` | 重写：`nav-config` 单一真相源、hub-primary、`<CommandPalette/>` ⌘K、`<LocalDeviceChip/>`、`<ThemeToggle/>`、`<HubNavLink/>` 回流计数 badge |
| `src/app/shell/command-palette.tsx` | 死 input → ⌘K CommandPalette（**取代不存在的 `search.tsx`**） |
| `src/app/page.tsx` | throwaway 卡 → `<HubDashboard/>` |
| `src/app/not-found.tsx` / `account-menu.tsx` | 默认目标 `/` → `/home` |
| `src/app/globals.css` | Ink 墨灰 token（§5.1/5.2）、`--pop`/`--flowback`/`--spoke-*`、`flowback-settle`、`@theme inline` 注册 |
| `src/app/home/page.tsx` | 已渲染 `<HubDashboard/>`（无 redirect）★ |
| `src/app/home/layout.tsx` / `home-nav.tsx` | 墨色框架（`bg-pop/10` + `border-pop` 左轨）、概览入口、同步状态行、usage bar `bg-primary` |
| `src/components/feeders/subscribe-button.tsx` / `pin-tool-button.tsx` | 保持独立开关组件（**未转调 `<SaveToHub>`**；`<SaveToHub>` 是 info 列表等处另用的回流原语，三者并存） |
| `src/components/plugins/agent/views/chat-message.tsx` | tool chip 已为「已写入本机」(`Lock`，`bg-pop/10 text-pop`)/「仅读取」(`Eye`，muted) 角标 |
| `src/app/home/subscriptions/*` | 同步码 mono 化；空态各页内联（未接 `<EmptyState>`） |
| `src/app/(discover)/layout.tsx` / `discover-nav.tsx` | 顶部分区导航（muted 底单行分段）；spoke-hue dot / 回流去向锚点为后续规划 |
| `src/app/(discover)/tool/layout.tsx` | 已收敛为页内 segmented control（`usePathname` + muted 底单行，取消二级 pill 套娃） |
| `src/components/apps/info/columns.tsx` / `cells.tsx` / `analysis/*` | `columns.tsx` 已接 `<SaveToHub>`（收藏/订阅）；analysis/coverage/G6 回流为后续 |
| `src/app/(discover)/community/*` | 地图 popover 就地订阅、peer 卡增强（部分后续） |
| `src/app/(discover)/tool/search/ai/navigation/*` | 结果回流、ai `historyKey`（部分后续）；无 12 色 rainbow 残留 |
| `components.json` | `baseColor` **已是 `neutral`**（非 slate），此项已完成 |

### 7.2 净新增组件（名 / 路径 / 状态）

**已交付：**

| 组件 | 路径 | 作用 |
| --- | --- | --- |
| `<HubDashboard>` | `src/app/home/hub-dashboard.tsx` | 中枢仪表盘本体（/ 与 /home 共用） |
| `<RecentFlowback>` | `src/app/home/recent-flowback.tsx` | 「最近回流」跨 store merge-sort 时间线 ★ |
| `<HubStatTiles>` | `src/app/home/hub-stat-tiles.tsx` | 所有权一览 |
| `<SaveToHub>` | `src/components/feeders/save-to-hub.tsx` | 统一回流原语（按 bookmark/publisher 分派，见 §4.0） |
| `lib/flowback.ts` | `src/app/home/lib/flowback.ts` | `HUB_UPDATED` 进程内事件 + `notifyHubUpdated()` 计数广播（取代规划中的 `flowback-anim.tsx`） |
| `<LocalDeviceChip>` | `src/app/shell/local-device-chip.tsx` | 本地·此设备所有权药丸（全局 chrome） |
| `<CommandPalette>` | `src/app/shell/command-palette.tsx` | ⌘K 命令台 |
| `<ThemeToggle>` | `src/app/shell/theme-toggle.tsx` | Sun/Moon 切换（自写主题方案） |
| `<ThemeApplier>` | `src/app/shell/theme-applier.tsx` | 水合后兜底重断言主题 |
| `<HubNavLink>` | `src/app/shell/hub-nav-link.tsx` | 「我的空间」主项 + 回流计数 badge（`HUB_UPDATED` 驱动） |
| `<MobileNav>` | `src/app/shell/mobile-nav.tsx` | 移动 Sheet（由 `nav-config` 驱动） |
| `<WonitaMark>` | `src/components/wonita-mark.tsx` | 品牌字形内联 SVG（`currentColor`，dark-safe） |
| `nav-config` | `src/app/nav/nav-config.ts` | 单一 nav 真相源（桌面 + 移动），导出 `SPOKES` 等 |

**未实现（规划）：**

| 组件 | 计划路径 | 现状 |
| --- | --- | --- |
| `<LiveSpokePeek>` | `src/app/home/live-spoke-peek.tsx` | 未拆出独立组件；dashboard live 区为后续 |
| `<HubComposer>` | `src/app/home/hub-composer.tsx` | 未拆出独立组件；内联 agent composer 为后续 |
| `<SpokeFrame>` | `src/components/spoke-frame.tsx` | 未实现；spoke 页统一框架（顶边 hue + 回流去向锚点 + 联网芯片）为后续 |
| `<EmptyState>` | （已删除） | 原计划的统一空态原语，从未接线（全树无 import）；本次整理已移除 `src/components/empty-state.tsx`，空态目前各页内联。待真正做空态统一时再按需重建 |

### 7.3 需新增的 shadcn 原语

`command`（**已包装** `src/components/ui/command.tsx`，cmdk 已装）。仍缺组件包装：`avatar`（peer 卡，`@radix-ui/react-avatar` 已在 deps）、`skeleton`（dashboard live 区骨架）、`separator`（`@radix-ui/react-separator` 已在 deps，缺组件）、`scroll-area`（时间线滚动，可选）。**无新增 npm 依赖**——暗色用自写 `lib/theme.ts`，**不引入 `next-themes`**（沙箱内 registry 不可达）。

### 7.4 新增 agent 工具（Phase 4，闭合「读 spoke → 整理 → 回流/发布」一个 turn）

`agent-tools.ts` 现已具备一组本地工具：书签 `list_bookmarks`/`add_bookmark`/`update_bookmark`/`delete_bookmark`/`create_bookmark_folder`、订阅 `list_subscriptions`/`add_search_subscription`/`remove_subscription`、资源 `list_resources`/`update_resource` 等（`executeTool` switch）。后续可补：`add_subscription`（泛化非 search 订阅）、`read_subscription_feed`（让 agent 读「今天新了什么」）、`save_resource`、`read_resource_text`（预览已能切 200KB）、`list_publications`/`publish`（包 `peer-action`）。照搬现有 `executeTool` switch 模式，destructive 走撤销/确认。

---

## 8. 分阶段实施计划 (Phased plan)

> 排序原则：**hub-and-spoke + local-first 故事尽早落地**。Phase 0–2 即让「中枢首屏 + 可见回流 + 暖色身份」站住；后续是覆盖面与打磨。

### Phase 0 — 主题与身份地基（effort S，risk 低）【已落地】
- `globals.css` Ink 墨灰 token（§5.1/5.2）+ `--pop`/`--flowback`/`--spoke-*` + `flowback-settle`。
- 自写暗色：`lib/theme.ts`（`THEME_INIT` 内联脚本 + `setThemeChoice`/`applyTheme`）；`layout.tsx` 注入脚本 + `<ThemeApplier/>` + `<html lang="zh-CN" suppressHydrationWarning>`。**不装 `next-themes`、不用 `next/font`**。
- header 加 `<ThemeToggle>`；`components.json` `baseColor` 已是 `neutral`。
- **硬前置清理**：tool 二级 pill 套娃 → 页内 segmented；全局色走 token（无 12 色 rainbow 残留）。
- 触及：`globals.css`、`lib/theme.ts`、`layout.tsx`、`theme-applier.tsx`、`theme-toggle.tsx`、`header.tsx`、`tool/layout.tsx`。
- **产出**：全应用 Ink 墨灰身份落地，暗色可切（自写无闪烁）。

### Phase 1 — 中枢首屏（dashboard 脊柱）（effort M，risk 中）
- `<HubDashboard>` + `<HubStatTiles>` + `<RecentFlowback>`（复用 home-nav 查询 + 跨 store merge-sort）。
- `/page.tsx` 与 `home/page.tsx` 共用 dashboard（取消 redirect）；404/退出 → `/home`。
- `<EmptyState>` + 空中枢 hub-spoke 迷你图；`home-nav` 加「概览」+ 同步行。
- 触及：`page.tsx`、`home/page.tsx`、`home/hub-dashboard.tsx`、`recent-flowback.tsx`、`hub-stat-tiles.tsx`、`home-nav.tsx`、`empty-state.tsx`。
- **风险**：`/`+`/home` 三态（离线/空/未登录）正确性——纯本地区先渲染兜底。
- **产出**：打开即见中枢 + 最近回流时间线——**brief 三大缺口的前两个当场闭合**。

### Phase 2 — 统一回流 + 飞回家 + header 重写（effort M，risk 中）
- `<SaveToHub>` 回流原语（按对象分派，与 subscribe/pin 并存而非内部转调）；回流计数走 `lib/flowback.ts` 的 `HUB_UPDATED` 事件（基线先上：`flowback-settle` 墨色 pulse + count-up；飞行粒子作 PE）。
- header 重写：单一 `nav-config`、hub-primary、`<LocalDeviceChip>`、`<HubNavLink>` 回流计数 badge。
- ⌘K `<CommandPalette>`（已包装 `command` 原语）。
- 触及：`save-to-hub.tsx`、`home/lib/flowback.ts`、`header.tsx`、`hub-nav-link.tsx`、`nav-config.ts`、`local-device-chip.tsx`、`command-palette.tsx`、`mobile-nav.tsx`、`subscribe-button.tsx`、`pin-tool-button.tsx`。
- **风险**：飞行粒子跨布局抖动——已 PE 降级兜住。
- **产出**：回流成第一类、可见、被庆祝；hub 视觉首位；本地·此设备贯穿全局；死搜索复活。

### Phase 3 — spoke item 级回流 + 框架（effort M，risk 中）【部分落地】
- `<SpokeFrame>`（顶边 hue + 回流去向锚点 + 联网芯片）铺三 spoke——**尚未实现**（规划）。
- info：`columns.tsx` 已接 `<SaveToHub>`（收藏/订阅，已落地）；analysis/coverage/G6 回流、修死筛选为后续。
- tool：segmented 化（已落地，`tool/layout.tsx`）；结果回流（存搜索/发助手）、ai `historyKey` 为后续。
- community：地图 popover 就地订阅；peer 卡 + avatar + 预览（部分后续）。
- 触及：`spoke-frame.tsx`（新，未建）、`(discover)/info/*`、`(discover)/tool/*`、`(discover)/community/*`、`discover-nav.tsx`、`tool/layout.tsx`。
- **产出**：每个 spoke item 都有「带回家」路径——**§0.4 设计法则逐项强制执行**，brief 最大缺口闭合。

### Phase 4 — dashboard 联网区 + agent 增强（effort M，risk 中）
- `<LiveSpokePeek>`（异步 + 骨架 + per-source 隔离）+ `<HubComposer>`（动态建议）——二者**尚未拆出独立组件**，为本阶段净新增。
- agent tool chip 已为「已写入本机」/「仅读取」角标；补 §7.4 列出的后续工具。
- 触及：`live-spoke-peek.tsx`（新）、`hub-composer.tsx`（新）、`chat-message.tsx`、`agent-tools.ts`、`agent-run.ts`。
- **风险**：首屏 N 并发 fetch——只取前 3–4 来源 + 异步带次。agent 未配 key → 退化「配置助手」引导（dashboard 不依赖 agent 也完整）。
- **产出**：脊柱接活内容流 + agent 成为可解释的增强层。

### Phase 5 — 打磨（effort M，risk 低）
- 文库/分享占位路由**不做**（已移出范围，见 §4.2）。
- 品牌 glyph two-tone dark-safe + wordmark + favicon；tagline 露出。
- 全局空态 → `<EmptyState>`；mono 标识符巡检；WCAG AA 复核（双主题）；mobile Sheet 由 nav-config 驱动收口。
- **产出**：打磨收口。

---

## 9. 未决策项 (Open decisions)

1. **hub 主色？** ~~ember-amber / teal-jade~~ **已定稿 = Ink 纯墨灰 monochrome**（见顶部 ⚑ banner 与 §5）：整体黑白灰，`--primary`/`--pop`/`--flowback` 皆为墨色，关键动作靠「墨色填充 + 字重」而非彩色；三 spoke 色仅作小圆点/顶边/rail。规避了 amber-on-warm-white 的小字对比度风险，墨色对比天然达 WCAG AA。已落地 `globals.css`，无需再选主色。

2. **`/` 与 `/home` 完全合一，还是 `/` 做「未登录/营销」轻着陆？** 本稿决定**完全合一**（同 `<HubDashboard>`，最强 hub 首位表达）。若产品需要一个面向新访客/未登录的差异化首屏（讲产品故事、引导注册），可让 `/` 在无 session 时渲染 onboarding 变体、有 session 渲染 dashboard。**确认是否需要营销态。**

3. **community 文库/分享**：~~本期范围~~ **已决定移出本次重设计**——`/community/library`、`/community/shared` 占位路由不做，community 回流暂以「订阅 peer」为唯一路径（见 §4.2）。文库/分享待后续单独立项再议。

4. **dashboard 是否默认内联 agent composer？** 本稿决定**内联但作为可降级增强**（未配 key → 退化为「配置助手」引导，dashboard 不依赖 agent）。若希望 dashboard 保持纯数据、不在首屏推 AI，可把 composer 收进 `/home/agent` 仅留入口。**确认 agent 在首屏的存在感强度。**

---

**一句话**：方向 A 的结构（中枢首屏 + 最近回流脊柱 + spoke 进料口）× **Ink 纯墨灰皮肤与所有权签名**（黑白灰 + 墨色填充关键动作 + 本地·此设备 + mono 标识符）× 方向 B 的透明落库 chip（`✓已写入本机/撤销`）= 一块你每天打开就看见、会因你的回流而生长、不可错认是 local-first 的活中枢；每次带东西回家，你都看见它落进时间线。~80% 复用既有本地数据与组件，net-new 主要在表达层，不破坏既有 BUILT 能力与 info→super/server 契约。

相关文件（绝对路径，供实现；仓库根为 `/home/lyping/jinziyou/wonita`）：
- token/动效/主题：`/home/lyping/jinziyou/wonita/peer/src/app/globals.css`、`/home/lyping/jinziyou/wonita/peer/src/components/lib/theme.ts`、`/home/lyping/jinziyou/wonita/peer/src/components/lib/brand.ts`
- 着陆/dashboard：`/home/lyping/jinziyou/wonita/peer/src/app/page.tsx`、`/home/lyping/jinziyou/wonita/peer/src/app/home/page.tsx`、`/home/lyping/jinziyou/wonita/peer/src/app/home/hub-dashboard.tsx`
- header/nav：`/home/lyping/jinziyou/wonita/peer/src/app/shell/header.tsx`、`/home/lyping/jinziyou/wonita/peer/src/app/shell/command-palette.tsx`、`/home/lyping/jinziyou/wonita/peer/src/app/shell/hub-nav-link.tsx`、`/home/lyping/jinziyou/wonita/peer/src/app/nav/nav-config.ts`、`/home/lyping/jinziyou/wonita/peer/src/app/home/home-nav.tsx`、`/home/lyping/jinziyou/wonita/peer/src/app/shell/discover-nav.tsx`、`/home/lyping/jinziyou/wonita/peer/src/app/(discover)/tool/layout.tsx`
- 回流：`/home/lyping/jinziyou/wonita/peer/src/components/feeders/save-to-hub.tsx`、`/home/lyping/jinziyou/wonita/peer/src/app/home/lib/flowback.ts`、`/home/lyping/jinziyou/wonita/peer/src/components/feeders/subscribe-button.tsx`、`/home/lyping/jinziyou/wonita/peer/src/components/feeders/pin-tool-button.tsx`、`/home/lyping/jinziyou/wonita/peer/src/components/apps/info/columns.tsx`
- agent：`/home/lyping/jinziyou/wonita/peer/src/components/plugins/agent/views/chat-message.tsx`、`/home/lyping/jinziyou/wonita/peer/src/components/plugins/agent/lib/agent-tools.ts`
- 布局/主题：`/home/lyping/jinziyou/wonita/peer/src/app/layout.tsx`、`/home/lyping/jinziyou/wonita/peer/src/app/shell/theme-applier.tsx`、`/home/lyping/jinziyou/wonita/peer/components.json`