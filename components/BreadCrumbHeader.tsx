"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { HomeIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import React from "react";
import { MobileSidebar } from "./sidebar";

/** Opaque ids (cuids, uuids) don't belong in a breadcrumb — shorten them. */
function crumbLabel(segment: string): string {
  const decoded = decodeURIComponent(segment).replace(/-/g, " ");
  return decoded.length > 16 ? decoded.slice(0, 13) + "…" : decoded;
}

function BreadcrumbHeader() {
  const pathname = usePathname();
  const segments = (pathname ?? "/").split("/").filter(Boolean);

  return (
    <div className="flex items-center gap-1 min-w-0">
      <MobileSidebar />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap text-[13px] sm:text-sm">
          <BreadcrumbItem>
            <BreadcrumbLink
              href="/"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <HomeIcon size={14} className="shrink-0" />
              <span className="hidden sm:inline">Home</span>
            </BreadcrumbLink>
          </BreadcrumbItem>

          {segments.map((segment, i) => {
            const href = "/" + segments.slice(0, i + 1).join("/");
            const isLast = i === segments.length - 1;
            return (
              <React.Fragment key={href}>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  {isLast ? (
                    <BreadcrumbPage className="capitalize font-medium truncate">
                      {crumbLabel(segment)}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      href={href}
                      className="capitalize truncate text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {crumbLabel(segment)}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}

export default BreadcrumbHeader;
