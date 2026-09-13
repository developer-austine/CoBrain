"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, Radio } from "lucide-react";

/**
 * The Brain's two views.
 *
 * Knowledge is what the brain *knows*; Visualize is what it is *doing right
 * now*. They are separate routes rather than local state so a link to the live
 * map survives a refresh and can be shared.
 */

const TABS = [
  { href: "/brain", label: "Knowledge", icon: Brain },
  { href: "/brain/visualize", label: "Visualize", icon: Radio },
];

export default function BrainTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-4 flex items-center gap-1 border-b"
      style={{ borderColor: "var(--border)" }}
      aria-label="Brain views"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors"
            style={{
              borderColor: active ? "var(--accent)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            <Icon size={14} strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
