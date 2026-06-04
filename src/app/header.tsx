import Link from "next/link"
import Image from "next/image"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
  NavigationMenuContent,
} from "@/components/ui/navigation-menu"
import MainSearch from "./search"
import AccountMenu from "./account-menu"

export function Header() {
  return (
    <header className="sticky top-0 z-50 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
              <Link href="/">
                <Image
                  className="h-8 w-auto"
                  src="/wonita.svg"
                  alt="Wonita"
                  width={32}
                  height={32}
                />
              </Link>
            </NavigationMenuLink>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
              <Link href="/home">我的空间</Link>
            </NavigationMenuLink>
          </NavigationMenuItem>
          {/* 发现: info / community / tool 三个聚合模块归到此处 (路由仍为 /info、/community、/tool) */}
          <NavigationMenuItem>
            <NavigationMenuTrigger>发现</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuList className="flex-col">
                <NavigationMenuItem>
                  <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                    <Link href="/info">资讯</Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                    <Link href="/community">社区</Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                    <Link href="/tool">工具</Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>

      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="shrink-0 md:hidden">
            <Menu className="h-5 w-5" />
            <span className="sr-only">切换导航菜单</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left">
          <nav className="grid gap-6 text-lg font-medium">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
              <Image className="h-6 w-auto" src="/wonita.svg" alt="Wonita" width={24} height={24} />
              <span className="sr-only">Wonita</span>
            </Link>
            <Link href="/home" className="text-muted-foreground hover:text-foreground">
              我的空间
            </Link>
            {/* 发现分组: 资讯 / 社区 / 工具 */}
            <span className="text-sm font-semibold text-foreground">发现</span>
            <Link href="/info" className="pl-4 text-muted-foreground hover:text-foreground">
              资讯
            </Link>
            <Link href="/community" className="pl-4 text-muted-foreground hover:text-foreground">
              社区
            </Link>
            <Link href="/tool" className="pl-4 text-muted-foreground hover:text-foreground">
              工具
            </Link>
          </nav>
        </SheetContent>
      </Sheet>
      <div className="flex w-full items-center gap-4 md:ml-auto md:gap-2 lg:gap-4">
        <MainSearch />
        <AccountMenu />
      </div>
    </header>
  )
}
