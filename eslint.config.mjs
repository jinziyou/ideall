import nextConfig from "eslint-config-next"

// 扁平布局 (app 路由+实现 / components 共享代码 / protocol 契约) 后, 原 OS 式分层边界解除;
// 仅保留 protocol 纯度: 契约/端口层不得反向依赖 UI 与页面代码 (允许 @/components/lib 纯工具)。
const config = [
  ...nextConfig,
  {
    // src/components/lib/api/server.d.ts 是 openapi-typescript 生成的, 不该被 lint
    ignores: [".next/**", "node_modules/**", "public/**", "src/components/lib/api/**"],
  },

  // protocol: 纯契约/端口/纯函数, 只依赖 @/components/lib (纯工具叶子); 不得 import UI 或 app
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
          ],
        },
      ],
    },
  },
]

export default config
