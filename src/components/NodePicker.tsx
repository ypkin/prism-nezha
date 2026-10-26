import { useState } from "react"

import { Dot, Flag } from "@/components/ServerTable"
import { Input } from "@/components/ui/input"
import type { Node } from "@/lib/api"
import { Link } from "@/lib/route"

/**
 * The chart page's node list. Switching here keeps the chosen range, so one
 * window can be compared across nodes; the search keeps a fleet of a hundred
 * within a few keystrokes.
 */
export function NodePicker({ nodes, selected }: { nodes: Node[]; selected: number }) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const shown = q ? nodes.filter((n) => `${n.name} ${n.country} ${n.os}`.toLowerCase().includes(q)) : nodes

  return (
    <aside className="node-picker flex min-h-0 flex-col max-md:hidden rounded-2xl border border-border/55 p-2 max-md:max-h-56 md:sticky md:top-16 md:max-h-[calc(100svh-6rem)] md:self-start">
      <Input type="search" placeholder="Search nodes..." value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 rounded-xl border-border bg-background shadow-none" />
      <nav className="mt-2 flex min-h-0 flex-col gap-1 overflow-y-auto pr-0.5">
        {shown.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No matching nodes</p>}
        {shown.map((n) => (
          <Link
            key={n.id}
            href={`/node/${n.id}`}
            aria-current={n.id === selected ? "page" : undefined}
            className="monitor-node-link flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm transition-colors"
          >
            <Dot node={n} className="monitor-status-dot" />
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            <Flag code={n.country} className="ml-auto text-xs text-muted-foreground" />
          </Link>
        ))}
      </nav>
    </aside>
  )
}
