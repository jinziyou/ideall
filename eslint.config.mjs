import nextConfig from "eslint-config-next"

export default [
  ...nextConfig,
  {
    // src/lib/api/server.d.ts 是 openapi-typescript 生成的, 不该被 lint
    ignores: [".next/**", "node_modules/**", "public/**", "src/lib/api/**"],
  },
]
