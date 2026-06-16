import type { NextConfig } from "next"

// 构建目标：web（默认，SSR / standalone）或 app（Tauri 静态导出）。
//   - web: `pnpm build` → output: standalone（Node 运行时，SSR + Server Actions）
//   - app: `BUILD_TARGET=app pnpm build`（= `pnpm app:export`）→ output: export → out/
// 注意：静态导出不支持 Server Actions，需先完成数据层客户端化（见 docs/app.md Phase 1）。
const isApp = process.env.BUILD_TARGET === "app"

const webConfig: NextConfig = {
  output: "standalone",
  // 配置跨域
  experimental: {
    serverActions: {
      allowedOrigins: ["127.0.0.1", "localhost:5020"],
    },
  },
}

const appConfig: NextConfig = {
  output: "export",
  // 静态导出无 Node 图片优化服务
  images: { unoptimized: true },
  // 向客户端 bundle 注入构建目标标记: env.ts 的 clientWebProxyBase() 据此跳过同源 /api/backend 代理
  // (静态导出无 Next 服务端, 应直连 NEXT_PUBLIC_SERVER_ADDR)。脚本只设 BUILD_TARGET, 故在此派生。
  env: { NEXT_PUBLIC_BUILD_TARGET: "app" },
}

export default isApp ? appConfig : webConfig
