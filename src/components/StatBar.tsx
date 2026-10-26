import type { Node } from "@/lib/api"
import { compact } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The v190 stat bar with v190's own layout and logic: bare in the header,
 * left of the login link, on PC-width screens; as a card in the list page's
 * summary slot below that. Two 17px rows tall, centred: left the server block (🖥 over
 * 离线/在线/总数， the offline slot always reserved — dimmed at 0 — so a
 * dropout never shifts the bar); middle the traffic block (up row over down row, live rate left and
 * cumulative total right); right the busiest and fastest nodes as two-line
 * grids (icon + name over the value, the fastest group's ↓ under its ⚡).
 * Effects follow v190 (see the .stat-bar-v190 block in index.css): shine
 * gradients on the traffic values and node names, the busiest CPU coloured
 * by threshold (>=80 rose, >=50 yellow, else green), icon breathing on
 * v190's triggers (🔥 CPU > 15%, ⚡ download > 1.5MB/s, 🖥 and the offline
 * count while a node is down), bouncing arrows, breathing slashes and
 * aurora dividers. Value slots are fixed-width (6ch rates/totals, 7ch
 * names) so the centred bar does not jitter sideways as values change.
 */
export function V190StatBar({ nodes, className, bare, variant = "stack" }: { nodes: Node[]; className?: string; bare?: boolean; variant?: "stack" | "line" }) {
  let online = 0
  let rxTotal = 0
  let txTotal = 0
  let rxRate = 0
  let txRate = 0
  let busiest: { name: string; cpu: number } | null = null
  let fastest: { name: string; rx: number } | null = null
  for (const node of nodes) {
    rxTotal += node.total_rx
    txTotal += node.total_tx
    if (!node.online) continue
    online++
    const m = node.metrics
    if (!m) continue
    rxRate += m.net_rx
    txRate += m.net_tx
    if (!busiest || m.cpu > busiest.cpu) busiest = { name: node.name, cpu: m.cpu }
    if (!fastest || m.net_rx > fastest.rx) fastest = { name: node.name, rx: m.net_rx }
  }
  const offline = nodes.length - online
  if (variant === "line") {
    // One-line edition for the group-filter row on wide screens: the same
    // blocks and effects as the stacked bar, laid out flat. The offline
    // slot stays reserved and every value keeps a fixed-width slot, so the
    // bar never jitters sideways as figures change.
    return (
      <div className={cn("stat-bar-v190 stat-line-capsule flex flex-nowrap items-center text-xs", className)}>
        <div className="flex shrink-0 items-center whitespace-nowrap" title="Server online status">
          <span aria-hidden="true" className={offline > 0 ? "nz-pulse-icon" : undefined}>🖥️</span>
          <span className={cn("tnum ml-1.5 inline-block min-w-[2ch] text-center", offline > 0 && "nz-pulse-offline text-[#fb7185]")}>{offline > 0 ? offline : ""}</span>
          <span className={cn("nz-slash nz-slash-delay mx-px text-[#a1a1aa]", offline === 0 && "invisible")}>/</span>
          <span className="tnum inline-block min-w-[2ch] text-center text-[#4ade80]">{online}</span>
          <span className="nz-slash mx-px text-[#a1a1aa]">/</span>
          <span className="tnum inline-block min-w-[2ch] text-center text-[#a78bfa]">{nodes.length}</span>
        </div>

        <div className="nz-divider mx-3 shrink-0" aria-hidden="true" />

        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <span aria-hidden="true" className="nz-bounce up text-[15px] leading-none text-[#22d3ee]">↑</span>
          <span title="Live upload speed" className="nz-shine-up tnum inline-block min-w-[6ch]">{compact(txRate)}</span>
          <span title="Total uploaded traffic" className="nz-shine-up tnum inline-block min-w-[6ch]">{compact(txTotal)}</span>
          <span aria-hidden="true" className="nz-bounce ml-1.5 text-[15px] leading-none text-[#fde047]">↓</span>
          <span title="Live download speed" className="nz-shine-down tnum inline-block min-w-[6ch]">{compact(rxRate)}</span>
          <span title="Total downloaded traffic" className="nz-shine-down tnum inline-block min-w-[6ch]">{compact(rxTotal)}</span>
        </div>

        <div className="nz-divider mx-3 shrink-0" aria-hidden="true" />

        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap" title="Busiest node: highest CPU usage">
          <span aria-hidden="true" className={cn(busiest && busiest.cpu > 15 && "nz-pulse-fire")}>🔥</span>
          <span className="nz-shine-busy inline-block w-[8ch] truncate">{busiest?.name ?? "-"}</span>
          <span className="nz-shine-busy tnum inline-block min-w-[5ch]">{busiest ? `${busiest.cpu.toFixed(1)}%` : "-"}</span>
        </div>

        <div className="nz-divider mx-3 shrink-0" aria-hidden="true" />

        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap" title="Fastest node: highest download speed">
          <span aria-hidden="true" className={cn(fastest && fastest.rx > 1.5 * 1024 * 1024 && "nz-pulse-fast")}>⚡</span>
          <span className="nz-shine-fast inline-block w-[8ch] truncate">{fastest?.name ?? "-"}</span>
          <span aria-hidden="true" className="text-[15px] leading-none text-[#fde047]">↓</span>
          <span className="nz-shine-fast tnum inline-block min-w-[6ch]">{fastest ? compact(fastest.rx) : "-"}</span>
        </div>
      </div>
    )
  }
  return (
    <div className={cn("stat-bar-v190 flex flex-nowrap items-center justify-center text-xs", bare ? "" : "overflow-x-auto rounded-2xl border px-3 py-1.5", className)}>
      <div className="flex shrink-0 flex-col items-end leading-[17px]" title="Server online status">
        <div aria-hidden="true" className={offline > 0 ? "nz-pulse-icon" : undefined}>🖥️</div>
        <div className="tnum flex items-center whitespace-nowrap">
          {/* The offline slot is always reserved but stays blank (its
              slash invisible too) while every node is up, so the offline
              figures appear only when a node is actually down — and their
              arrival never widens the counts or shoves the bar sideways. */}
          <span className={cn("inline-block min-w-[2ch] text-center", offline > 0 && "nz-pulse-offline text-[#fb7185]")}>{offline > 0 ? offline : ""}</span>
          <span className={cn("nz-slash nz-slash-delay mx-px text-[#a1a1aa]", offline === 0 && "invisible")}>/</span>
          <span className="inline-block min-w-[2ch] text-center text-[#4ade80]">{online}</span>
          <span className="nz-slash mx-px text-[#a1a1aa]">/</span>
          <span className="inline-block min-w-[2ch] text-center text-[#a78bfa]">{nodes.length}</span>
        </div>
      </div>

      <div className="nz-divider mx-3 shrink-0" aria-hidden="true" />

      <div className="flex shrink-0 flex-col leading-[17px]">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden="true" className="nz-bounce up text-[15px] leading-none text-[#22d3ee]">↑</span>
          <span title="Live upload speed" className="nz-shine-up tnum inline-block min-w-[6ch]">{compact(txRate)}</span>
          <span title="Total uploaded traffic" className="nz-shine-up tnum inline-block min-w-[6ch]">{compact(txTotal)}</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden="true" className="nz-bounce text-[15px] leading-none text-[#fde047]">↓</span>
          <span title="Live download speed" className="nz-shine-down tnum inline-block min-w-[6ch]">{compact(rxRate)}</span>
          <span title="Total downloaded traffic" className="nz-shine-down tnum inline-block min-w-[6ch]">{compact(rxTotal)}</span>
        </div>
      </div>

      <div className="nz-divider mx-3 shrink-0" aria-hidden="true" />

      <div className="grid shrink-0 grid-cols-[auto_minmax(0,auto)] grid-rows-[17px_17px] items-center gap-x-[3px]" title="Busiest node: highest CPU usage">
        <span aria-hidden="true" className={cn("col-start-1 row-start-1 justify-self-center", busiest && busiest.cpu > 15 && "nz-pulse-fire")}>🔥</span>
        <span className="nz-shine-busy col-start-2 row-start-1 w-[7ch] truncate">{busiest?.name ?? "-"}</span>
        <span className="nz-shine-busy tnum col-start-2 row-start-2">{busiest ? `${busiest.cpu.toFixed(1)}%` : "-"}</span>
      </div>

      <div className="nz-divider mx-3 shrink-0" aria-hidden="true" />

      <div className="grid shrink-0 grid-cols-[auto_minmax(0,auto)] grid-rows-[17px_17px] items-center gap-x-[3px]" title="Fastest node: highest download speed">
        <span aria-hidden="true" className={cn("col-start-1 row-start-1 justify-self-center", fastest && fastest.rx > 1.5 * 1024 * 1024 && "nz-pulse-fast")}>⚡</span>
        <span className="nz-shine-fast col-start-2 row-start-1 w-[7ch] truncate">{fastest?.name ?? "-"}</span>
        <span aria-hidden="true" className="col-start-1 row-start-2 justify-self-center text-[15px] leading-none text-[#fde047]">↓</span>
        <span className="nz-shine-fast tnum col-start-2 row-start-2">{fastest ? compact(fastest.rx) : "-"}</span>
      </div>
    </div>
  )
}
