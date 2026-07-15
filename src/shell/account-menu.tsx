"use client"

import * as React from "react"
import Link from "next/link"
import { CircleUser } from "lucide-react"
import { Button } from "@/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { toast } from "sonner"
import { clearSession, getSession, subscribeSession } from "@/lib/auth/auth-store"
import { HOME_TARGET } from "@/shell/nav-config"
import { openTarget } from "@/workspace/store"

/** 账户菜单: 已登录显示用户名 + 退出; 未登录显示登录入口。读本地会话 (useSyncExternalStore)。 */
export default function AccountMenu() {
  const session = React.useSyncExternalStore(subscribeSession, getSession, () => null)

  function logout() {
    clearSession()
    toast.success("已退出登录")
    openTarget(HOME_TARGET)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="rounded-full">
          <CircleUser className="h-5 w-5" />
          <span className="sr-only">打开账户菜单</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {session ? (
          <>
            <DropdownMenuLabel className="max-w-[12rem] truncate">
              {session.user.name || session.user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openTarget(HOME_TARGET)}>我的</DropdownMenuItem>
            <DropdownMenuItem onClick={logout}>退出登录</DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuLabel>未登录</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/auth">登录 / 注册</Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
