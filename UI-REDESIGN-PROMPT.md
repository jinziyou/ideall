# ideall 全局 UI / 设计语言重构任务（交给在本仓库内运行的 Claude Code）

你是一名资深设计工程师，现在在 **ideall 本仓库内**直接操作真实代码（可 Read / Grep / Edit 真实文件，可运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`）。请对整个 ideall 应用做一次**全局 UI / 设计语言重构**，覆盖**所有模块**。这不是产出一次性 mockup —— 你修改的是仓库里真实可运行的源码。

但请注意：**第一步绝不是立刻动手改全站**。你必须先按下文「工作流程」给出 **2–3 个不同的视觉方向**，每个方向都做到可被真实看见，然后**停下来等用户拍板**，再分批落地。

---

## 一、任务目标

1. 提升 ideall 的整体视觉成熟度与一致性：终结全站「选中态/活动态 5+ 套手写实现」「重复卡片/空态/侧栏微模式」「品牌身份不一致」「两处图表硬编码彩色绕过 token」等问题（详见下方现状地图与 Top 8 机会）。
2. 强化设计语言的**意图性与辨识度**，去掉 near-stock shadcn 的模板感，但全部改动必须落在既有 **token 体系 + Tailwind theme + shadcn 原语**之内，不得引入并行 UI 库或硬编码颜色。
3. 重构是**纯表现层（presentational）**的：端口/契约/manifest/boot 架构与数据流保持不变，只改视觉与组件呈现。

---

## 二、产品与设计背景（先读，决定基调）

- **ideall = 开源、本地优先、供应商中立的个人信息工作台**。核心叙事：把分散的他人/信息/资源/工具聚合到 **home「中枢」**；info / community / tool 三个 spoke 模块都为 home 服务（hub-and-spoke）；来源经**订阅**回流（flowback）到「我的」；**本地优先**（IndexedDB，个人数据默认不上传）；**跨端同步的无账号同步码** 与 **公开发布的账号** 是两套独立身份。
- 现有视觉宪法叫 **Ink 单色系**：界面以墨灰为主，关键动作 = **墨色填充 + 字重**表达层级；彩色（spoke 三色：资讯蓝/社区绿/工具紫）**仅以小圆点 / 卡片顶边 / 边条 (rail) 出现，绝不大面积 fill**；数字用 `tabular-nums` + `font-mono` 取终端质感；暗色靠 token 自动适配。
- **供应商中立**是核心对外主张：视觉上**不要把品牌身份过度耦合到 "wonita"**（wonita 只是默认后端实现）。品牌应统一为 **ideall**。

你可以**质疑并改变**这套 Ink 宪法（方向 B/C 就是为此而设），但任何新方向都必须自洽，并满足下方硬约束。

---

## 三、现状 UI 地图（参考，仍需对照真实代码核验）

> 下面是对现有 UI 的忠实盘点。它是上下文，不是免核验的真相 —— 落地前请用 Read/Grep 对照实际文件（尤其 `src/app/globals.css` 的 token 值、各组件类名、`package.json` 脚本、`eslint.config.mjs`）确认一致。地图中的行号为约略定位，以实际文件为准。

<CURRENT_STATE_MAP>
# ideall 当前状态 UI 地图 (Current-State UI Map)

> 本文档是对 ideall 现有 UI 的忠实盘点，作为重设计的上下文参考。所有 token 值、类名、文件路径均来自实际代码（globals.css / 各组件），未虚构任何界面。

---

## 1. 设计系统现状 (Ink Design System)

ideall 的视觉宪法是 **Ink 单色系**：界面以墨灰为主色，**关键动作用墨色填充 + 字重表达层级**，**彩色仅以小圆点/边框/边条 (rails) 形式出现，绝不大面积 fill**。全部颜色经 `src/app/globals.css` 的 `@theme` + `:root` / `.dark` 两套 HSL CSS 变量定义，深浅色由 `.dark` token 覆盖集中切换，组件层几乎无 `dark:` 类。

**核心 token（语义化 CSS 变量，HSL）**
- `--foreground` light `215 28% 15%` / dark `210 16% 92%`；`--background`、`--card`、`--muted`、`--muted-foreground`、`--border`、`--input`、`--ring`、`--primary`、`--secondary`、`--accent`、`--destructive`、`--popover` 等成对定义于 `:root` / `.dark`。
- **`--pop`（墨色强调 / 回流语义色）**：Ink 体系唯一的「强调色」，用于关键动作填充、回流脉冲、进度条、活动态。注意 `--pop`(light `215 18% 28%`) 与 `--primary`(light `215 28% 18%`) **数值接近但并不相等**；当前主题下二者视觉都呈墨色，故许多 CTA 用 `variant=default`(`bg-primary`) 也能近似呈墨色——这是一处脆弱耦合（不应假设 `primary === pop`）。
- **spoke 三色** `--color-spoke-info`(蓝) / `--color-spoke-community`(绿) / `--color-spoke-tool`(紫)，**仅作 `h-2 w-2` 小圆点 / 卡片 `border-t-2` 顶边 / `border-l-2` 边条**，设计规则明令不得大面积 fill。

**排版 / 圆角 / 字体**
- `--font-sans` = system-ui 栈；`--font-mono` 刻意用于「本地优先 / 终端质感」：命令台 href、设备芯片字节数、`tabular-nums` 数字。
- 圆角 `--radius`（`0.625rem`）；shadcn new-york 风格 `rounded-md`，控件默认高 `h-10`（`h-9`/`h-8` 为次级）；层级用 `shadow-sm/md/lg`。
- body：`font-sans antialiased`，`bg-background/text-foreground` 经 `@layer base`。

**动画**
- `--flowback` 脉冲：`flowback-settle` keyframes = box-shadow 墨色环扩散 + scale `1→1.06→1`，~500ms，`motion-reduce:animate-none`（由组件守卫）。这是「收入中枢」的统一回流反馈动效。`--flowback` 当前与 `--pop` 同值。

**陈述的规则（设计宪法）**：① 单色优先；② 关键动作 = 墨色 (`--pop`) 填充 + `font-medium/semibold`，不靠彩色；③ spoke 色仅作小圆点/边框/边条；④ 数字用 `tabular-nums` + `font-mono` 取终端质感；⑤ 暗色靠 token 自动适配。

---

## 2. 全局壳 (shell)

`root-layout.tsx`：`<html lang=zh-CN suppressHydrationWarning>` → 无闪烁 `THEME_INIT` 内联脚本 → `ThemeApplier` → `Header` → `BootGate`（同步 `registerAll()` 注册各 manifest 后再渲染子树）→ sonner `Toaster`。无 body 级 max-width 容器，各 `<main>` 自定宽度。

- **Global Header**（`shell/header.tsx`）：sticky `top-0 z-50 h-16`，全宽仅 padding。顺序 = MobileNav(汉堡, md:hidden) → 品牌 `WonitaMark` + 「ideall」字标(sm+) → 桌面 `<nav>` 含 HubNavLink + 字面量「发现」分隔 span + SPOKES（带色点 pill）→ 右簇 `ml-auto`: CommandPalette / ThemeToggle / LocalDeviceChip(md+) / AccountMenu。纯 token，spoke 活动态在 header **完全不反映**。
- **HubNavLink**（`shell/hub-nav-link.tsx`）「我的」：活动态 = 内 span `border-b-2 border-pop` 墨色下划线；右上角徽标 = 订阅+书签+文件**合计一个数**（`h-[18px] min-w-[18px] text-[10px]` 任意值，`bg-pop` 墨填充 + `tabular-nums`），数值上升时 `animate-flowback` 脉冲。
- **DiscoverNav + 回流锚**（`shell/discover-layout.tsx` / `shell/discover-nav.tsx`，路由组 `app/(discover)/layout.tsx`）：左 = shadcn 分段控件（`bg-muted` 轨 + 活动 `bg-background shadow-sm` 滑块）三 spoke；右 = 「回流去向 · 我的」墨色微提示 pill（`bg-pop/[0.06]` 任意透明度 + `border-pop/25`），极淡。
- **MobileNav**（`shell/mobile-nav.tsx`）：左滑 Sheet `w-72 max-w-[85vw]`，三段（我的/系统服务/发现）裸 span 标题，活动态 = `bg-pop/10` 墨色 wash + `font-medium`；spoke 用色点、hub 用图标（混排）。
- **Command Palette ⌘K**（`shell/command-palette.tsx`）：触发器仿搜索框，宽度是 `sm:w-[240px] md:w-[150px] lg:w-[240px] xl:w-[300px]` **四断点任意像素阶梯**；`kbd` 芯片 `<lg` 隐藏。Dialog 三组：发现(spoke点+mono href)/我的/系统(混了导航与真命令，含重复跳转项)。
- **ThemeToggle**（`shell/theme-toggle.tsx`）：`outline icon` 按钮，Sun/Moon 经 `.dark` 变体纯 CSS 切换（无 React 态防闪），图标 `[1.15rem]` 任意值。**只能 light↔dark，无法回到 system**（`lib/theme.ts` 支持三态但无 UI）。favicon ink 色 `BRAND_INK {#1b222e,#e8ecf2}` 在 `brand.ts` 与 `app/icon.svg` **硬编码两处**，不随 `--foreground` 联动。
- **AccountMenu**（`shell/account-menu.tsx`）：`secondary rounded-full` CircleUser 头像，**登录前后图标完全相同**（不可一眼辨识）；`session.user.avatar` 存在却从不渲染。
- **LocalDeviceChip**（`shell/local-device-chip.tsx`）：Lock pill → `w-72` popover，本地优先所有权说明 + 三状态行（跨端同步 / 本地存储含 `h-1` 极细进度条 / 发布身份）+ 管理链接 + `text-[11px]` 脚注。**md 以下整体隐藏 + 内部「本机」标签 lg 以下隐藏 → 本地优先核心信息桌面独占，移动端完全看不到**。
- **Auth Form**（`auth/page.tsx` → `shell/auth-form.tsx`）：居中 `Card max-w-sm`，邮箱/密码（**仅 placeholder 无 Label**）+ 提交按钮，登录/注册切换是低对比 `text-xs` 文字按钮；错误仅 toast，无内联校验；页面 `min-h-[70vh]` 任意值、无品牌框架。
- **Error / Loading / NotFound**（`shell/*` + root re-export）：error/404 共用 `Card max-w-lg` 骨架（`text-destructive` 仅用于告警图标）；error 用 `window.location.assign('/')`、404 用 `<Link>`（**导航方式不一致**）；`⌘K` kbd 芯片在 not-found 与 command-palette **手写重复**；loading 是单一通用 spinner「正在读取本机数据…」。

---

## 3. home 中枢

`home/layout.tsx`：`<main m-2 sm:m-4>` + `max-w-screen-xl` + 固定 h1「我的」+ 副文 + `HomeNav` 侧栏 + `flex-1` 内容区。各 `page.tsx` 极薄（metadata + 渲染一个 client 组件）。**「数据只存本机」类本地优先标语在 layout 副文 / dashboard `· 都落在本机` / EmptyHub `数据只存本机` 三处近重复**。

- **HomeNav（左鸣）**（`home/home-nav.tsx`）：`md:w-56` 侧栏，桌面竖列 / 移动横向滚动条；条目带 icon + label + 实时本地计数徽标；活动态 = `bg-pop/10 + font-medium + md:border-l-2 border-pop`（含 `md:pl-[10px]` 魔法补偿）；底部「本地存储」卡（**桌面独占**，进度条 `bg-primary`）。计数仅随 `pathname` 变化刷新（与 dashboard 的 `onHubUpdated` 不同步）。
- **Hub Dashboard（已填充）**（`home/hub-dashboard.tsx` / `hub-stat-tiles.tsx` / `recent-flowback.tsx`）：顶部 `HubStatTiles` 五格（订阅/书签/资源/对话 + 本地存储，`rounded-xl border bg-card shadow-sm`，`text-2xl tabular-nums`，存储条 `bg-pop`）；下方 `lg:grid-cols-3`：(a)「最近回流」`border-l-2 border-l-pop` 时间线（按 今天/本周/更早 分组，点色按 spoke 或 `bg-pop`），(b)「去发现，带东西回家」三 spoke 链接卡，(c) 条件「已钉工具」chip 行（每个都是通用 `Wrench` 方块，无 favicon）。骨架态 = pulse 五格 + `h-64` 块。
- **EmptyHub（空态）**（`home/hub-dashboard.tsx`）：`min-h-[55dvh] border-dashed bg-card/50` 居中卡，迷你 hub-and-spoke 图（`我的` 节点 `bg-pop/5` + `回流` 连接器 + 三 spoke 卡）+ `⌘K` 提示（**硬编码 Mac glyph，Win/Linux Tauri 显示错误**）。
- **订阅流** `/home/subscriptions`：顶部满宽 `SyncPanel`（跨端同步大卡，来自 `components/plugins/sync`，喧宾夺主）+ 「已钉工具」pill 行 + 订阅卡网格（`Card border-t-2` spoke 顶边，每卡最多 5 条纯文本，无缩略/无更多）。
- **书签** `/home/bookmarks`：左收藏夹侧栏（移动横滚）+ 右搜索栏 + `BookmarkCard` 网格（favicon 方块 + `Globe` 兜底 + `MoreHorizontal` 菜单）；导入对话框用**原生 checkbox**。
- **资源/文件** `/home/resources`：顶部 4 个 `StatCard` + 虚线拖拽上传区 + 类型 tab（**手写 button 状态机**）+ 网格/列表双视图 + `FilePreviewDialog`（按 kind 渲染 img/video/pdf/text）。
- **发布** `/home/publications`：未登录 = 圆形 `bg-primary/10` Megaphone 空态；已登录 = 发布表单 Card（正文用**原生 textarea 手写复刻 shadcn 样式**）+ 「发布」列表（Card 标题与列表 h2 **文案完全重复**，列表项是 raw `border li` 非 Card）。
- **AI 助手** `/home/agent`：核心实现在 **`components/plugins/agent/views/agent-panel.tsx`**：左会话侧栏 + 右对话区（`ServiceHeader` + 消息滚动区**魔法高度 `h-[calc(100dvh-35rem)]` / `md:h-[calc(100dvh-19rem)]`**）；用户气泡 `bg-primary` 实心、助手气泡 `border bg-card`；工具事件 badge（write=`bg-pop/10`、delete=`bg-destructive/10`、read=`bg-muted`）；智能体模式是**手写 pill 开关**；设置对话框「本机数据作上下文」用**原生 checkbox**。

---

## 4. info / community / tool

### info（资讯 spoke，蓝）
统一表格层 `info/table.tsx` 的 `DataTable` 驱动**全部列表**（首页三视图/实体/发布者/搜索），内置 loading/error/暂无三态，响应式靠 `info/columns.tsx` 的 `HIDE_SM/MD/LG/XL` meta **在断点砍列**（窄屏信息损失大，无卡片/流式替代）。共享单元格 `info/cells.tsx`（Title/Entity/PublisherHover/Time）跨列定义复用。

- **Info Feed `/info`**：AppHeader + HotEntities（`secondary` Badge 行，loading/空时整块 `return null` → 首屏 CLS）+ InfoList（一行挤 Tabs[热点/发布者/最新]+时间段 Select+「查看全部」+ DataTable）。
- **Search `/info/search`**：整页一张 Card，6+ 控件工具栏（**客户端标题过滤 vs 服务端查询语义混在一行无区分**），paginated DataTable；Calendar 渲染**双份** DOM。
- **Entity `/info/entity`**：Card + 统计盒（`WeeklyTrend` 手写 `div` 墨色条形图，token 合规但**无轴/移动端无 hover 读不出**）+ CoEntities Badge + DataTable。
- **Publisher `/info/publisher`**：最薄一页，仅标题（只显 domain，未用 name）+ DataTable，无画像。
- **Analysis / 全面报道 `/info/analysis`**：左「这篇报道」Card + 右「全面报道」Card（Tabs[来源列表/关系图谱]）。**知识图谱 `info/analysis/graph.tsx` 是全模块最大破口**：G6（@antv/g6）力导向图用整套**硬编码 hex 9 色调色板**（`#ef4444/#3b82f6/#f59e0b/#10b981/#8b5cf6/#06b6d4/#ec4899/#eab308/#94a3b8`）做节点大面积 fill + 图例 + 标签 `#1f2937`/`#475569` + 边 `#cbd5e1` + 标签底 `#fff`，**完全脱离 token，无暗色适配，直接违反「spoke 色永不大面积 fill」宪法**；画布高度 `h-[400px] sm:h-[520px] lg:h-[600px]` 任意值。`info/analysis/basic.tsx` 用 Button 渲染实体，与全站 Badge 体系不一致。

### community（社区 spoke，绿）
单列双卡堆叠（`community/page.tsx`）：AppHeader + 「发布者地图」Card + 「社区发布者」Card。

- **PublisherMap**（`community/publisher-map.tsx`）：echarts（v6）china 底图 + effectScatter 涟漪散点（点大小=条数），点击跳 `/info/publisher`。**echarts 全套颜色硬编码**：底图 `#f1f5f9/#cbd5e1/#e2e8f0`、散点 + 阴影 `#3b82f6`、tooltip 链接 `#3b82f6`——**绕过 token，暗色下不切换（浅灰底蓝点），且社区模块却用了 spoke-info 蓝（非应有的绿），大面积涟漪 fill 违反 Ink**。城市名沿用英文专名，`w-[200px]` 任意值。
- **PeerPublishers**（`community/peer-publishers.tsx`）：四态（error/loading/empty/data），数据态 = `rounded-lg border p-2.5` 行卡网格，每行通用 `Users` 图标（无头像，辨识度低）+ name + 条数 + SubscribeButton（订阅成功 `animate-flowback`，合规）。

### tool（工具 spoke，紫）
薄壳路由 + tab 外壳（`tool/layout.tsx`）：AppHeader + 三子页 tab（搜索/AI/导航，活动态 = `border-b-2 border-foreground` 下划线）。**全集群零 token 违规**（首字母方块已主动从彩色改为中性 `bg-muted`，有源码注释）。

- **QuickJump（search/ai 共享）**：搜索行 + 「全部打开」（~12 标签易触发弹窗拦截）+ provider 卡网格（首字母中性方块 + `PinToolButton` 角标）；search 有 localStorage 历史，ai 无（行为不一致）。
- **Navigation `/tool/navigation`**：用 shadcn `Card`（与 QuickJump 裸 button 卡**两套实现**）罗列 4 类 24 站，纯文字无 favicon。
- **`/tool` 索引**：纯 `redirect("/tool/search")`。

> **三 app 共性**：几乎所有跨页跳转用 `window.open(_blank)`（**Tauri App 形态下新窗口体验割裂**，全模块一致反模式）；provider/站点数据全硬编码常量数组，无本地配置层（与 local-first 定位张力）。

---

## 5. 共享原语

**`src/components/ui`（shadcn 原语，near-stock new-york）**：button / badge / card / dialog / dropdown-menu / input / textarea / label / select / tabs / table / sheet / command(cmdk) / popover / hover-card / calendar(react-day-picker v9.14) / sonner（分页三件套实为 `shared/data-table-pagination.tsx`）。**缺口**：无 alert-dialog（→ 自建 ConfirmDialog）、无 tooltip（→ 原生 `title=`）、无 checkbox/switch/radio/avatar/skeleton/scroll-area/accordion（注：`@radix-ui/react-avatar`/`react-separator` 已在依赖但未建原语）。本地定制：sonner `top-right + richColors + closeButton`；dialog 加 `hideClose` + dvh 移动尺寸 + 中文「关闭」；command 中文默认；calendar 迁 v9。

- **Button / Badge 无 `--pop` 变体**：尽管 `--pop` 是文档化的关键动作 token，原语层无 pop/spoke variant，feeders 只能用 `variant=default` 靠 `primary≈pop` 巧合达成墨色。`CardTitle` 默认 `text-2xl` 偏重，几乎每处都要 override。
- **AppHeader**（`shared/app-header.tsx`）：spoke 色点（`h-2 w-2`，dotClass 静态字面量）+ 标题 + 回流描述；`dotClass:string` 未类型化（应为 `'info'|'community'|'tool'` 联合）。
- **ServiceHeader**（`shared/service-header.tsx`）：方图标位 + 「系统服务」outline Badge + 状态点（ok=`bg-pop` / warn=`bg-destructive/70` / off=`bg-muted-foreground/40`）；`text-[10px]` 任意值，badge 文案硬编码。
- **WonitaMark**（`shared/wonita-mark.tsx`）：`fill=currentColor` 内联 SVG（暗色安全），但 **aria-label 仍是「Wonita」、产品却叫「ideall」——品牌身份不一致**。
- **prompt-dialog**（`shared/prompt-dialog.tsx`）：ConfirmDialog + TextPromptDialog 替代 native confirm/prompt（两份近重复 Dialog 壳，ConfirmDialog 无 async/loading 态）。
- **DataTablePagination**（`shared/data-table-pagination.tsx`）：完整响应式（`flex-col` 移动堆叠、aria-label 齐全）；`w-[70px]` + 硬编码页大小选项。
- **feeders（回流原语，`components/feeders/*`）**：`SubscribeButton`（订阅）/ `PinToolButton`（钉工具，**手写 raw `<button>` 非 Button 原语，缺 focus ring**）/ `SaveToHub`（下拉「收入我的」）/ `flowbackToast`（统一回执「已回流到「我的」· 只存本机」+「查看」深链）。三者**共享逻辑全靠 copy-paste**：null-until-loaded 禁用、~500ms `animate-flowback` 脉冲、每按钮各自一次 IndexedDB `isSubscribed` 读取（N 按钮 = N 次读，**无共享缓存、不订阅 HUB_UPDATED → 外部变更不实时**）。

---

## 6. 跨切面观察

**一致性问题**
- **「活动态」有四套并存视觉语言**（同三 spoke 渲染三种样子）：HubNavLink = `border-b-2 border-pop` 墨下划线；header spokes = **纯 hover 无活动态**；DiscoverNav = shadcn 分段滑块（`bg-background shadow-sm`）；MobileNav = `bg-pop/10` wash。home-nav / tool tab / 资源类型 tab / agent 智能体模式又各是手写选中态——**全站「选中态」至少 5+ 套手写实现，多未用 shadcn Tabs/ToggleGroup/Switch**。
- **未抽取的重复微模式**：`⌘K` kbd 芯片（命令台 + not-found）、section-heading `<span text-xs muted>`（mobile-nav + command CommandGroup）、`bg-muted/40` 状态行（device-chip + error card）、provider/卡片（BookmarkCard ≈ FileGridCard ≈ 订阅卡 ≈ QuickJump 卡 ≈ navigation 卡，**各写一份**）、侧栏（书签收藏夹 + agent 会话两套）、空态/登录提示（订阅流/publications/agent/community 圆形图标空态多处同构）。
- **身份/同步状态在 3 处重叠呈现**（AccountMenu / LocalDeviceChip 发布身份行 / CommandPalette 同步命令）无交叉引用；**存储用量在 home-nav 卡(`bg-primary`)与 stat tile(`bg-pop`)两处、且 fill token 不一致**。
- **品牌不一致**：mark/aria-label 仍是「Wonita」，产品是「ideall」。

**token 违规（颜色硬编码——集中且严重）**
1. `info/analysis/graph.tsx` — G6 整套硬编码 hex 9 色节点 fill + `#1f2937`/`#475569` 标签 + `#cbd5e1` 边 + `#fff` 标签底 + 图例 inline backgroundColor。**全应用最大、最显眼的设计宪法破口**（彩色大面积 fill + 无暗色）。
2. `community/publisher-map.tsx` — echarts 底图 `#f1f5f9/#cbd5e1/#e2e8f0` + 散点/tooltip `#3b82f6`。**暗色不切换 + 用错 spoke 色（蓝代绿）+ 大面积涟漪 fill**。
3. `brand.ts` `BRAND_INK` + `app/icon.svg` — favicon `#1b222e/#e8ecf2` 硬编码两处，不随 `--foreground` 联动（静态资源限制，但属重复硬编码）。
4. `ui/sonner.tsx` `richColors=true` — 注入 sonner 自带绿/红 toast 背景，是**整个 shell 唯一大面积彩色 fill**，绕过 `--pop/--destructive`，与「色仅作点」规则相悖（flowbackToast 成功回执即受此影响）。

> 其余 home/shared/feeders/tool 集群**零颜色硬编码**——token 纪律整体很强；违规高度集中在两处图表 + sonner + favicon。

**任意值（绕过尺度刻度，非颜色违规）**：徽标/kbd `text-[10px]`、`h-[18px]/min-w-[18px]`、命令台四断点宽度阶梯、`[1.15rem]` 图标、`max-w-[12rem]`、`text-[11px]`、`min-h-[70vh]`、`max-w-[85vw]`、`md:pl-[10px]` 魔法补偿、**agent `h-[calc(100dvh-35rem)]`/`md:h-[calc(100dvh-19rem)]` 脆弱高度**、图表 `h-[400px]` 系列。

**响应式 / 暗色缺口**
- 响应式策略 = **渐进隐藏**：桌面 nav `hidden md:flex`→汉堡；LocalDeviceChip `md:block` + 标签 `lg:inline`；命令台宽度阶梯 + kbd `lg:inline`。**副作用：本地优先所有权面板（device chip）+ home 存储卡在移动端完全不可用**——而本地优先正是核心卖点。
- info 窄屏靠**砍列**而非重排，信息量骤减，无移动端卡片视图。
- 暗色由 token 集中处理（干净），**唯二例外是两处图表硬编码色（暗色下完全错配）**。

**templated / default-shadcn 痕迹**：near-stock new-york 原语；`CardTitle text-2xl` 默认被处处 override（默认值不适配本应用）；分页/对话框/选择器多为 stock；数据呈现几乎只有 DataTable 一种形态。

**重设计 Top 8 优先机会（已排序）**
1. **把两处图表（G6 知识图谱 + echarts 发布者地图）迁到 token**：节点用墨灰深浅 + 字重 + 形状/大小区分类别，仅本文/关键节点用单一强调色，监听主题切换重设 option 支持暗色——这是兑现 Ink 单色主张与暗色一致性的**最大破口**。
2. **统一「活动态/选中态」为单一语言**：抽共享 Tab/Segmented/NavItem 原语，终结 5+ 套手写 active（HubNavLink/header spokes/DiscoverNav/MobileNav/tool tab/资源 tab/agent 模式）。
3. **给 Button/Badge 加 `--pop`(ink-action) 与 spoke variant**，让墨色关键动作成为一等变体，解除 `primary≈pop` 脆弱耦合。
4. **抽共享卡片/原语**：ResourceCard（书签≈资源≈订阅）、ProviderCard（QuickJump≈navigation）、Kbd、EmptyState/SignInPrompt、StatCard、ListSidebar、Dropzone、FaviconImg(统一 `Globe` 兜底)——消除大量重复。
5. **统一 feeders 数据层**：`useSubscribed(type,key)`（共享缓存 + 订阅 HUB_UPDATED 实时刷新）+ `useFlowbackPulse()` hook，去掉 N 次 IndexedDB 读与 copy-paste；同时把所有计数源统一到同一刷新通道（修 home-nav 仅 pathname 刷新 + 存储 fill token 不一致）。
6. **让本地优先信息在移动端可达**：device chip / 存储状态进 MobileNav 或独立「系统状态」路由，避免核心卖点桌面独占。
7. **决定 toast 走 Ink 单色还是保留 sonner 彩色**：当前 `richColors` 是 shell 唯一大面积彩色 fill 且未文档化；建议落地为 token 单色回执（已有 `toastOptions.classNames` 基础）。
8. **导航与身份收敛**：App 形态统一用应用内路由替代 `window.open`；合并/交叉引用 AccountMenu 与 device chip 的身份呈现；并解决「Wonita mark vs ideall 品牌」身份不一致（出一个真 ideall glyph 或显式文档化）。
</CURRENT_STATE_MAP>

---

## 四、硬约束（必须遵守，违反即返工）

**技术形态**
- Next.js 16 App Router，**App-only / 静态导出 `output: export`**：**禁止** Server Actions、Route Handlers、请求期 `headers()`/`cookies()`、动态路由段等任何依赖运行时服务端的能力；动态数据一律**客户端取数**。新增交互组件加 `"use client"`，其余保持 Server Component。
- 目标含 **移动端（Tauri iOS/Android）**：所有布局必须**响应式且触摸友好**（足够大的可点区域、无桌面独占的核心信息）。在桌面与移动两种宽度都要验证。
- React 19；Tailwind v4，token 用 `src/app/globals.css` 的 `@theme inline` + `:root`/`.dark` CSS 变量；暗色经 `.dark` 类（已配 `@custom-variant dark`）。

**设计 token 纪律**
- 一切颜色 / 间距 / 字号 / 圆角 / 阴影**必须走 token 体系 + Tailwind theme**。**禁止**任何硬编码 hex/rgb，也尽量消除绕过尺度刻度的一次性任意值（`text-[10px]`、`h-[calc(...)]`、四断点像素阶梯等，见现状地图「任意值」清单）。
- 必须同时支持 **light 与 `.dark`**，并尊重 `prefers-reduced-motion`（`motion-reduce`）。图表（G6 / echarts）也必须读 token 且监听主题切换重设 option。

**UI 库**
- **只复用 `src/components/ui` 的 shadcn 原语**；**禁止引入并行 UI 库**。新原语遵循同样的 CVA / shadcn 模式，放进 `src/components/ui`（可用已在依赖里的 `@radix-ui/react-avatar` 等补缺口，但不得引入新的非 Radix UI 套件）。

**架构边界（务必遵守；注意两类约束的执行机制不同，不要混为一谈）**
- **类 ①（`pnpm lint` 真正强制，违反会直接报错）**：(a) `protocol/` 纯度——契约/端口层只可依赖 `@/components/lib` 纯工具，**不得 import UI / 页面代码**；(b) **wire DTO 边界**——后端 openapi 生成类型（`@/components/lib/api/server`）**仅** `components/lib/server` 适配器可 import，业务/protocol 代码一律用 `@protocol/server-port` 领域类型。
- **类 ②（惯例约束，`pnpm lint` 不会拦截，需你自律保证）**：`components/` 不得 import `app/`；`info / community / tool` 三 app 互不 import。**`pnpm lint` 通过 ≠ 这两条没破**——这两条没有 lint 规则兜底，务必人工核查不要引入此类反向/横向依赖。
- 重构是**纯表现层**：保持 port / manifest / boot 架构与数据流不变，不动契约语义。

**文案与品牌**
- 所有用户可见文案与代码注释保持**简体中文**，且**保留既有语义**：中枢 / spoke、回流(flowback)、本地优先、两套身份（无账号同步码 vs 发布账号）。
- 品牌统一为 **ideall**（修掉 WonitaMark 的 aria-label「Wonita」等不一致），保持 brand mark 与「ideall」身份连贯；**供应商中立** —— 视觉不要过度耦合到 wonita。

**质量闸**
- 每个阶段结束 `pnpm lint && pnpm typecheck` 必须通过（脚本：`pnpm dev` 开发服 5020 / `pnpm build` 即静态导出 / `pnpm lint` 含 protocol 纯度与 wire DTO 强制 / `pnpm typecheck` = `tsc --noEmit`）。
- 本重构为**纯表现层**，理论上不应改动逻辑；但若触及 `protocol/`、`plugins/sync/` 或 `lib/sync-crypto` 相关文件，须保证 **`pnpm test`** 仍通过。
- 验证 light & dark、desktop & mobile 宽度；不得回退可访问性（focus 状态、对比度、可点区域）。

---

## 五、工作流程（务必照此顺序：先给方向 → 暂停 → 分批落地）

### 阶段 0：勘察（动手前）
1. 用 Read/Grep 实读关键文件，核对现状地图：`src/app/globals.css`（token 真值）、`eslint.config.mjs`（确认上文「类 ①/②」边界划分）、`src/app/shell/*`、`src/app/(discover)/*`、`src/app/home/*`、`src/components/apps/{info,community,tool}/*`、**`src/components/plugins/{agent,sync}/*`（agent 面板魔法高度、SyncPanel）**、`src/components/ui/*`、`src/components/shared/*`、`src/components/feeders/*`、`src/components/lib/brand.ts` + `src/app/icon.svg`（favicon 硬编码）。
2. 简要回报你核实到的与地图的差异（如有）。**此阶段不改任何生产代码**。

### 阶段 1：提出 2–3 个视觉方向，然后**停下来等用户选择**（关键）
给出三个明显不同的方向（**A 必给，B/C 至少再给一个，建议三个都给**）：
- **方向 A — 保守精炼**：保留并升华现有 Ink 单色系，修缺陷（统一活动态、补 pop/spoke variant、迁图表到 token、收敛任意值），不改主色基调。
- **方向 B — 中性现代**：更干净的当代中性体系，**可以调整 primary / accent**（例如换一套更克制或更有呼吸感的中性灰阶、调整圆角与排版节奏），仍保持专业、低彩度。
- **方向 C — 大胆个性**：更具辨识度的视觉身份（可引入更明确的主色/强调色、更鲜明的排版对比、更有性格的形状与动效语言），在不违反硬约束的前提下让 ideall「有脸」。

每个方向都必须交付：
1. **设计理念**：2–4 句，说明它如何服务「本地优先 / 中枢 / spoke / 中立」叙事，以及与现状的取舍。
2. **具体 token diff**：直接给出你会在 `globals.css` 写入的真实值，**light 与 `.dark` 都要给**，至少含：`--background` / `--foreground` / `--primary`(及 `--primary-foreground`) / **`--pop`(及 `--pop-foreground`，并显式说明它与 `--primary` 的关系——必须给出二者各自独立的值，不得假设 `pop === primary`)** / **`--flowback`(及与 `--pop` 的关系)** / `--radius` / 字体栈(`--font-sans`/`--font-mono`) / 三个 spoke 值。
3. **排版与间距/尺度**：字号阶梯、字重策略、行高、间距刻度、控件高度（`h-9/h-10` 等）的取向。
4. **动效语言**：回流脉冲(flowback)、过渡时长/缓动、hover/active 反馈的统一规则，且如何遵守 `motion-reduce`。
5. **一个端到端重做的代表性页面**：建议 **home dashboard**（`hub-dashboard` + `hub-stat-tiles` + `recent-flowback`，含空态 EmptyHub），做成**真实可见**的预览 —— 放在**临时路由**（如 `app/_preview/<direction>/page.tsx`，仅开发期存在、不进正式导航、最后清理）或**自包含预览组件**里，使用真实 token / 真实 shadcn 原语实现，让用户能在 light/dark、桌面/移动下真正看到，而不是描述。三个方向的预览应可并排切换比较。
   - **预览路由约束**：它本身也必须满足 App-only 静态导出——**纯客户端、无动态路由段、不依赖服务端运行时**；数据可写死示例或纯客户端取数。**不得登记进正式导航**，并在阶段 2 波次 5 彻底删除（删后 `pnpm build` 仍须通过）。

交付三个方向后**明确停下**，请用户选择其一（并说明**允许混搭** —— 例如「B 的色板 + A 的排版 + C 的动效」）。**未得到用户选择前，不要对全站生产代码做大面积改动。**

### 阶段 2：分批落地用户所选方向（每批保持应用可运行 + 通过 lint/typecheck）
按以下波次推进，每批结束跑 `pnpm lint && pnpm typecheck`（触及 sync/crypto 时另跑 `pnpm test`）并自检 light/dark + desktop/mobile：
1. **波次 1 — token + shell**：落定 `globals.css` token（含相互独立的 `--primary` 与 `--pop`）；给 Button/Badge 加 `--pop`(ink-action) 与 spoke variant，解除 `primary≈pop` 耦合（新变体走 `--pop` 而非 `--primary`）；统一活动态/选中态为单一共享语言（抽 NavItem/Segmented，复用 shadcn Tabs/ToggleGroup/Switch）；处理 sonner toast（单色 vs 彩色，按所选方向落地）；修品牌 mark 一致性（WonitaMark aria-label / brand.ts / icon.svg）。同步更新 shell（header / nav / command palette / theme toggle / device chip / auth / error/loading/notfound）。
2. **波次 2 — home 中枢与相关插件视图**：dashboard / home-nav / 订阅流 / 书签 / 资源 / 发布，以及 **`components/plugins/agent/views/agent-panel.tsx`（含 `h-[calc(100dvh-35rem)]` 魔法高度）与 `components/plugins/sync` 的 SyncPanel**，套用新语言；让本地优先信息（device chip / 存储状态）在移动端可达；统一存储用量 fill token。
3. **波次 3 — info / community / tool**：含两处图表破口（`info/analysis/graph.tsx` G6、`community/publisher-map.tsx` echarts）迁到 token + 暗色 + 监听主题切换重设 option；统一卡片/空态/侧栏；info 窄屏给卡片/重排替代砍列。
4. **波次 4 — 共享原语收尾**：抽 ResourceCard / ProviderCard / Kbd / EmptyState / StatCard / ListSidebar / FaviconImg 等消除重复；feeders 数据层与计数刷新通道收敛（行为可不改，但视觉与 hook 形态对齐）。
5. **波次 5 — 清理**：删除阶段 1 的临时预览路由/组件（`app/_preview/*`），确认无悬挂引用、`pnpm build` 静态导出通过。

每完成一个波次，简要回报改了哪些文件、lint/typecheck（必要时 test）结果，并在进入下一波次前可暂停让用户确认。

---

## 六、验收标准

- [ ] 阶段 1 给出了 2–3 个**真正不同**的方向，每个都含理念 + 真实 token diff（含相互独立的 `--primary`/`--pop` 的 light+dark 值）+ 排版/间距 + 动效 + 一个**可真实查看**的代表性页面，并**已停下等用户选择**。
- [ ] 选定方向后分波次落地，**每个波次结束 `pnpm lint` 与 `pnpm typecheck` 均通过**（触及 sync/crypto 时 `pnpm test` 亦通过），应用全程可运行。
- [ ] 全站**零硬编码颜色**（含两处图表 + sonner + favicon 思路），消除现状地图列出的主要任意值；颜色/间距/字号/圆角全部走 token。
- [ ] light 与 dark、桌面与移动宽度均无明显破版；图表在暗色下正确；本地优先核心信息在移动端可达。
- [ ] 「活动态/选中态」收敛为单一语言；品牌统一为 ideall；保留中枢/回流/本地优先/两套身份语义与简体中文文案。
- [ ] **未破坏架构边界**：类 ①（protocol 纯度、wire DTO 仅适配器）`pnpm lint` 通过；类 ②（components 不 import app、三 app 互不 import）已人工确认无违反；端口/manifest/boot/数据流不变。
- [ ] 可访问性无回退（focus 可见、对比度达标、触摸目标足够大、`motion-reduce` 生效）。
- [ ] 临时预览路由/组件（`app/_preview/*`）已清理，`pnpm build` 通过。

---

## 七、交付方式

- 在本仓库**直接修改真实源码**（必要时新建临时预览路由）。建议在 `dev` 分支或新建特性分支上工作；**未经用户要求不要提交或推送**。
- 阶段 1 的产出以**对话回复 + 可运行的预览路由**呈现，便于用户在浏览器/Tauri 壳里实看；阶段 2 每个波次回报**改动文件清单 + lint/typecheck 结果 + light/dark·桌面/移动自检结论**。
- 全程沟通使用**简体中文**。

现在请从**阶段 0 勘察**开始，然后给出**阶段 1 的 2–3 个方向并停下等我选择**。
