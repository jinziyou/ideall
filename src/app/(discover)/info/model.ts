// Info / InfoEvent / NameEntity / Publisher 类型直接派生自 super/server 的 OpenAPI schema
// (src/lib/api/server.d.ts)。改了 server 端模型, 重跑 `pnpm sync:api && pnpm gen:api` 即可同步。

import type { components } from "@/lib/api/server"

export type Info = components["schemas"]["Info"]
export type InfoEvent = components["schemas"]["InfoEvent"]
export type NameEntity = components["schemas"]["NameEntity"]
export type Publisher = components["schemas"]["Publisher"]
