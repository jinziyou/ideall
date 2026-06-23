import { toast } from "sonner"

/**
 * 可撤销删除 toast (M-3) —— 删除即时生效, 但给一次「撤销」机会把刚删的记录原样写回。
 * 触屏无 hover, 故用 toast 动作而非悬停态; 与 subscribe-button 取消订阅撤销同范式。
 *
 * @param label 已删除对象展示名 (用于「已删除「{label}」」)
 * @param restore 撤销回调: 把记录写回 IDB + 同步本地列表; 抛错则给「撤销失败」提示
 */
export function undoableDeleteToast(label: string, restore: () => void | Promise<void>): void {
  toast.success(`已删除「${label}」`, {
    action: {
      label: "撤销",
      onClick: () => {
        void Promise.resolve()
          .then(restore)
          .catch(() => toast.error("撤销失败，请重试"))
      },
    },
  })
}
