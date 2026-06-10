// 回流成功 toast (反馈原语) —— 成功回流统一带去向回执「已回流到「我的」 · 只存本机」。
// 仅成功路径使用; 失败 / 取消 toast 不走此 helper。

import { toast } from "sonner"

export function flowbackToast(message: string, goto?: () => void) {
  toast.success(message, {
    description: "已回流到「我的」 · 只存本机",
    ...(goto ? { action: { label: "查看", onClick: goto } } : {}),
  })
}
