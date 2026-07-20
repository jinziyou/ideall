import type { NextConfig } from "next"

// ideall 仅以 App 形态分发 (Tauri 跨平台桌面 / 移动)。
// 生产构建一律静态导出 (output: export → out/), 无 Node 运行时 / 无 SSR 生产部署;
// 客户端直连后端数据服务 (NEXT_PUBLIC_SERVER_ADDR, 需后端放行 CORS, 见 docs/app.md)。
// `pnpm dev` 仍是本地 SSR 开发服 (供 `pnpm app:dev` 的 Tauri 壳加载), 不影响导出。
const nextConfig: NextConfig = {
  output: "export",
  // 静态导出无 Node 图片优化服务
  images: { unoptimized: true },
  // Tauri app:dev 若误用 127.0.0.1 加载 dev 服, 放行跨域 dev 资源 (HMR 等), 避免整页点击失效。
  allowedDevOrigins: ["127.0.0.1"],
  // 桌面壳已有自定义状态/调试入口; 禁用 Next 开发指示器, 避免左下角悬浮球遮挡工作区。
  devIndicators: false,
}

export default nextConfig
