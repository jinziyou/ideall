/**
 * Web 形态同源 API 代理: 浏览器请求 /api/backend/* , 由 Next.js 服务端转发到 super/server。
 * 避免客户端跨域与构建期内联 API 地址 (生产域名场景) 不一致。
 */
import { NextRequest } from "next/server"

const UPSTREAM =
  process.env.SERVER_ADDR ?? process.env.NEXT_PUBLIC_SERVER_ADDR ?? "http://127.0.0.1:5021"

const FORWARD_REQUEST_HEADERS = [
  "content-type",
  "authorization",
  // 访问者地理定位 (/info/geoip): 透传 Cloudflare 边缘地理头 (首选) + 来源 IP 头 (回退),
  // 让 super/server 看到访问者地理/IP 而非 Next 服务端 IP。均由前置 Cloudflare / 平台反代注入。
  "cf-ipcity",
  "cf-iplatitude",
  "cf-iplongitude",
  "cf-ipcountry",
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const

type RouteCtx = { params: Promise<{ path: string[] }> }

async function proxy(req: NextRequest, pathSegments: string[]) {
  const path = pathSegments.join("/")
  const target = `${UPSTREAM.replace(/\/$/, "")}/${path}${req.nextUrl.search}`

  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }

  let body: ArrayBuffer | undefined
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer()
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
    })
  } catch (e) {
    console.error("[api/backend proxy]", target, e)
    return Response.json({ detail: "上游服务不可达" }, { status: 502 })
  }

  const resHeaders = new Headers()
  const contentType = upstream.headers.get("content-type")
  if (contentType) resHeaders.set("content-type", contentType)

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: resHeaders,
  })
}

async function handle(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const DELETE = handle
export const PATCH = handle
