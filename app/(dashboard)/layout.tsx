import React from 'react'
import Desktopsidebar from '@/components/sidebar'
import BreadcrumbHeader from '@/components/BreadCrumbHeader'
import { ModeToggle } from '@/components/ThemeModeToggle'
import UserMenu from '@/components/UserMenu'
import { requireOnboarded } from '@/lib/onboarding/guard'

async function layout({children}: {children:React.ReactNode}) {
  await requireOnboarded()
  return (
    <div className='flex h-screen'>
        <Desktopsidebar />
        <div className="flex flex-col flex-1 w-full min-w-0 min-h-screen">
            <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/80 backdrop-blur-md px-3 sm:px-6">
                <BreadcrumbHeader />
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <ModeToggle />
                    <UserMenu />
                </div>
            </header>
            <div className="overflow-auto">
                <div className="flex-1 container py-4 text-accent-foreground">
                    {children}
                </div>
            </div>
        </div>
    </div>
  )
}

export default layout