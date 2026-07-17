import { toast } from "sonner"
import { claimFirstCapturePrompt } from "@/lib/capture-onboarding"
import { openTarget } from "@/workspace/store"
import { homePlaceById } from "@/workspace/tree/home-places"

function openCaptureInbox(): void {
  const path = homePlaceById("inbox")?.defaultPath
  if (path) openTarget({ type: "path", path })
}

export function captureOnboardingToastGuide(): {
  firstPrompt: boolean
  action?: { label: string; onClick: () => void }
} {
  const firstPrompt = claimFirstCapturePrompt()
  return {
    firstPrompt,
    ...(firstPrompt ? { action: { label: "查看收件箱", onClick: openCaptureInbox } } : {}),
  }
}

export function captureBookmarkSuccessToast(result: {
  status: "created" | "existing"
  title: string
}): void {
  if (result.status === "existing") {
    toast.info("已在我的书签中", { description: result.title })
    return
  }
  const { firstPrompt, ...guide } = captureOnboardingToastGuide()
  toast.success("已保存到我的", {
    description: firstPrompt
      ? `${result.title} · 已进入收件箱，可稍后整理 · 只存本机`
      : `${result.title} · 已进入收件箱 · 只存本机`,
    ...guide,
  })
}

export function captureBookmarkFailureToast(): void {
  toast.error("保存失败，请重试")
}
