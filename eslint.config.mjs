import nextConfig from "eslint-config-next"

// 依赖边界 (OS 式分层强制): 用 no-restricted-imports 禁止越界 import。
// 方向: protocol→lib; lib→∅; components→{protocol,lib}; app/*→{protocol,lib,components};
//       plugin/*→{protocol,lib,components}; core→{protocol,lib,components} (插件经 @protocol registry);
//       组合根 core/shell/boot.ts 例外。
const boundary = (files, deny, message) => ({
  files,
  rules: {
    "no-restricted-imports": [
      "error",
      { patterns: deny.map((group) => ({ group: [group], message })) },
    ],
  },
})

const config = [
  ...nextConfig,
  {
    // src/lib/api/server.d.ts 是 openapi-typescript 生成的, 不该被 lint
    ignores: [".next/**", "node_modules/**", "public/**", "src/lib/api/**"],
  },

  // app 完全独立: 只能依赖 @protocol / @lib / @/components；不碰 core / plugin / 其他 app
  boundary(
    ["src/apps/**/*.{ts,tsx}"],
    [
      "@core/*",
      "@plugin/*",
      "@app/*",
      "@/app/*",
      "@/lib/peer-action",
      "@/lib/auth/*",
      "@/lib/api/server",
    ],
    "app 必须独立: 只能 import @protocol / @lib / @/components (契约一律走 @protocol)",
  ),

  // plugin: 只能依赖 @protocol / @lib / @/components；不碰 core / app / 其他 plugin
  boundary(
    ["src/plugins/**/*.{ts,tsx}"],
    ["@core/*", "@app/*", "@plugin/*"],
    "plugin 经 @protocol 触达 core (HubDataPort / SyncPort 等), 不直接 import core / app",
  ),

  // core: 不碰 app / plugin (经 @protocol registry 触达); 组合根 boot.ts 例外
  boundary(
    ["src/core/**/*.{ts,tsx}"],
    ["@app/*", "@plugin/*"],
    "core 保持 app/plugin 无关; 经 @protocol registry 触达插件",
  ),
  { files: ["src/core/shell/boot.ts"], rules: { "no-restricted-imports": "off" } },

  // protocol: 纯契约/端口/纯函数, 只依赖 @lib (不含 UI; feeders 已迁至 @/components/feeders)
  boundary(
    ["src/protocol/**/*.{ts,tsx}"],
    ["@core/*", "@app/*", "@plugin/*", "@/app/*", "@/components/*"],
    "protocol 是纯契约/端口层, 只依赖 @lib; 不得 import UI (@/components) 或上层",
  ),

  // components: 共享 UI 叶子, 可依赖 @protocol (端口/类型) + @lib; 不碰 core / app / plugin
  boundary(
    ["src/components/**/*.{ts,tsx}"],
    ["@core/*", "@app/*", "@plugin/*", "@/app/*"],
    "components 是共享 UI: 仅可 import @protocol / @lib / 同层 @/components",
  ),

  // lib: 零内部依赖的叶子, 不碰任何子项目
  boundary(
    ["src/lib/**/*.{ts,tsx}"],
    ["@core/*", "@app/*", "@plugin/*", "@protocol/*", "@/app/*"],
    "lib 是零内部依赖的叶子",
  ),
]

export default config
