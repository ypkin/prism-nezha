import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, Moon, Sun } from "lucide-react"

import { IpCard } from "@/components/IpCard"
import { NodePicker } from "@/components/NodePicker"
import { ServerTable } from "@/components/ServerTable"
import { DotMap } from "@/components/DotMap"
import { V190StatBar } from "@/components/StatBar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api, useNodes } from "@/lib/api"
import { Link, navigate, useNodeRoute } from "@/lib/route"
import { useEdgeSwipeBack } from "@/lib/swipe-back"

type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean }

// Split out because recharts is most of the bundle and the list draws no chart.
// Warm only on navigation intent; visitors reading the list do not need recharts.
const loadDetail = () => import("@/components/NodeDetail").then((m) => ({ default: m.NodeDetail }))
const NodeDetail = lazy(loadDetail)

/**
 * The visitor's own choice, or dark while there is none. Only the toggle
 * writes the choice down: persisting a default on load would pin it, leaving
 * a visitor who never touched the toggle stuck with whatever was written.
 * The panel at `/admin/` shares this key on one origin, so it has to hold to
 * the same rule -- one app writing on load pins the others.
 *
 * The default used to follow the system theme; the live build has forced
 * dark since the 2026-10-24 on-server patch (ported back into source the
 * same day), so an unchosen visit is always dark now.
 */
function useTheme() {
  const [saved, setSaved] = useState<"light" | "dark" | null>(() => {
    try {
      const value = localStorage.getItem("theme")
      return value === "light" || value === "dark" ? value : null
    } catch {
      // Storage can be disabled for this origin; still default to dark.
      return null
    }
  })
  const dark = saved ? saved === "dark" : true

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  return [
    dark,
    () => {
      const next = dark ? "light" : "dark"
      setSaved(next)
      try {
        localStorage.setItem("theme", next)
      } catch {
        // A blocked or full storage must not prevent switching in this tab.
      }
    },
  ] as const
}

/** Kept in the corner rather than the header, as the classic layout does. */
function Toolbox({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const sync = () => setScrolled(scrollY > 200)
    addEventListener("scroll", sync, { passive: true })
    return () => removeEventListener("scroll", sync)
  }, [])
  const style = "once-tool-button size-10 rounded-xl max-md:size-9"
  return (
    <div className="fixed right-3 bottom-5 z-20 flex flex-col gap-2.5 max-md:bottom-3">
      {scrolled && (
        <Button variant="ghost" size="icon" className={style} title="Back to top" onClick={() => scrollTo({ top: 0, behavior: "smooth" })}>
          <ArrowUp />
        </Button>
      )}
      <Button variant="ghost" size="icon" className={style} title="Toggle theme" onClick={toggle}>
        {dark ? <Sun /> : <Moon />}
      </Button>
    </div>
  )
}


export default function App() {
  const [dark, toggleTheme] = useTheme()
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState("")
  const meRequest = useRef<AbortController | null>(null)
  const { nodes, error, closed } = useNodes()
  const open = useNodeRoute()
  const swipeBack = useEdgeSwipeBack(() => navigate("/"))

  const loadMe = useCallback(() => {
    meRequest.current?.abort()
    const controller = new AbortController()
    meRequest.current = controller
    // `|| "..."`: HTTP/2 has no statusText, so a bodiless 502 from a proxy arrives
    // as "" and would otherwise render as still loading, with no retry button.
    return api<Me>("/me", { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) { setMe(next); setMeError("") } })
      .catch((e: Error) => { if (!controller.signal.aborted) setMeError(e.message || "Network error") })
  }, [])

  useEffect(() => {
    void loadMe()
    return () => meRequest.current?.abort()
  }, [loadMe])

  // The status page was closed while this tab was open: re-query, so the effect
  // below sends an anonymous visitor to the panel instead of a list that stopped.
  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])

  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  const sorted = useMemo(() => [...(nodes ?? [])].sort((a, b) => b.sort - a.sort || a.id - b.id), [nodes])
  const selected = sorted.find((n) => n.id === open)
  const site = me?.site_name || "Monitor"

  useEffect(() => {
    document.title = [selected?.name, site].filter(Boolean).join(" · ")
  }, [selected?.name, site])

  if (!me) return (
    <div className="grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
      {meError ? <div className="space-y-3 text-center"><p role="alert">Failed to load: {meError}</p><Button onClick={loadMe}>Retry</Button></div> : "Loading..."}
    </div>
  )

  if (!me.public_page && !me.authed) return null

  return (
    <div className="app-shell relative isolate flex min-h-svh flex-col overflow-x-clip">
      <div className="once-backdrop fixed inset-0 z-0 pointer-events-none" aria-hidden="true" />
      <header className="once-header sticky top-0 z-20">
        <div className="once-header-inner mx-auto flex h-14 w-[95vw] max-w-[1320px] items-center px-1 max-md:w-full max-md:px-1">
          <Link href="/" className="once-brand mr-5 flex shrink-0 items-center gap-2 px-1 text-[17px] max-sm:mr-2">
            <span className="brand-rainbow font-medium tracking-[-0.02em] whitespace-nowrap">{site}</span>
          </Link>
          <div className="flex-1" aria-hidden="true" />
          {/* The stat bar rides in the header on every screen, on the same
              line as the brand, right-aligned. */}
          <div className="mr-1 min-w-0 shrink-0 max-md:mr-0 max-md:[zoom:.9] xl:hidden">
            {nodes && sorted.length > 0 && <V190StatBar nodes={sorted} bare className="max-lg:text-[11px]" />}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-[95vw] max-w-[1320px] flex-1 space-y-4 pt-5 pb-12 max-md:w-full max-md:px-1 max-md:pt-3 max-md:pb-16">
        {error && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {error}
          </p>
        )}

        {!nodes ? (
          <Skeleton className="h-80" />
        ) : open === null ? (
          sorted.length === 0 ? (
            <p className="rounded-md border bg-card py-16 text-center text-sm text-muted-foreground">No nodes yet</p>
          ) : (
            <>
              <ServerTable nodes={sorted} />
              <DotMap nodes={sorted} />
            </>
          )
        ) : selected ? (
          <div {...swipeBack} className="monitor-shell grid gap-3 text-card-foreground md:grid-cols-[220px_minmax(0,1fr)] md:gap-4">
            <NodePicker nodes={sorted} selected={selected.id} />
            <div className="min-w-0">
              <Suspense fallback={<Skeleton className="h-96" />}>
                <NodeDetail node={selected} />
              </Suspense>
            </div>
          </div>
        ) : (
          <p className="rounded-md border bg-card py-16 text-center text-sm text-muted-foreground">
            This node does not exist or is not public. <Link href="/" className="text-primary hover:underline">Back to list</Link>
          </p>
        )}
      </main>

      <footer className="relative z-10 pb-8 pt-1 text-center text-xs text-muted-foreground">© {site} | <a href="https://github.com/ypkin/prism-nezha" target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-foreground">Prism</a> | Powered by Nezha Monitor 0.20.28</footer>

      <IpCard />
      <Toolbox dark={dark} toggle={toggleTheme} />
    </div>
  )
}
