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
      allowedOrigins: ["127.0.0.1", "localhost:3000"],
    },
  },
}

const appConfig: NextConfig = {
  output: "export",
  // 静态导出无 Node 图片优化服务
  images: { unoptimized: true },
}

export default isApp ? appConfig : webConfig
