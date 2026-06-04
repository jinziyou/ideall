"use server"

import { INFO_API_URI } from "@/lib/env"
import { apiFetch } from "@/lib/api"
import { PublisherLocation } from "./model"

/** 拉取已定位的发布者位置; 失败时返回空数组让页面仍可渲染。 */
export async function getPublisherLocations(): Promise<PublisherLocation[]> {
  const result = await apiFetch<PublisherLocation[]>(`${INFO_API_URI}/publishers/locations`, {
    cache: "no-store",
    defaultErrorMessage: "获取发布者位置失败",
  })
  if (!result.ok) {
    console.error("[getPublisherLocations]", result.message)
    return []
  }
  return Array.isArray(result.data) ? result.data : []
}
