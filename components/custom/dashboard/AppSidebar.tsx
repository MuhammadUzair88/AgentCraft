"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useUser, UserButton } from "@clerk/nextjs"
import {
  Blocks,
  Bot,
  CirclePlay,
  CreditCard,
  LayoutDashboard,
  Layers3,
  Settings,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const workspaceItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, color: "bg-blue-100 text-blue-600" },
  { label: "Agents", href: "/dashboard/agents", icon: Bot, color: "bg-violet-100 text-violet-600" },
  { label: "Runs", href: "/dashboard/runs", icon: CirclePlay, color: "bg-emerald-100 text-emerald-600" },
  { label: "Integrations", href: "/dashboard/integrations", icon: Blocks, color: "bg-orange-100 text-orange-600" },
  { label: "Templates", href: "/dashboard/templates", icon: Layers3, color: "bg-pink-100 text-pink-600" },
]

const userItems = [
  { label: "Settings", href: "/dashboard/settings", icon: Settings, color: "bg-slate-100 text-slate-600" },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard, color: "bg-green-100 text-green-600" },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { isLoaded, user } = useUser()

  return (
    <Sidebar className="border-r-0 bg-[#fafafa]">
      <SidebarHeader className="flex-row items-center gap-2.5 border-b border-slate-100 px-5 py-4">
        <Image src="/logo.svg" alt="AgentCraft logo" width={36} height={36} />
        <h2 className="text-lg font-semibold text-slate-900">AgentCraft</h2>
      </SidebarHeader>

      <SidebarContent className="bg-[#fafafa] px-3 pt-4">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="mb-1 px-3 text-[11px] font-medium text-slate-400">
            Workspace
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {workspaceItems.map(({ label, href, icon: Icon, color }) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  render={<Link href={href} />}
                  isActive={pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`))}
                  className="h-10 gap-3 rounded-lg px-2.5 text-[13px] font-medium text-slate-700 hover:bg-white data-active:bg-white data-active:text-slate-900 data-active:shadow-sm"
                >
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] ${color}`}>
                    <Icon className="size-4" />
                  </span>
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="mt-5 p-0">
          <SidebarGroupLabel className="mb-1 px-3 text-[11px] font-medium text-slate-400">
            Users
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {userItems.map(({ label, href, icon: Icon, color }) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  render={<Link href={href} />}
                  isActive={pathname === href || pathname.startsWith(`${href}/`)}
                  className="h-10 gap-3 rounded-lg px-2.5 text-[13px] font-medium text-slate-700 hover:bg-white data-active:bg-white data-active:text-slate-900 data-active:shadow-sm"
                >
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] ${color}`}>
                    <Icon className="size-4" />
                  </span>
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-slate-100 p-3">
        {isLoaded && user && (
          <div className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2">
            <UserButton appearance={{ elements: { avatarBox: "size-9" } }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">
                {user.fullName || user.username || "Account"}
              </p>
              <p className="truncate text-xs text-slate-500">
                {user.primaryEmailAddress?.emailAddress}
              </p>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
