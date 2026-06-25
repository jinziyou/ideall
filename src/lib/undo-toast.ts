import { toast } from "sonner"

/**
 * 可撤销动作 toast —— 动作即时生效, 但给一次「撤销」机会还原。
 * 触屏无 hover, 故用 toast 动作而非悬停态; 收敛删除 / 取消关注 / 取消钉住等破坏性动作的撤销范式。
 *
 * @param message 成功提示主文案 (如「已取消关注 X」)
 * @param restore 撤销回调: 还原刚才的动作 (写回 / 复活 + 同步本地列表); 抛错则给「撤销失败」提示
 */
export function undoableToast(message: string, restore: () => void | Promise<void>): void {
  toast.success(message, {
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

/** 可撤销删除 toast (M-3) —— undoableToast 的删除特化, 主文案「已删除「{label}」」。 */
export function undoableDeleteToast(label: string, restore: () => void | Promise<void>): void {
  undoableToast(`已删除「${label}」`, restore)
}
