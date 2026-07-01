// 加入「我的」成功 toast (基础组件) —— 主行是平实动作词 (如「已收藏到书签」),
// 副行统一带保存位置提示「已存到「我的」 · 只存本机」。仅成功路径使用; 失败 / 取消不走此 helper。

import { toast } from "sonner"

export function flowbackToast(message: string, goto?: () => void) {
  toast.success(message, {
    description: "已存到「我的」 · 只存本机",
    ...(goto ? { action: { label: "查看", onClick: goto } } : {}),
  })
}
