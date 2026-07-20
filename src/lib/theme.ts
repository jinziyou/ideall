/**
 * 轻量深浅色控制 (不依赖 next-themes)。
 * - 选择存 localStorage("ideall:theme"), 首次读取会迁移旧 "wonita-theme"。
 * - 实际是否 dark = 选择, 或 system 时跟随 prefers-color-scheme。
 * - 无闪烁: layout 内联脚本在 body 解析时同步打上 .dark 类 (见 THEME_INIT)。
 */
import { BRAND_INK, WONITA_PATH } from "./brand"
import {
  LEGACY_THEME_KEY,
  THEME_KEY,
  readPublicConfig,
  removePublicConfig,
  writePublicConfig,
} from "./public-config"

export { LEGACY_THEME_KEY, THEME_KEY } from "./public-config"

export type ThemeChoice = "light" | "dark" | "system"

const themeChoiceListeners = new Set<() => void>()

function notifyThemeChoice(): void {
  for (const listener of themeChoiceListeners) {
    try {
      listener()
    } catch {
      // 一个观察者不能阻断主题落盘或其它观察者。
    }
  }
}

/** 同进程主题选择订阅；跨标签变化仍由消费方监听 storage 事件。 */
export function subscribeThemeChoice(listener: () => void): () => void {
  themeChoiceListeners.add(listener)
  return () => {
    themeChoiceListeners.delete(listener)
  }
}

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

/** 内联到 <body> 顶部的无闪烁脚本 (首帧前同步设 .dark, 并把旧主题键迁到 ideall 命名空间)。 */
export const THEME_INIT = `(function(){try{var k='${THEME_KEY}',l='${LEGACY_THEME_KEY}',t=localStorage.getItem(k),o=localStorage.getItem(l);if(!t&&o){t=o;localStorage.setItem(k,o);localStorage.removeItem(l);}t=t||'system';var m=window.matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.classList.toggle('dark',t==='dark'||(t==='system'&&m));}catch(e){}})();`

export function getThemeChoice(): ThemeChoice {
  try {
    const next = readPublicConfig(THEME_KEY)
    const legacy = readPublicConfig(LEGACY_THEME_KEY)
    if (next) {
      if (legacy) removePublicConfig(LEGACY_THEME_KEY)
      if (next === "light" || next === "dark" || next === "system") return next
    }
    if (legacy === "light" || legacy === "dark" || legacy === "system") {
      writePublicConfig(THEME_KEY, legacy)
      removePublicConfig(LEGACY_THEME_KEY)
      return legacy
    }
  } catch {
    /* localStorage 不可用时退化为 system */
  }
  return "system"
}

export function applyTheme(choice: ThemeChoice) {
  if (typeof window === "undefined" || typeof document === "undefined") return
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
    writePublicConfig(THEME_KEY, choice)
    removePublicConfig(LEGACY_THEME_KEY)
  } catch {
    /* 忽略持久化失败 */
  }
  try {
    applyTheme(choice)
  } finally {
    notifyThemeChoice()
  }
}
