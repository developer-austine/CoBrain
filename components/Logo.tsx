import { cn } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'
import React from 'react'

/**
 * The wordmark on its own — no icon, no link.
 *
 * Exported so surfaces that need the brand as a mark rather than as navigation
 * (the chart's corner signature, for instance) share these exact colours
 * instead of re-declaring them. One definition means the gradient can never
 * drift between the sidenav and everywhere else.
 */
export function Wordmark({
    className = "",
    wordmarkClassName = "text-stone-700 dark:text-stone-300",
}: {
    className?: string,
    wordmarkClassName?: string,
}) {
  return (
    <span className={cn("font-extrabold leading-none select-none", className)}>
        <span className="bg-linear-to-r from-emerald-500 to-emerald-600 bg-clip-text text-transparent">
            Co
        </span>
        <span className={wordmarkClassName}>Brain</span>
    </span>
  );
}

function Logo({
    fontSize = "text-2xl",
    iconSize = 35,
    wordmarkClassName = "text-stone-700 dark:text-stone-300",
}: {
    fontSize?: string,
    iconSize?: number,
    wordmarkClassName?: string,
}) {
  return (
    <div>
        <Link href="/" className={cn("flex text-2xl font-extrabold items-center gap-2", fontSize)}
        >
            <div className="rounded-xl p-2">
               <Image
                    src="/logo.svg"
                    alt="Logo"
                    width={iconSize}
                    height={iconSize}
                    className="text-white"
                />
            </div>
            <Wordmark wordmarkClassName={wordmarkClassName} />
        </Link>
    </div>
  )
}

export default Logo