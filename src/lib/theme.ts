/**
 * 轻量深浅色控制 (不依赖 next-themes)。
 * - 选择存 localStorage("wonita-theme"): "light" | "dark" | "system"。
 * - 实际是否 dark = 选择, 或 system 时跟随 prefers-color-scheme。
 * - 无闪烁: layout 内联脚本在 body 解析时同步打上 .dark 类 (见 THEME_INIT)。
 */
export type ThemeChoice = "light" | "dark" | "system"

export const THEME_KEY = "wonita-theme"

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
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice)
  } catch {
    /* 忽略持久化失败 */
  }
  applyTheme(choice)
}
