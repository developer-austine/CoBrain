import Logo from '@/components/Logo'
import React from 'react'

function layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-light flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-white px-4 py-10">
      <Logo wordmarkClassName="text-stone-800" />
      {children}
    </div>
  )
}

export default layout
