// 命令面板开启信号总线 (纯事件, 无 UI) —— 任意触发器 dispatch, 全局命令面板监听。
// 抽到 lib 纯工具层, 使 components 的触发器 (shared/command-trigger) 不必反向 import app/shell。

/** 任意位置的触发器调它打开全局唯一命令面板 (方案 3: ⌘K 浮层引擎)。 */
export const CMDK_OPEN = "ideall:command-palette-open"

export function openCommandPalette() {
  window.dispatchEvent(new Event(CMDK_OPEN))
}
