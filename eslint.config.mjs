import nextConfig from "eslint-config-next"

// 个人信息终端 · 分层边界。顶层目录即架构层:
//   app(Next 路由薄标记) / shell(终端外壳) / workspace(Display) / filesystem(挂载层) / engines(引擎解析) / files(Node 数据层) /
//   modules(功能模块 home·info·community·tool) / plugins(agent·sync·embed·code·git·shell·audio·database) / protocol(契约/端口) /
//   ui(原语+编辑器) / shared(跨层共享 UI) / lib(工具与运行时适配)。
// ESLint 强制五条边界:
//  (1) protocol 纯度 —— 契约/端口层只使用同目录相对依赖，不加载任何运行时实现或 UI 层。
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

const NO_UI_STORAGE_BYPASS = {
  group: ["@/files/stores", "@/files/stores/**", "@/filesystem/resource-sources/registry"],
  message:
    "活动 UI 不得直接访问 store/resource-source registry; 数据与动作必须经 FileSystem，底层 store/source 只作为 provider、同步或 port 的内部实现",
}

const config = [
  ...nextConfig,
  {
    // @/lib/api/server.d.ts 是 openapi-typescript 生成物, 不该被 lint;
    // src-tauri (Rust 工程 + target/gen 产物) / out (静态导出产物) 均非手写 JS 源, 不入 lint。
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "src/lib/api/**",
      "src-tauri/**",
      "out/**",
      // 设计系统同步工具生成的自包含 bundle/vendor，不是应用手写源码。
      "ds-bundle/**",
      ".ds-sync/**",
      ".design-sync/**",
    ],
  },

  // (1) protocol: 纯契约/端口/纯函数，只允许同目录相对依赖；运行时 registry 与 adapter 留在 lib。
  {
    files: ["src/protocol/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/**", "@protocol/**"],
              message:
                "protocol 是纯契约层，只允许同目录相对依赖；运行时 registry、adapter 与 UI 必须留在所属层",
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

  // Display 与产品 UI 只能经 FileSystem 访问数据。测试可直接组装底层 provider 验证兼容边界。
  {
    files: [
      "src/app/**/*.{ts,tsx}",
      "src/shell/**/*.{ts,tsx}",
      "src/workspace/**/*.{ts,tsx}",
      "src/modules/**/*.{ts,tsx}",
      "src/shared/**/*.{ts,tsx}",
      "src/ui/**/*.{ts,tsx}",
    ],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [WIRE_DTO, NO_APP, NO_UI_STORAGE_BYPASS] }],
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
            NO_UI_STORAGE_BYPASS,
            {
              group: siblings.flatMap((s) => [`@/modules/${s}`, `@/modules/${s}/**`]),
              message: `${self} 不得 import 其它应用模块 (${siblings.join("/")}); 三应用互隔, 跨模块经 @protocol 协作`,
            },
          ],
        },
      ],
    },
  })),

  // React Compiler 实验规则降噪: 本项目未启用 React Compiler。下面两条随 eslint-plugin-react-hooks
  // 升级带入, 但只对「编译器友好」代码有意义, 对本项目的合理手写模式整片误报, 故关闭:
  //  - set-state-in-effect: 命中挂载加载 / 外部源订阅 / localStorage hydration / Tauri 环境探测等
  //    React 官方认可的 effect setState (apps/notes 列表加载、sidebar-tree 展开态恢复、window-titlebar 仅桌面显示)。
  //  - static-components: 命中 `const Icon = iconForNodeKind(kind)` —— iconForNodeKind 返回稳定的
  //    lucide 组件引用 (NODE_ICON 查表), 并非 render 期新建组件。
  // 其余 react-hooks 核心规则 (rules-of-hooks / exhaustive-deps) 与 react/no-children-prop 仍生效。
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },

  // (5) plugins ↛ shell/workspace: 插件经 @/lib/ui-actions / @/lib/active-node 端口与外壳交互;
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

  // 已完成 FileSystem 化的 Agent Display 不得重新直连 feature store/provider 实现。
  // 这里重列 plugin frame 禁令，因为 flat config 的 no-restricted-imports 不跨块合并。
  {
    files: [
      "src/plugins/agent/views/ai-settings.tsx",
      "src/plugins/agent/views/agent-spaces.tsx",
      "src/plugins/agent/views/agent-task-list.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            WIRE_DTO,
            NO_APP,
            NO_UI_STORAGE_BYPASS,
            {
              group: ["@/shell", "@/shell/**", "@/workspace", "@/workspace/**"],
              message: "Agent Display 不得反向 import 外壳/工作区；触达工作区只准经 UI action port",
            },
            {
              group: [
                "../lib",
                "../lib/**",
                "@/plugins/agent/lib",
                "@/plugins/agent/lib/**",
                "@protocol/flowback",
              ],
              message:
                "能力 Display 的读取、写入和订阅必须经 FileSystem registry；底层 store/catalog 只允许 provider 适配器访问",
            },
          ],
        },
      ],
    },
  },

  // 基本设置 Display 同样只能消费文件文档；受控 shell 视图与 workspace 导航动作仍可复用。
  {
    files: ["src/modules/home/settings/settings-page.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            WIRE_DTO,
            NO_APP,
            NO_UI_STORAGE_BYPASS,
            {
              group: [
                "@/modules/home/settings/settings-file-system",
                "./settings-file-system",
                "@/lib/theme",
                "@/lib/sync-code",
                "@/lib/auth/auth-store",
                "@/plugins/embed/connections",
                "@/shell/runtime-extensions",
              ],
              message:
                "SettingsPage 的读取、写入和订阅必须经 FileSystem registry；底层 store/catalog 只允许 provider 适配器访问",
            },
          ],
        },
      ],
    },
  },
]

export default config
