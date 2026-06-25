/**
 * 轻量深浅色控制 (不依赖 next-themes)。
 * - 选择存 localStorage("wonita-theme"): "light" | "dark" | "system"。
 * - 实际是否 dark = 选择, 或 system 时跟随 prefers-color-scheme。
 * - 无闪烁: layout 内联脚本在 body 解析时同步打上 .dark 类 (见 THEME_INIT)。
 */
import { BRAND_INK, WONITA_PATH } from "./brand"

export type ThemeChoice = "light" | "dark" | "system"

export const THEME_KEY = "wonita-theme"

/**
 * 让浏览器 tab favicon 跟随「手动」主题选择 (而非仅 OS prefers-color-scheme)。
 * icon.svg 用 prefers-color-scheme 处理首帧/未登 JS 态; JS 就绪后由此覆盖成与手动主题一致的填充。
 */
function updateFavicon(dark: boolean) {
  const fill = dark ? BRAND_INK.dark : BRAND_INK.light
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128' fill='${fill}'><path d='${WONITA_PATH}'/></svg>`
  const href = "data:image/svg+xml," + encodeURIComponent(svg)
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (!link) {
    link = document.createElement("link")
    link.rel = "icon"
    document.head.appendChild(link)
  }
  link.type = "image/svg+xml"
  link.href = href
}

/** 内联到 <body> 顶部的无闪烁脚本 (首帧前同步设 .dark)。 */
export const THEME_INIT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')||'system';var m=window.matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.classList.toggle('dark',t==='dark'||(t==='system'&&m));}catch(e){}})();`

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === "light" || v === "dark" || v === "system") return v
  } catch {
    /* localStorage 不可用时退化为 system */
  }
  return "system"
}

export function applyTheme(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
  try {
    updateFavicon(dark)
  } catch {
    /* favicon 更新失败不影响主题 */
  }
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice)
  } catch {
    /* 忽略持久化失败 */
  }
  applyTheme(choice)
}
