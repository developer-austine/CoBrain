"use client"

import Logo from '@/components/Logo'
import { ModeToggle } from '@/components/ThemeModeToggle'
import { Separator } from '@/components/ui/separator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { useState } from 'react'

/** Client shell for the connectors area: react-query provider + footer chrome. */
export default function ConnectorsShell({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <div className='flex flex-col h-screen w-full'>
        <QueryClientProvider client={queryClient}>
          {children}
          <Separator />
          <footer className='flex items-center justify-between p-2'>
              <Logo iconSize={25} fontSize='text-xl' />
              <ModeToggle />
          </footer>
        </QueryClientProvider>
    </div>
  )
}
