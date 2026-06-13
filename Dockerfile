# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base

# 安装依赖
FROM base AS deps
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline

# 构建
FROM base AS builder
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Web 形态: 浏览器客户端取数的后端地址, 构建期内联进静态资源 (见 src/components/lib/env.ts)。
# 部署侧经 build arg 注入官方公网 API; 缺省为空时回落 env.ts 默认 (本地)。
ARG NEXT_PUBLIC_SERVER_ADDR=""
ENV NEXT_PUBLIC_SERVER_ADDR=$NEXT_PUBLIC_SERVER_ADDR
RUN pnpm build

# 运行
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
