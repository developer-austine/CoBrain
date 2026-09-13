"use client";

import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  BrainIcon, HomeIcon, Layers2Icon, MenuIcon, MessageCircle,
  ChevronDown, PanelLeftClose, PanelLeftOpen, FolderOpenIcon,
  TrendingUpIcon, GaugeIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';
import Logo from './Logo';
import { cn } from '@/lib/utils';

const SIDEBAR_COLLAPSED_KEY = "cobrain:sidebar-collapsed";
const SIDEBAR_EVENT = "cobrain:sidebar-collapsed-changed";

/**
 * The collapsed preference lives in localStorage, which is an *external store* —
 * reading it in an effect and calling setState would cascade a re-render on every
 * mount. useSyncExternalStore reads it correctly: the server snapshot is
 * "expanded", and the client re-renders once after hydration with the real value.
 */
function subscribeToCollapsed(onChange: () => void) {
  window.addEventListener(SIDEBAR_EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const getCollapsedSnapshot = () =>
  localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";

/** Server (and first client) render: never collapsed, so markup matches. */
const getCollapsedServerSnapshot = () => false;

function setCollapsedPreference(next: boolean) {
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

const routes = [
  { href: "/",           label: "Home",       icon: HomeIcon },
  { href: "/brain",      label: "Brain",      icon: BrainIcon },
  { href: "/sources",    label: "Sources",    icon: FolderOpenIcon },
  { href: "/forecasts",  label: "Forecasts",  icon: TrendingUpIcon },
  { href: "/connectors", label: "Connectors", icon: Layers2Icon },
  { href: "/activity",   label: "Activity",   icon: MessageCircle },
  { href: "/usage",      label: "Usage & Credits", icon: GaugeIcon },
]

const activitySubRoutes = [
  { href: "/activity/chat",     label: "Chat" },
  { href: "/activity/chatlogs", label: "Chat Logs" },
  { href: "/activity/tokens",   label: "Tokens" },
]

/** Below this share of the allowance the nav label gets a warning dot. */
const LOW_BALANCE_RATIO = 0.25;

/**
 * Whether the workspace is running low on credits.
 *
 * Fetched once per mount rather than polled: the dot exists to catch someone's
 * eye on their way somewhere else, and a balance that changed thirty seconds
 * ago does not need to move it. Any failure — unauthenticated, offline, route
 * not deployed — resolves to "not low", because a warning dot that appears
 * because a fetch broke teaches people to ignore warning dots.
 *
 * Deliberately /api/usage/balance and NOT /api/usage/summary. The sidebar is on
 * every dashboard page, so whatever it calls is called on every page view; the
 * summary endpoint builds a projection and sweeps every feature's quota, which
 * is a lot of database work to decide the colour of a 6px dot.
 */
function useLowBalance(): boolean {
  const [low, setLow] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/usage/balance", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { balance?: number; included?: number } | null) => {
        if (cancelled || !data) return;
        const { balance, included } = data;
        if (typeof balance !== "number" || typeof included !== "number") return;
        if (included <= 0) return;
        setLow(balance < included * LOW_BALANCE_RATIO);
      })
      .catch(() => {});

    return () => { cancelled = true };
  }, []);

  return low;
}

/** The amber dot on "Usage & Credits" when the balance is low. */
function LowBalanceDot() {
  return (
    <span
      aria-label="Running low on credits"
      title="Running low on credits"
      className="ml-auto inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: "var(--amber, #D98A0B)" }}
    />
  );
}

/**
 * Shared nav-item styling. The active state is deliberately subtle — a soft
 * tint plus weight, not a saturated gradient — so the eye rests on content
 * rather than the chrome. Collapsed items center their icon on the rail.
 */
const navItemClasses = (opts: { active: boolean; collapsed: boolean }) =>
  cn(
    "flex w-full items-center gap-2.5 h-9 rounded-lg text-sm transition-colors duration-150 outline-none",
    "focus-visible:ring-2 focus-visible:ring-emerald-500/40",
    opts.collapsed ? "justify-center px-0" : "justify-start px-2.5",
    opts.active
      ? "bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium"
      : "font-normal text-stone-600 dark:text-stone-400 hover:bg-stone-900/5 dark:hover:bg-stone-100/5 hover:text-stone-900 dark:hover:text-stone-100"
  );

function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon size={19} className="shrink-0" />;
}

function DesktopSidebar() {
  const pathname = usePathname();
  const activeRoute =
    routes.find(route => route.href !== "/" && pathname.startsWith(route.href))
    || routes[0];

  const [activityOpen, setActivityOpen] = useState(pathname.startsWith("/activity"));
  const lowBalance = useLowBalance();

  const collapsed = useSyncExternalStore(
    subscribeToCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot
  );

  const toggleCollapsed = useCallback(
    () => setCollapsedPreference(!collapsed),
    [collapsed]
  );

  // Collapsed rail: clicking Activity expands the sidebar with its submenu open.
  const expandForActivity = useCallback(() => {
    setCollapsedPreference(false);
    setActivityOpen(true);
  }, []);

  return (
    <div
      className={cn(
        "hidden relative md:flex flex-col h-screen overflow-hidden bg-primary/5 dark:bg-secondary/30 border-r border-border/60 transition-[width,min-width] duration-200 ease-out",
        collapsed ? "w-17 min-w-17" : "w-65 min-w-65"
      )}
    >
      {/* Header: logo + collapse toggle. Collapsed stacks them so both stay centred. */}
      <div
        className={cn(
          "flex items-center border-b border-border/60 p-3",
          collapsed ? "flex-col gap-2" : "justify-between gap-2 px-4"
        )}
      >
        {collapsed ? (
          <Link href="/" title="CoBrain — Home" className="flex items-center justify-center rounded-lg p-1">
            <Image src="/logo.svg" alt="CoBrain" width={26} height={26} />
          </Link>
        ) : (
          <Logo />
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </Button>
      </div>

      <nav className="flex flex-col gap-0.5 p-2">
        {!collapsed && (
          <p className="px-2.5 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 select-none">
            Menu
          </p>
        )}

        {routes.map(route => {
          const isActive = activeRoute.href === route.href;

          // Activity is a disclosure group rather than a plain link.
          if (route.href === "/activity") {
            if (collapsed) {
              return (
                <button
                  key={route.href}
                  onClick={expandForActivity}
                  title={route.label}
                  className={navItemClasses({ active: isActive, collapsed: true })}
                >
                  <NavIcon icon={route.icon} />
                </button>
              );
            }
            return (
              <div key={route.href}>
                <button
                  onClick={() => setActivityOpen(prev => !prev)}
                  className={cn(
                    navItemClasses({ active: isActive, collapsed: false }),
                    "justify-between"
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <NavIcon icon={route.icon} />
                    {route.label}
                  </span>
                  <ChevronDown
                    size={15}
                    className={cn(
                      "transition-transform duration-200 opacity-60",
                      activityOpen && "rotate-180"
                    )}
                  />
                </button>

                {activityOpen && (
                  <div className="mt-0.5 flex flex-col gap-0.5 pl-8.5">
                    {activitySubRoutes.map(sub => (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        className={cn(
                          "flex h-8 items-center rounded-lg px-2.5 text-[13px] transition-colors duration-150",
                          pathname === sub.href
                            ? "bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium"
                            : "text-stone-500 dark:text-stone-400 hover:bg-stone-900/5 dark:hover:bg-stone-100/5 hover:text-stone-900 dark:hover:text-stone-100"
                        )}
                      >
                        {sub.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          }

          return (
            <Link
              key={route.href}
              href={route.href}
              title={collapsed ? route.label : undefined}
              className={navItemClasses({ active: isActive, collapsed })}
            >
              <NavIcon icon={route.icon} />
              {!collapsed && route.label}
              {!collapsed && route.href === "/usage" && lowBalance && <LowBalanceDot />}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

export function MobileSidebar() {
  const [isOpen, setOpen] = useState(false)
  const pathname = usePathname();
  const activeRoute =
    routes.find(route => route.href !== "/" && pathname.startsWith(route.href))
    || routes[0];

  const [activityOpen, setActivityOpen] = useState(pathname.startsWith("/activity"));
  const lowBalance = useLowBalance();

  return (
    <div className="md:hidden">
      <nav className="flex items-center">
        <Sheet open={isOpen} onOpenChange={setOpen}>
          <SheetTrigger render={<Button variant={"ghost"} size={"icon"} />}>
            <MenuIcon />
          </SheetTrigger>
          <SheetContent className="w-70 space-y-4" side={"left"}>
            <Logo />
            <div className="flex flex-col gap-0.5">
              {routes.map(route => {
                const isActive = activeRoute.href === route.href;

                if (route.href === "/activity") {
                  return (
                    <div key={route.href}>
                      <button
                        onClick={() => setActivityOpen(prev => !prev)}
                        className={cn(
                          navItemClasses({ active: isActive, collapsed: false }),
                          "justify-between"
                        )}
                      >
                        <span className="flex items-center gap-2.5">
                          <NavIcon icon={route.icon} />
                          {route.label}
                        </span>
                        <ChevronDown
                          size={15}
                          className={cn(
                            "transition-transform duration-200 opacity-60",
                            activityOpen && "rotate-180"
                          )}
                        />
                      </button>

                      {activityOpen && (
                        <div className="mt-0.5 flex flex-col gap-0.5 pl-8.5">
                          {activitySubRoutes.map(sub => (
                            <Link
                              key={sub.href}
                              href={sub.href}
                              onClick={() => setOpen(false)}
                              className={cn(
                                "flex h-8 items-center rounded-lg px-2.5 text-[13px] transition-colors duration-150",
                                pathname === sub.href
                                  ? "bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium"
                                  : "text-stone-500 dark:text-stone-400 hover:bg-stone-900/5 dark:hover:bg-stone-100/5"
                              )}
                            >
                              {sub.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <Link
                    key={route.href}
                    href={route.href}
                    onClick={() => setOpen(false)}
                    className={navItemClasses({ active: isActive, collapsed: false })}
                  >
                    <NavIcon icon={route.icon} />
                    {route.label}
                    {route.href === "/usage" && lowBalance && <LowBalanceDot />}
                  </Link>
                )
              })}
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  )
}

export default DesktopSidebar;
