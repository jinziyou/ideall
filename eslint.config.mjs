import nextConfig from "eslint-config-next"

// 个人信息终端 · 分层边界。顶层目录即架构层:
//   app(Next 路由薄标记) / shell(终端外壳) / workspace(一切皆标签) / files(一切皆文件·统一 Node 数据层) /
//   modules(功能模块 home·info·community·tool) / plugins(agent·sync·embed) / protocol(契约/端口) /
//   ui(原语+编辑器) / shared(跨层共享 UI) / lib(纯工具)。
// ESLint 强制五条边界:
//  (1) protocol 纯度 —— 契约/端口层只依赖 @/lib 纯工具叶子, 不得 import 任何 frame/功能/UI 层。
//  (2) wire DTO 边界 —— 后端 openapi 生成类型 (@/lib/api/server) 仅 HTTP 适配器 (@/lib/server) 可 import。
//  (3) app 路由不可被反向 import —— app/ 仅是「开标签」薄标记, 复用/功能层经 @protocol 端口协作。
//  (4) modules 三应用互隔 —— info/community/tool 互不 import, 跨模块一律经 @protocol。
//  (5) plugins ↛ shell/workspace —— 插件经 @/lib/ui-actions / @/lib/active-node 端口触达工作区, 禁反向 import 外壳/工作区。
// 注: flat config 的 no-restricted-imports 后匹配块整体覆盖 (不跨块合并), 故每块都重列适用禁令。

const WIRE_DTO = {
  group: ["@/lib/api/server", "@protocol/server"],
  message:
    "wire DTO 仅允许后端 HTTP 适配器 (@/lib/server) import; 业务代码用 @protocol/server-port 领域类型 (ideall 自有协议)",
}

const NO_APP = {
  group: ["@/app/**", "!@/app/globals.css"],
  message:
    "app/ 仅 Next 路由薄标记 (开标签); 复用/功能层不得反向 import 路由代码, 共享逻辑下沉 @/lib 或经 @protocol 端口注入",
}

const config = [
  ...nextConfig,
  {
    // @/lib/api/server.d.ts 是 openapi-typescript 生成物, 不该被 lint;
    // src-tauri (Rust 工程 + target/gen 产物) 与 out (静态导出产物) 均非 JS 源, 不入 lint (二者已 gitignore)。
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "src/lib/api/**",
      "src-tauri/**",
      "out/**",
    ],
  },

  // (1) protocol: 纯契约/端口/纯函数, 只依赖 @/lib 纯工具叶子; 不得 import frame/功能/UI 层, 也不得碰 wire DTO。
  {
    files: ["src/protocol/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/app/**",
                "@/shell/**",
                "@/workspace/**",
                "@/files/**",
                "@/modules/**",
                "@/plugins/**",
                "@/ui/**",
                "@/shared/**",
              ],
              message:
                "protocol 是纯契约/端口层, 只依赖 @/lib 纯工具; 不得 import frame/功能/UI 层 (领域类型自有定义)",
            },
            WIRE_DTO,
          ],
        },
      ],
    },
  },

  // (2)+(3) 基线 (除 HTTP 适配器 / 生成物 / protocol 外的所有 src): wire DTO 边界 + 不得反向 import app 路由。
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/server/**", "src/lib/api/**", "src/protocol/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [WIRE_DTO, NO_APP] }],
    },
  },

  // (4) modules 三应用互隔: info / community / tool 互不 import; 跨模块经 @protocol 协作 (内容解析在各自 manifest 注册)。
  ...[
    ["info", ["community", "tool"]],
    ["community", ["info", "tool"]],
    ["tool", ["info", "community"]],
  ].map(([self, siblings]) => ({
    files: [`src/modules/${self}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            WIRE_DTO,
            NO_APP,
            {
              group: siblings.flatMap((s) => [`@/modules/${s}`, `@/modules/${s}/**`]),
              message: `${self} 不得 import 其它应用模块 (${siblings.join("/")}); 三应用互隔, 跨模块经 @protocol 协作`,
            },
          ],
        },
      ],
    },
  })),

  // (5) plugins ↛ shell/workspace: 插件 (agent·sync·embed) 经 @/lib/ui-actions / @/lib/active-node 端口与外壳交互;
  //     禁反向 import 外壳/工作区, 防插件耦合具体 frame 实现 (§6.5 不变量, 机器强制)。
  {
    files: ["src/plugins/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            WIRE_DTO,
            NO_APP,
            {
              group: ["@/shell", "@/shell/**", "@/workspace", "@/workspace/**"],
              message:
                "插件不得反向 import 外壳/工作区 (@/shell·@/workspace); 触达工作区只准经 @/lib/ui-actions / @/lib/active-node 端口",
            },
          ],
        },
      ],
    },
  },
]

export default config
