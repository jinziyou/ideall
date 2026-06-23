import nextConfig from "eslint-config-next"

// 扁平布局 (app 路由+实现 / components 共享代码 / protocol 契约) 后, 原 OS 式分层边界解除;
// 仅保留 protocol 纯度: 契约/端口层不得反向依赖 UI 与页面代码 (允许 @/components/lib 纯工具)。
const config = [
  ...nextConfig,
  {
    // src/components/lib/api/server.d.ts 是 openapi-typescript 生成的, 不该被 lint
    ignores: [".next/**", "node_modules/**", "public/**", "src/components/lib/api/**"],
  },

  // protocol: 纯契约/端口/纯函数, 只依赖 @/components/lib (纯工具叶子); 不得 import UI 或 app,
  // 也不得依赖 wonita 服务的 wire DTO —— 领域类型在 @protocol/server-port 自有定义。
  {
    files: ["src/protocol/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "@/components/*", "!@/components/lib", "!@/components/lib/**"],
              message:
                "protocol 是纯契约/端口层, 只依赖 @/components/lib 纯工具; 不得 import UI 或页面代码",
            },
            {
              group: ["@/components/lib/api/server", "@protocol/server"],
              message:
                "protocol 不得依赖 wonita 服务 wire DTO (openapi 生成类型); 领域类型在 @protocol/server-port 自有定义, wire→domain 映射收敛在 components/lib/server 适配器内",
            },
          ],
        },
      ],
    },
  },

  // wire DTO 边界: wonita 服务的 openapi 生成类型 (@/components/lib/api/server) 仅允许
  // HTTP 适配器 (components/lib/server) import; 业务代码一律用 @protocol/server-port 领域类型。
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/lib/server/**", "src/components/lib/api/**", "src/protocol/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/lib/api/server", "@protocol/server"],
              message:
                "wire DTO 仅允许 HTTP 适配器 (components/lib/server) import; 业务代码用 @protocol/server-port 领域类型 (ideall 自有协议)",
            },
          ],
        },
      ],
    },
  },

  // components → app 边界: 共享代码 (components) 不得反向 import 页面/路由 (app)。
  // 注: flat config 的 no-restricted-imports 不跨 block 合并 (后匹配者整体覆盖), 故此处需再列 wire DTO 模式,
  // 否则 components 会丢掉上面的 wire DTO 禁令。server/api 适配器例外 (允许用 wire DTO)。
  {
    files: ["src/components/**/*.{ts,tsx}"],
    ignores: ["src/components/lib/server/**", "src/components/lib/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "@/app/**"],
              message:
                "components 是跨 app/core/plugin 的共享层, 不得反向 import app (页面/路由代码); 共享逻辑下沉到 components/lib 或经 props 注入",
            },
            {
              group: ["@/components/lib/api/server", "@protocol/server"],
              message:
                "wire DTO 仅允许 HTTP 适配器 (components/lib/server) import; 业务代码用 @protocol/server-port 领域类型 (ideall 自有协议)",
            },
          ],
        },
      ],
    },
  },

  // app 模块互隔 (惯例 → 强制): info / community / tool 互不 import, 跨模块协作一律经 @protocol。
  // 注: 同前, 后匹配块整体覆盖 no-restricted-imports, 故每块须重列 components→app 与 wire DTO 两条禁令。
  ...[
    ["info", ["community", "tool"]],
    ["community", ["info", "tool"]],
    ["tool", ["info", "community"]],
  ].map(([self, siblings]) => ({
    files: [`src/components/apps/${self}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "@/app/**"],
              message:
                "components 是跨 app/core/plugin 的共享层, 不得反向 import app (页面/路由代码); 共享逻辑下沉到 components/lib 或经 props 注入",
            },
            {
              group: ["@/components/lib/api/server", "@protocol/server"],
              message:
                "wire DTO 仅允许 HTTP 适配器 (components/lib/server) import; 业务代码用 @protocol/server-port 领域类型 (ideall 自有协议)",
            },
            {
              group: siblings.flatMap((s) => [
                `@/components/apps/${s}`,
                `@/components/apps/${s}/**`,
              ]),
              message: `${self} 不得 import 其它 app (${siblings.join("/")}); 三 app 互隔, 跨模块经 @protocol 协作 (内容解析在各自 manifest 注册)`,
            },
          ],
        },
      ],
    },
  })),
]

export default config
