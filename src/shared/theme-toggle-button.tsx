"use client"

import { Moon, Sun } from "lucide-react"
import { Button } from "@/ui/button"

export type ThemeToggleButtonProps = Readonly<{
  disabled?: boolean
  onToggle(): void
}>

/** 受控纯按钮；设置 Display 可从 FileSystem 文档提供当前值与写入回调。 */
export function ThemeToggleButton({ disabled = false, onToggle }: ThemeToggleButtonProps) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="shrink-0"
      aria-label="切换深浅色"
      title="切换深浅色"
      disabled={disabled}
      onClick={onToggle}
    >
      <Sun className="hidden h-[1.15rem] w-[1.15rem] dark:block" />
      <Moon className="h-[1.15rem] w-[1.15rem] dark:hidden" />
      <span className="sr-only">切换深浅色</span>
    </Button>
  )
}
