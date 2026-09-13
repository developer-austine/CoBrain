import React from "react";
import DesktopSidebar, { MobileSidebar } from "@/components/sidebar";
import { requireOnboarded } from "@/lib/onboarding/guard";

/**
 * Activity shell: the app sidenav beside full-bleed activity pages
 * (live chat, chat logs). Pages fill the remaining viewport and manage
 * their own internal scrolling.
 */
export default async function ActivityLayout({ children }: { children: React.ReactNode }) {
  await requireOnboarded();
  return (
    <div className="flex h-screen overflow-hidden">
      <DesktopSidebar />
      <div className="flex flex-col flex-1 min-w-0 h-full">
        <MobileSidebar />
        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
  );
}
