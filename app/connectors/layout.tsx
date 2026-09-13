import React from 'react'
import { requireOnboarded } from '@/lib/onboarding/guard'
import ConnectorsShell from './_components/ConnectorsShell'

/** Server gate for the connectors area — client chrome lives in ConnectorsShell. */
export default async function ConnectorsLayout({ children }: { children: React.ReactNode }) {
  await requireOnboarded()
  return <ConnectorsShell>{children}</ConnectorsShell>
}
