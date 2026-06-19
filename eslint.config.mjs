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
                "wire DTO 仅允许 HTTP 适配器 (components/lib/server) import; 业务代码用 @protocol/server-port 领域类型 (myos 自有协议)",
            },
          ],
        },
      ],
    },
  },
]

export default config
