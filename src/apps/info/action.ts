"use server"

import { INFO_API_URI } from "@/lib/env"
import { apiFetch, type ApiResult } from "@/lib/api"
import { EntityDetail, EntityStats, Info, InfoEvent, RelatedInfo } from "./model"
import type { components } from "@protocol/server"

/** 信息查询参数, 派生自 super/server 的 OpenAPI schema (勿手写, 改后跑 pnpm gen:api)。 */
export type QueryParams = components["schemas"]["QueryInfoParams"]

/** 默认分页: 单页 200 条, 偏移 0。 */
const DEFAULT_PAGE_SIZE_OFFSET: [number, number] = [200, 0]

/** 合并默认分页, 构造 /info 系列接口的查询请求体。 */
function buildQueryBody(params: QueryParams | Record<string, unknown>) {
  return {
    ...params,
    page_size_offset: (params as QueryParams).page_size_offset ?? DEFAULT_PAGE_SIZE_OFFSET,
  }
}

/** 最新信息列表; 返回结构化结果, 客户端可识别失败并 toast.error。 */
export async function fetchLatestInfo(
  params: QueryParams | Record<string, unknown>,
): Promise<ApiResult<Info[]>> {
  return apiFetch<Info[]>(`${INFO_API_URI}`, {
    method: "POST",
    json: buildQueryBody(params),
    cache: "no-store",
    defaultErrorMessage: "获取最新信息失败",
  })
}

/**
 * 按同一事件聚类后的报道列表 (`POST /info/events`): 分页结果内共享实体两两判定 + 并查集传递闭包。
 * ⚠️ 口径不同于「全面报道」(`getRelatedInfo` → `/info/analysis`): 后者对单篇做全图一跳、
 * 仅取与目标直接共享的其它 Info、不做传递闭包, 故事件的 `source_count` 与全面报道页的来源数通常不相等。
 */
export async function fetchInfoEvents(
  params: QueryParams | Record<string, unknown>,
): Promise<ApiResult<InfoEvent[]>> {
  return apiFetch<InfoEvent[]>(`${INFO_API_URI}/events`, {
    method: "POST",
    json: buildQueryBody(params),
    cache: "no-store",
    defaultErrorMessage: "获取事件列表失败",
  })
}

/**
 * 某条信息的「全面报道」: 描述同一事件的其它来源 (super/server /info/analysis)。
 * 响应项为 RelatedInfo = Info 平铺 + shared/shared_entry 关联强度, 已按相关度倒序、至多 50 条。
 */
export async function getRelatedInfo(url: string): Promise<RelatedInfo[]> {
  const params = new URLSearchParams({ url })
  const result = await apiFetch<RelatedInfo[]>(`${INFO_API_URI}/analysis?${params}`, {
    cache: "no-store",
    defaultErrorMessage: "获取关联信息失败",
  })
  if (!result.ok) {
    console.error("[getRelatedInfo]", result.message)
    return []
  }
  return Array.isArray(result.data) ? result.data : []
}

/**
 * 实体详情聚合 (`GET /info/entity?label=&name=`): 提及量/首末次时间/周趋势/共现实体/词条链接。
 * 拿不到返回 null, 由实体页降级为「仅信息列表」展示 (详情属增强信息, 不应阻塞主链路)。
 */
export async function getEntityDetail(label: string, name: string): Promise<EntityDetail | null> {
  const params = new URLSearchParams({ label, name })
  const result = await apiFetch<EntityDetail>(`${INFO_API_URI}/entity?${params}`, {
    cache: "no-store",
    defaultErrorMessage: "获取实体详情失败",
  })
  if (!result.ok) {
    console.error("[getEntityDetail]", result.message)
    return null
  }
  return result.data
}

/** 近 N 小时五类实体频次 (`GET /info/entity/{hour}`); 返回结构化结果, 供首页热门实体榜。 */
export async function fetchEntityStats(hours: number): Promise<ApiResult<EntityStats>> {
  return apiFetch<EntityStats>(`${INFO_API_URI}/entity/${hours}`, {
    cache: "no-store",
    defaultErrorMessage: "获取热门实体失败",
  })
}

/** 单条信息详情; 拿不到返回 null, 由调用方决定走 notFound 还是占位。 */
export async function getInfo(url: string): Promise<Info | null> {
  const params = new URLSearchParams({ url })
  const result = await apiFetch<Info>(`${INFO_API_URI}?${params}`, {
    cache: "no-store",
    defaultErrorMessage: "获取信息详情失败",
  })
  if (!result.ok) {
    console.error("[getInfo]", result.message)
    return null
  }
  return result.data
}
