import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  // 配置跨域
  experimental: {
    serverActions: {
      allowedOrigins: ["127.0.0.1", "localhost:3000"],
    },
  },
}

export default nextConfig
