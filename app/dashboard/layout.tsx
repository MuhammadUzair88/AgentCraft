import { AppSidebar } from '@/components/custom/dashboard/AppSidebar'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import React from 'react'

const Dashboardlayout = ({children}:any) => {
  return (
    <SidebarProvider>
        <AppSidebar/>
        <SidebarTrigger/>
        <div>{children}</div>
    </SidebarProvider>
    
  )
}

export default Dashboardlayout