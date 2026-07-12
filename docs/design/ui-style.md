# UI 视觉规范 —— 现代 · 面板 · 留白

全站视觉决策的**单一事实来源**。此前这套约定散落两处且互相矛盾（`globals.css` 注释说「白卡 + 柔阴影」、agent 插件的 ui-kit 注释说「border-first 几无阴影」），本页是裁决后的统一口径；`globals.css` 与组件注释与本页不一致时，以本页为准并修正注释。

适用范围：全部 `src/**` 的 UI 代码与外部贡献的 UI PR（见 README「参与贡献」）。

## 1. 阴影（border-first，已裁决）

| 层 | 口径 |
| --- | --- |
| 内容卡片 / 面板（`bg-card` 容器、区段卡、列表卡） | **零阴影**，用 `border` 描边分层；hover 用 `hover:border-foreground/20` / `hover:bg-accent`，不用 hover 阴影 |
| 浮层（菜单 / 对话框 / 悬浮卡 / select / tooltip / toast / sheet） | 统一 `shadow-overlay` 令牌（`--shadow-overlay`，亮/暗各有值，见 `globals.css` 的 `--shadow-overlay-color`）；**不得**散用 Tailwind 默认 `shadow-md/lg` |
| 控件微阴影（分段滑块 thumb / Switch 钮面 / tabs 活动片） | 允许 `shadow-sm`（hairline 级，向 shadcn 原语看齐） |

裁决理由：暗色模式下描边分层始终成立，而浅色柔阴影在暗色下发脏；面板密度高的终端类界面用描边更收敛。

## 2. 颜色

- **语义令牌优先**：一律走 `globals.css` 的 HSL 令牌（`--background/--card/--muted/--accent/…`），禁止新增未经约定的 hex / rgb 字面量；暗色差异原则上只在 `.dark` 令牌层解决。现存例外是 `kbd-node.tsx` 的历史阴影，以及 `code-block-node.tsx` 的语法高亮调色板；它们不应被复制为普通组件写法。
- **强调色**：靛蓝 `--primary` 是唯一强调色，**每屏只给一个主操作**。
- **`--pop` / `--flowback`**：严格保留给「关键动作 / 加入我的 / 流回」语义，不得兼职表示运行状态。
- **`--spoke-*` 三色**（资讯蓝 / 社区绿 / 工具紫）：只用于小圆点、图标 tint、标签，**绝不大面积 fill**。
- **状态色**：`ok→success`、`warn→warning`、`error→destructive`、`idle→muted-foreground`、`info→info`。全站唯一映射在 `src/ui/status-dot.tsx`（StatusDot）与 `src/ui/chip.tsx`（Chip，配方 `border-{tone}/30 bg-{tone}/10 text-{tone}`）——不要自写状态点/状态药丸。

## 3. 圆角阶梯

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `rounded-lg`（= `--radius`，1rem） | 便当圆角 | 内容卡片 / 面板 |
| `rounded-md` / `rounded-sm` | −2px / −4px | 控件（按钮 / 输入框 / 菜单） |
| `rounded-shell`（0.5rem） | 壳层专用 | 活动栏 / 侧栏 / 标签条 / 状态栏的行与钮 |

注意：`rounded-xl` 及以上**未在令牌层重定义**，会回落 Tailwind 默认值造成「xl 比 lg 更小」的刻度倒挂——**禁用 `rounded-xl+`**，需要更大圆角时先在 `@theme` 补令牌。

## 4. 间距（三档）与排版（type ramp）

- 间距三档：`gap-2`（组内）/ `gap-4`（行间）/ `space-y-8`（区段间）。
- 内容列：`max-w-2xl / 3xl` + `mx-auto`（留白 = 现代感）。
- Type ramp：标题 `text-base font-semibold` · 正文 `text-sm` · meta `text-[13px] text-muted-foreground`。
- 壳层微字号（现状）：标签条 13px、活动栏 11px、徽标 10px——目前仍广泛使用任意值，**待令牌化**（`--text-meta/--text-micro`）；新代码沿用现值，勿再发明新字号。

## 5. 公共组件（先查再写）

通用原语一律放 `src/ui`，**禁止在 modules / plugins 里另起并行实现**（agent 的 ui-kit 通用件已下沉，仅保留 AiPage/ListRow/AddButton/ComposerShell 等 agent 组合件）：

| 需求 | 组件 |
| --- | --- |
| 区段卡片 / 设置行 / 内容浮动面板 | `@/ui/panel`（Panel / SettingRow / SurfacePanel） |
| 状态点 / 计数徽标 | `@/ui/status-dot`（StatusDot / CountBadge） |
| 状态药丸 | `@/ui/chip`（Chip） |
| 开关 | `@/ui/switch`（Switch） |
| 错误兜底 | `@/ui/error-boundary`（ErrorBoundary，标签内容已默认包裹） |
| 空态 | `@/ui/empty-state` |

手写 `rounded-lg border bg-card p-*` 的裸面板属于待迁移的历史写法（如 `home/settings`、`overview`），新代码请用 Panel 家族。

## 6. 动效与可访问性

- `prefers-reduced-motion` 已有全局兜底（`globals.css`），组件无需逐个守卫。
- 壳层过渡基准 200ms（侧栏折叠 / AI 栏开合已对齐）；动效节奏令牌（duration/easing）待建，新代码优先复用 200ms。
- 焦点环统一 `focus-visible:ring-2 focus-visible:ring-ring`（壳层内嵌场景加 `ring-inset`），去掉 `outline-none` 时必须给出替代焦点样式。
- 触屏命中区：视觉尺寸可小于 44px，但需按 `tab-bar.tsx` 的既有模式用 `pointer-coarse:` 伪元素扩到 ~44px（WCAG 2.5.8）。
