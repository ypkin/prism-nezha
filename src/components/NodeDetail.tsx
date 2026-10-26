import { memo, useEffect, useMemo, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import {
  Area, AreaChart, Brush, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts"

import { Skeleton } from "@/components/ui/skeleton"
import { Dot, Flag, OsIcon } from "@/components/ServerTable"
import { api, type Node } from "@/lib/api"
import {
  axisBytes, axisTop, bytes, clockFor, despike, distro, quarters, rate, timeTicks,
} from "@/lib/format"
import { cn } from "@/lib/utils"

type Point = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  /** Hub 1.3.1 peak rate within this history bucket; absent on older hubs. */
  net_rx_max?: number
  net_tx_max?: number
}
// `latency` is the bucket's median round trip, null when every probe in it timed
// out. `band` is the range its answers spanned, absent when they spanned nothing.
// `loss` is the percentage that timed out, absent when none did.
type PingPoint = {
  task_id: number
  ts: number
  latency: number | null
  band?: [number, number]
  loss?: number
}
/** Probe names by id, sent alongside the samples they label. */
type Probes = Record<string, string>
/**
 * Proportion of the whole window each probe lost, by id, absent for probes that
 * lost nothing. Sent because it cannot be derived here: every bucket's `loss` is
 * already a percentage of that bucket, so the sample counts it was divided by are
 * unavailable. Averaging them would weight a bucket holding one sample equally
 * with one holding twelve, and the window's first and last buckets are partial
 * regardless of what the probe does.
 */
type Loss = Record<string, number>

const RANGES = [
  { hours: 1, label: "1h" },
  { hours: 12, label: "12h" },
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" },
]

const CHART_TABS = [
  { key: "cpu", label: "CPU" },
  { key: "memory", label: "Memory" },
  { key: "network", label: "Network" },
  { key: "disk", label: "Disk" },
  { key: "latency", label: "Latency" },
] as const
type ChartTab = (typeof CHART_TABS)[number]["key"]

// The compact drawer defaults to one hour; the monitoring page supplies its
// shared range so resource and carrier charts show the same window.
const DEFAULT_LATENCY_HOURS = 24

const AXIS = { stroke: "currentColor", fontSize: 12, tickLine: false, axisLine: false }

// No grow-in animation: it would spend 1.5 s drawing a line across the panel on
// every range change, on a page meant to be read at a glance, and on the latency
// chart across seven hundred points per probe.
const SERIES = { dot: false as const, strokeWidth: 1.5, isAnimationActive: false }
const SOFT_SERIES = {
  ...SERIES,
  type: "monotoneX" as const,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
}

// One width for every stacked panel's value axis. Sized to their own labels --
// 40px under "100%", 68px under "172 MB" -- the four plot areas would be offset by
// 28px, placing a CPU spike and the network spike that caused it at different x.
const Y_WIDTH = 68

// Each carrier probe gets its own colour, split by address family, so the
// latency lines can be told apart at a glance: v4 and v6 of the same carrier
// no longer share one colour. Unknown/custom probes still fall back to the
// theme chart palette.
const PALETTE = [1, 2, 3, 4, 5].map((i) => `var(--color-chart-${i})`)
const PROBE_COLORS: Record<"unicom" | "mobile" | "telecom", { v4: string; v6: string }> = {
  unicom: { v4: "#38BDF8", v6: "#C084FC" },
  mobile: { v4: "#FA471E", v6: "#2BEA5E" },
  telecom: { v4: "#FACC15", v6: "#F472B6" },
}

function probeColor(name: string, fallbackIndex: number) {
  const key = name.toLowerCase()
  const family = key.includes("v6") ? "v6" : "v4"
  if (key.includes("联通") || key.includes("unicom")) return PROBE_COLORS.unicom[family]
  if (key.includes("移动") || key.includes("mobile")) return PROBE_COLORS.mobile[family]
  if (key.includes("电信") || key.includes("telecom")) return PROBE_COLORS.telecom[family]
  return PALETTE[Math.max(0, fallbackIndex) % PALETTE.length]
}

// recharts paints its tooltip white unless told otherwise, which is a white box
// on the dark theme.
const TIP = {
  fontSize: 12,
  background: "var(--color-popover)",
  color: "var(--color-popover-foreground)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
}

function Panel({ title, children, tall = false }: { title: React.ReactNode; children: React.ReactNode; tall?: boolean }) {
  return (
    <section className="monitor-chart-card rounded-2xl border border-border/55 p-3 md:p-4">
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h4>
      <div className={tall ? "h-72 w-full text-muted-foreground md:h-80" : "h-44 w-full text-muted-foreground"}>{children}</div>
    </section>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="monitor-range-tab shrink-0 rounded-full border px-3.5 py-1.5 text-xs whitespace-nowrap transition-colors"
    >
      {children}
    </button>
  )
}

type History = { metrics: Point[]; ping: PingPoint[]; probes: Probes; loss?: Loss }

/**
 * One window of history.
 *
 * A refused request is kept apart from an empty window. The hub builds at most
 * four windows at once, since each holds the connection the agents report
 * through, and answers a fifth with a 503; drawn as an empty chart, that answer
 * would misdirect the reader, so callers show it with a retry.
 */
function useHistory(id: number, hours: number, series: "metrics" | "ping") {
  const [data, setData] = useState<History | null>(null)
  const [failed, setFailed] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    // The charts must not continue drawing the old window while the new one is in
    // flight.
    // oxlint-disable-next-line react/set-state-in-effect
    setData(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setFailed("")
    // Bound samples to what the charts can resolve. A device pixel ratio above
    // two does not make a narrow SVG chart wider, but costs more paths and data.
    const points = Math.min(1200, Math.max(320, Math.round(globalThis.innerWidth * Math.min(globalThis.devicePixelRatio || 1, 2))))
    api<History>(`/nodes/${id}/metrics?hours=${hours}&points=${points}&series=${series}`, { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setData(next) })
      .catch((e: Error) => {
        // `|| "..."` as in App.tsx: HTTP/2 dropped statusText, so a bodiless
        // failure from a proxy arrives as the empty string and renders as no
        // error.
        if (!controller.signal.aborted) { setFailed(e.message || "Network error"); setData({ metrics: [], ping: [], probes: {} }) }
      })
    return () => controller.abort()
  }, [id, hours, series, attempt])

  return { data, failed, retry: () => setAttempt((n) => n + 1) }
}

function Failed({ message, retry }: { message: string; retry: () => void }) {
  return (
    <p className="py-8 text-center text-sm text-destructive" role="alert">
      Failed to load history: {message}
      <button onClick={retry} className="ml-2 text-primary hover:underline">Retry</button>
    </p>
  )
}

/**
 * How many samples of a probe's own series make up seven minutes of neighbours.
 *
 * The window the filter judges against has to be a duration, not a count: the
 * hub buckets a window to the `points` asked for above, so the same day arrives
 * as one-minute buckets on a desktop and two-minute ones on a phone, and a fixed
 * count would clip a five-minute stall on the first while keeping it on the
 * second. The smallest gap is the bucket interval; a longer one is the node
 * being offline. Odd, so the window has a middle, and bounded so a sparse probe
 * still has neighbours and a dense one does not pay for a wide sort.
 */
function despikeWindow(points: { ts: number }[]): number {
  let step = Infinity
  for (let i = 1; i < points.length; i++) step = Math.min(step, points[i].ts - points[i - 1].ts)
  return Math.min(15, Math.max(3, Math.round(420 / step) | 1))
}

// Smooth a short run of neighbouring answers without drawing through timeouts
// or an offline gap. The underlying samples stay intact for the tooltip.
// Smallest positive gap between consecutive samples: the bucket interval.
function minStep(points: { ts: number }[]): number {
  let step = Infinity
  for (let i = 1; i < points.length; i++) {
    const gap = points[i].ts - points[i - 1].ts
    if (gap > 0) step = Math.min(step, gap)
  }
  return step
}

function smoothPing(points: PingPoint[], values: (number | null)[], radius: number): (number | null)[] {
  const step = minStep(points)
  if (!Number.isFinite(step)) return values
  return values.map((value, i) => {
    if (value === null) return null
    let sum = value * (radius + 1)
    let weight = radius + 1
    for (const direction of [-1, 1]) {
      let previous = i
      for (let offset = 1; offset <= radius; offset++) {
        const next = i + direction * offset
        if (next < 0 || next >= values.length || values[next] === null || Math.abs(points[next].ts - points[previous].ts) > step * 2.5) break
        const part = radius + 1 - offset
        sum += values[next]! * part
        weight += part
        previous = next
      }
    }
    return sum / weight
  })
}

type MetricRow = Point & {
  cpu_trend: number
  mem_trend: number
  disk_trend: number
  rx_trend: number
  tx_trend: number
  rx_peak: number | null
  tx_peak: number | null
}

// A short weighted window softens sample-to-sample jitter while the tooltip
// continues to report the original reading. Never average across an offline gap.
function smoothMetric(points: Point[], key: "cpu" | "mem_used" | "disk_used" | "net_rx" | "net_tx", radius: number): number[] {
  const step = minStep(points)
  return points.map((point, i) => {
    let sum = point[key] * (radius + 1)
    let weight = radius + 1
    for (const direction of [-1, 1]) {
      let previous = i
      for (let offset = 1; offset <= radius; offset++) {
        const next = i + direction * offset
        if (next < 0 || next >= points.length || Math.abs(points[next].ts - points[previous].ts) > step * 2.5) break
        const part = radius + 1 - offset
        sum += points[next][key] * part
        weight += part
        previous = next
      }
    }
    return sum / weight
  })
}

// A real time axis rather than the category axis recharts defaults to: on a
// category axis ticks are selected by index, so a period the agent was offline for
// collapses to nothing.
function timeAxis(rows: { ts: number }[], hours: number, from = 0, to = rows.length - 1) {
  return {
    dataKey: "ts",
    type: "number" as const,
    domain: ["dataMin", "dataMax"] as const,
    // Explicit, or recharts places them at 05:14 and 10:22. Any that still collide
    // are dropped by `minTickGap`.
    ticks: rows.length ? timeTicks(rows[from].ts, rows[to].ts) : undefined,
    tickFormatter: clockFor(hours),
    minTickGap: hours > 24 ? 72 : 40,
    ...AXIS,
  }
}

/**
 * Every probe's round trip to one node, as the chart page and the table's
 * expanded row both draw it: the legend above, sized to its chips, and the plot
 * with its brush below at the height `className` gives it.
 */
function LatencyView({ id, className, hours = DEFAULT_LATENCY_HOURS, toolbar }: { id: number; className?: string; hours?: number; toolbar?: React.ReactNode }) {
  const { data, failed, retry } = useHistory(id, hours, "ping")
  // Probes switched off. Hiding a slow one is what makes the fast ones readable,
  // as the axis rescales to what remains.
  const [hiddenProbes, setHiddenProbes] = useState<number[]>([])
  // The trend is easier to read by default; the button restores raw answers.
  const [smooth, setSmooth] = useState(true)
  // Spikes pulled back to their neighbourhood. Off by default: the raw round
  // trips answer whether the node stalled; on, a single 2 s bucket stops
  // setting the axis for the day around it.
  const [despiked, setDespiked] = useState(false)
  // Where the brush has been dragged, so the axis reticks for the visible span.
  // Tagged with the window it was dragged on, so a new window starts unzoomed
  // without an effect to clear it.
  const [zoom, setZoom] = useState<{ of: History; range: [number, number] } | null>(null)

  // One series per probe that reported, labelled from the names the samples
  // arrived with. Memoised, as are the two below: the parent re-renders every few
  // seconds as live metrics arrive, and rebuilding the chart's data array on those
  // renders would reset the brush.
  const pingSeries = useMemo(
    () =>
      [...new Set((data?.ping ?? []).map((p) => p.task_id))]
        .map((id) => {
          // Timeouts are retained: dropping them would draw a probe losing half
          // its packets as an unbroken line, and one that never answered not at
          // all.
          const points = (data?.ping ?? []).filter((p) => p.task_id === id)
          // Taken from the hub rather than summed from the buckets above, each of
          // which is already a percentage of its own bucket, so averaging them
          // would report one lost round in thirteen as 50%.
          const loss = data?.loss?.[id] ?? 0
          return { id, name: data?.probes?.[id] ?? `Probe ${id}`, points, loss }
        })
        .filter((s) => s.points.length > 0),
    [data],
  )

  const shownProbes = useMemo(
    () => pingSeries.filter((s) => !hiddenProbes.includes(s.id)),
    [pingSeries, hiddenProbes],
  )
  // Keyed on the full list, so a line keeps its colour when others are hidden.
  const color = (id: number) => {
    const index = pingSeries.findIndex((p) => p.id === id)
    return probeColor(index >= 0 ? pingSeries[index].name : "", index)
  }
  // Which series the chart draws, from the two filters: raw, despiked, smoothed,
  // or smoothed after despiking.
  const lineKey = (id: number) => `${despiked ? (smooth ? "s" : "d") : (smooth ? "r" : "t")}${id}`

  // The hub stamps every sample with its bucket rather than the second the probe
  // finished, so probes reporting at the bucket's rate share rows instead of each
  // contributing its own: a day of four probes is 717 rows rather than 2,868. A
  // slower probe leaves gaps in its own column, which is what `connectNulls`
  // addresses.
  //
  // Every probe, and both versions of every sample, are held here whether or not
  // they are on screen: recharts resets the brush when the data array changes
  // identity, and re-reads a controlled selection only when the index props
  // change, which they do not. Hiding a probe or clipping the spikes therefore
  // selects a `dataKey` rather than rebuilding the array.
  const pingRows = useMemo(() => {
    const rows = new Map<
      number,
      { ts: number } & Record<string, number | [number, number] | null>
    >()
    for (const s of pingSeries) {
      const windowSize = despikeWindow(s.points)
      const raw = s.points.map((p) => p.latency)
      const desp = despike(raw, windowSize)
      const lineS = smoothPing(s.points, desp, hours <= 6 ? 2 : 1)
      const lineR = smoothPing(s.points, raw, hours <= 6 ? 2 : 1)
      // The band spans the same outliers as the line, and with one probe on
      // screen it is what the axis is fitted to, so it is clipped alongside it
      // rather than left to pull the axis back open.
      const lo = despike(s.points.map((p) => p.band?.[0] ?? p.latency), windowSize)
      const hi = despike(s.points.map((p) => p.band?.[1] ?? p.latency), windowSize)
      s.points.forEach((p, i) => {
        const row = rows.get(p.ts) ?? { ts: p.ts * 1_000 }
        row[`t${s.id}`] = p.latency
        row[`d${s.id}`] = desp[i]
        row[`s${s.id}`] = lineS[i]
        row[`r${s.id}`] = lineR[i]
        row[`l${s.id}`] = p.loss ?? 0
        // A bucket with a single answer carries no band and spans only that answer. Left null, `connectNulls`
        // would bridge the hours between the few buckets that have one: 9 of
        // 1,438 in a day, the widest gap 268 minutes, drawn as one large wedge.
        row[`b${s.id}`] = p.band ?? (p.latency === null ? null : [p.latency, p.latency])
        // Taken as the span of three filtered series rather than a pair: the two
        // edges are filtered independently, so a bucket that answered slightly
        // faster than usual can trip the low edge alone and come back above the
        // high one -- [180, 178] against a line of 176, drawn backwards with the
        // line outside it.
        const [low, high] = [lo[i], hi[i]]
        row[`c${s.id}`] =
          low === null || high === null
            ? null
            : [Math.min(low, high, lineS[i] ?? low), Math.max(low, high, lineS[i] ?? high)]
        rows.set(p.ts, row)
      })
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [pingSeries, hours])

  if (!data) return <Skeleton className={cn("w-full", className)} />
  if (failed) return <Failed message={failed} retry={retry} />
  if (pingSeries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No latency data for this period</p>
  }
  const last = pingRows.length - 1
  const [from, to] = zoom?.of === data ? zoom.range.map((i) => Math.min(i, last)) : [0, last]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 max-md:gap-x-2">
        {toolbar}
        <div className="flex flex-wrap items-center gap-1.5 max-md:order-3 max-md:w-full max-md:flex-nowrap max-md:gap-1 md:ml-auto md:gap-2">
        {pingSeries.map((s) => {
          const shown = !hiddenProbes.includes(s.id)
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={shown}
              onClick={() =>
                setHiddenProbes((h) => (shown ? [...h, s.id] : h.filter((id) => id !== s.id)))
              }
              className={cn(
                "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-all hover:bg-muted max-md:min-w-0 max-md:flex-1 max-md:justify-center max-md:gap-1 max-md:px-1 max-md:whitespace-nowrap max-md:text-[11px]",
                !shown ? "border-dashed border-border/60 opacity-40" : "border-border/80 bg-card",
              )}
            >
              {/* The swatch carries the same colour as the line. */}
              <span className="inline-flex items-center gap-1.5 max-md:gap-0.5">
                <svg width="14" height="6" className="shrink-0 max-md:w-2" aria-hidden>
                  <line x1="0" y1="3" x2="14" y2="3" stroke={color(s.id)} strokeWidth="2" />
                </svg>
                {s.name}
              </span>
              {/* Always shown, since the line is only what answered and a probe
                  dropping half its packets draws like a healthy one. Anything
                  under a tenth is written as such rather than rounded to 0.0.
                  Mobile shows the compact integer form so all four chips fit
                  on one row without wrapping. */}
              <span className="tnum font-normal text-muted-foreground max-md:hidden">
                {s.loss > 0 && s.loss < 0.1 ? "<0.1" : s.loss.toFixed(1)}%
              </span>
              <span className="tnum font-normal text-muted-foreground hidden max-md:inline">
                {s.loss > 0 && s.loss < 0.1 ? "<0.1" : s.loss.toFixed(0)}%
              </span>
            </button>
          )
        })}
        </div>
        <div className="flex gap-1 max-md:ml-auto max-md:shrink-0">
          <button
            type="button"
            onClick={() => setDespiked((on) => !on)}
            aria-pressed={despiked}
            title="把孤立的异常值换成邻近若干桶的中位数，持续的变化保持原样"
            className={cn("inline-flex h-5 items-center justify-center rounded-md border px-2 text-xs font-medium whitespace-nowrap max-md:px-1.5", despiked ? "border-orange-500 bg-orange-500 text-white" : "border-input bg-transparent")}
          >
            削峰
          </button>
          <button
            type="button"
            onClick={() => setSmooth((on) => !on)}
            aria-pressed={smooth}
            title="平滑趋势线；关掉看原始值，悬停仍显示实测值"
            className={cn("inline-flex h-5 items-center justify-center rounded-md border px-2 text-xs font-medium whitespace-nowrap max-md:px-1.5", smooth ? "border-orange-500 bg-orange-500 text-white" : "border-input bg-transparent")}
          >
            平滑
          </button>
        </div>
      </div>

      <div className={cn("w-full text-muted-foreground", className)}>
        {shownProbes.length === 0 ? (
          <p className="py-8 text-center text-sm">No probes selected</p>
        ) : (
          <ResponsiveContainer>
            <ComposedChart data={pingRows}>
              <defs>
                {shownProbes.map((s) => (
                  <linearGradient key={s.id} id={`ping-glow-${id}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color(s.id)} stopOpacity={hours === 1 ? 0.14 : 0.08} />
                    <stop offset="100%" stopColor={color(s.id)} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="2 6" className="stroke-border" strokeOpacity={0.55} vertical={false} />
              <XAxis {...timeAxis(pingRows, hours, from, to)} />
              {/* Not anchored at zero: these lines live in a narrow band far from
                  it, and zero flattens every wobble. */}
              <YAxis unit="ms" width={52} domain={["auto", "auto"]} {...AXIS} />
              <Tooltip
                labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                // The line is drawn from what answered, so without this a bucket
                // that lost most of its packets reads as normal. `dataKey` is
                // `t7`; the loss sits at `l7`.
                //
                // Rounded because a clipped sample carries the median of an even
                // window, which falls between two of the whole milliseconds the
                // hub stores.
                formatter={(v, name, item) => {
                  const probe = String(item.dataKey).slice(1)
                  const loss = Number(item?.payload?.[`l${probe}`] ?? 0)
                  const measured = item?.payload?.[`t${probe}`]
                  const reading = smooth && typeof measured === "number" && Math.round(measured) !== Math.round(Number(v))
                    ? `${Math.round(measured)} ms (trend ${Math.round(Number(v))} ms)`
                    : `${Math.round(Number(v))} ms`
                  return [`${reading}${loss > 0 ? ` · 丢 ${loss}%` : ""}`, name]
                }}
                contentStyle={TIP}
              />
              {/* Behind the line, the range that bucket's answers spanned --
                  Smokeping's "smoke". At the day window a bucket moves 63 ms at
                  the 90th percentile against the 25 ms the trend moves, so a line
                  alone draws the smaller of the two.

                  Only with one probe on screen: rendered for four, the bands
                  overlap into a fog and their extremes drag the axis from 165-385
                  out to 140-420. */}
              {shownProbes.length === 1 &&
                shownProbes.map((s) => (
                  <Area
                    key={`band${s.id}`}
                    dataKey={`${despiked ? "c" : "b"}${s.id}`}
                    type="monotoneX"
                    stroke="none"
                    fill={color(s.id)}
                    fillOpacity={0.16}
                    isAnimationActive={false}
                    tooltipType="none"
                    legendType="none"
                    connectNulls
                  />
                ))}
              {shownProbes.length > 1 && shownProbes.map((s) => (
                <Area
                  key={`glow${s.id}`}
                  dataKey={lineKey(s.id)}
                  type="monotoneX"
                  stroke="none"
                  fill={`url(#ping-glow-${id}-${s.id})`}
                  baseValue="dataMin"
                  isAnimationActive={false}
                  tooltipType="none"
                  legendType="none"
                  connectNulls
                />
              ))}
              {shownProbes.map((s) => (
                <Line
                  key={s.id}
                  dataKey={lineKey(s.id)}
                  name={s.name}
                  stroke={color(s.id)}
                  {...SERIES}
                  type="monotoneX"
                  strokeWidth={hours === 1 ? 2.25 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  connectNulls
                />
              ))}
              {/* Drag either handle to zoom into a stretch of the trend. */}
              {hours > 1 && (
                <Brush
                  dataKey="ts"
                  height={22}
                  travellerWidth={8}
                  tickFormatter={clockFor(hours)}
                  // A prop rather than a class: recharts writes fill="#fff" onto the
                  // rect itself, which a class cannot override.
                  fill="var(--color-muted)"
                  stroke="var(--color-muted-foreground)"
                  onChange={(r) => setZoom({ of: data, range: [r.startIndex ?? 0, r.endIndex ?? last] })}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

export const Latency = memo(LatencyView)

function NodeDetailView({ node }: { node: Node }) {
  const [hours, setHours] = useState(24)
  const [tab, setTab] = useState<ChartTab>("cpu")
  const { data, failed, retry } = useHistory(node.id, hours, "metrics")
  const [latencyEpoch, setLatencyEpoch] = useState(0)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const pullStart = useRef<number | null>(null)

  // Pull-to-refresh is this page's own: while it is mounted, keep the
  // browser's native overscroll refresh from reloading the whole app.
  useEffect(() => {
    const root = document.documentElement
    const previous = root.style.overscrollBehaviorY
    root.style.overscrollBehaviorY = "none"
    return () => {
      root.style.overscrollBehaviorY = previous
    }
  }, [])

  const onPullStart = (event: React.TouchEvent) => {
    pullStart.current = window.scrollY <= 0 ? event.touches[0]?.clientY ?? null : null
  }
  const onPullMove = (event: React.TouchEvent) => {
    if (pullStart.current === null || refreshing) return
    const dy = (event.touches[0]?.clientY ?? pullStart.current) - pullStart.current
    setPull(dy > 0 ? Math.min(76, dy * 0.5) : 0)
  }
  const onPullEnd = () => {
    const shouldRefresh = pull >= 56 && !refreshing
    pullStart.current = null
    if (!shouldRefresh) {
      setPull(0)
      return
    }
    setRefreshing(true)
    setPull(48)
    retry()
    setLatencyEpoch((n) => n + 1)
    setTimeout(() => {
      setRefreshing(false)
      setPull(0)
    }, 700)
  }

  // The hub answers in seconds; the time axis requires milliseconds.
  const metricRows = useMemo((): MetricRow[] => {
    const points = data?.metrics ?? []
    const radius = hours <= 6 ? 2 : 1
    const cpu = smoothMetric(points, "cpu", radius)
    const mem = smoothMetric(points, "mem_used", radius)
    const disk = smoothMetric(points, "disk_used", radius)
    const rx = smoothMetric(points, "net_rx", radius)
    const tx = smoothMetric(points, "net_tx", radius)
    return points.map((m, i) => ({
      ...m, ts: m.ts * 1_000,
      cpu_trend: cpu[i], mem_trend: mem[i], disk_trend: disk[i], rx_trend: rx[i], tx_trend: tx[i],
      rx_peak: Number.isFinite(m.net_rx_max) ? Math.max(m.net_rx, m.net_rx_max!) : null,
      tx_peak: Number.isFinite(m.net_tx_max) ? Math.max(m.net_tx, m.net_tx_max!) : null,
    }))
  }, [data, hours])

  const hasPeaks = useMemo(() => metricRows.some((m) => m.rx_peak !== null || m.tx_peak !== null), [metricRows])

  // Axis tops for the two panels with no capacity to measure against. CPU and a
  // transfer rate do not express fullness: against a fixed 0-100, a machine
  // sitting at 0.4% draws as a line along the panel's floor. Memory and disk keep
  // their totals as tops, where fullness is the entire question.
  const tops = useMemo(() => {
    const max = (pick: (m: Point) => number) =>
      metricRows.reduce((hi, m) => Math.max(hi, pick(m)), 0)
    return {
      // A floor of 4%, or a machine that never exceeds 0.4% would get an axis of
      // 0-0.4 and render every scheduler blip as a peak. Capped at 100.
      cpu: axisTop(max((m) => m.cpu), 4, 10, 100),
      // Base 1024, so the steps are round in the unit `axisBytes` prints.
      rate: axisTop(max((m) => Math.max(m.net_rx, m.net_tx, m.net_rx_max ?? 0, m.net_tx_max ?? 0)), 1024, 1024),
    }
  }, [metricRows])

  return (
    <div className="monitor-detail space-y-4" onTouchStart={onPullStart} onTouchMove={onPullMove} onTouchEnd={onPullEnd}>
      <div
        aria-hidden={pull === 0 && !refreshing}
        className="flex items-center justify-center gap-2 overflow-hidden text-xs text-muted-foreground transition-[height] duration-150"
        style={{ height: refreshing ? 48 : pull }}
      >
        <RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />
        <span>{refreshing ? "Refreshing..." : pull >= 56 ? "Release to refresh" : "Pull to refresh"}</span>
      </div>
      <section className="monitor-overview overflow-hidden rounded-[1.5rem] border">
        <div className="monitor-node-head flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-0 px-4 py-3.5 md:px-5 md:py-4">
          <Dot node={node} className="monitor-status-dot" />
          <h2 className="truncate text-lg font-semibold tracking-[-0.02em]">{node.name}</h2>
          {/* Mobile: the range pills ride on the name row, right after the
              node name (user-directed), so the tab bar below carries only
              the chart tabs. Desktop keeps ranges in the tab bar. */}
          <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1 md:hidden">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                type="button"
                aria-pressed={hours === r.hours}
                onClick={() => setHours(r.hours)}
                className="monitor-range-tab shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-5 transition-colors"
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="monitor-head-location flex shrink-0 items-center gap-3">
            <Flag code={node.country} className="text-sm" />
            <span className="monitor-head-os inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <OsIcon os={node.os} />{distro(node.os) || "—"}
            </span>
          </div>
        </div>

        {node.remark && (
          <p className="monitor-note border-x-0 border-b-0 border-t px-4 py-2.5 text-sm whitespace-pre-wrap md:px-5">{node.remark}</p>
        )}

        <div className="monitor-range flex flex-wrap items-center gap-1.5 border-x-0 border-b-0 border-t p-2 md:px-3">
          {CHART_TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Tab>
          ))}
          <div className="ml-auto flex flex-nowrap gap-1.5 max-md:hidden">
            {RANGES.map((r) => (
              <Tab key={r.hours} active={hours === r.hours} onClick={() => setHours(r.hours)}>
                {r.label}
              </Tab>
            ))}
          </div>
        </div>
      </section>

      {/* Layout (2026-10-24, superseding the latency-on-top stacking of the
          same day): one tabbed chart card like the design theme's detail
          page — tabs in the bar above, a single large chart below. */}
      {tab === "latency" ? (
        <section className="monitor-chart-card monitor-latency-card rounded-2xl border border-border/55 p-3 md:p-4" aria-label="Carrier latency chart">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Carrier Latency</h4>
          <Latency key={`${node.id}-${latencyEpoch}`} id={node.id} hours={hours} className="h-72 md:h-80" />
        </section>
      ) : !data ? (
        <Skeleton className="h-80 w-full" />
      ) : failed ? (
        <Failed message={failed} retry={retry} />
      ) : data.metrics.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No history data for this period</p>
      ) : (
        <>
          {tab === "cpu" && (
          <Panel tall title="CPU">
            <ResponsiveContainer>
              <AreaChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows, hours)} />
                <YAxis domain={[0, tops.cpu]} ticks={quarters(tops.cpu)} unit="%" width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(_v, _name, item) => [`${Number(item.payload.cpu).toFixed(1)}%`, "CPU"]}
                  contentStyle={TIP}
                />
                <Area dataKey="cpu_trend" name="CPU" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.15} {...SOFT_SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
          )}

          {/* The axis top is the machine's memory, so the line's height is the
              fraction in use whatever range is picked. Tracking the window's
              own maximum, which is what an area chart does by default, puts
              127 MB of a 457 MB box at the top of the panel. The size is in the
              title because the axis top is claiming it. */}
          {tab === "memory" && (
          <Panel tall title={`Memory · ${bytes(node.mem_total)}`}>
            <ResponsiveContainer>
              <AreaChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows, hours)} />
                <YAxis domain={[0, node.mem_total]} ticks={quarters(node.mem_total)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(_v, _name, item) => bytes(Number(item.payload.mem_used))}
                  contentStyle={TIP}
                />
                <Area dataKey="mem_trend" name="Memory" stroke="var(--color-chart-4)" fill="var(--color-chart-4)" fillOpacity={0.15} {...SOFT_SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
          )}

          {/* A rate has no total to be a fraction of, so this one climbs the
              ladder like CPU rather than pinning to a capacity. */}
          {tab === "network" && (
          <Panel tall
            title={
              <>
                Network Rate
                <span className="ml-3" style={{ color: "var(--network-rx)" }}>● Download</span>
                <span className="ml-2" style={{ color: "var(--network-tx)" }}>● Upload</span>
                {hasPeaks && <span className="ml-2">Dashed peaks</span>}
              </>
            }
          >
            <ResponsiveContainer>
              <LineChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows, hours)} />
                <YAxis domain={[0, tops.rate]} ticks={quarters(tops.rate)} tickFormatter={axisBytes} unit="/s" width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(_v, _name, item) => {
                    const value = item.dataKey === "rx_trend" ? item.payload.net_rx
                      : item.dataKey === "tx_trend" ? item.payload.net_tx
                        : item.dataKey === "rx_peak" ? item.payload.rx_peak : item.payload.tx_peak
                    return rate(Number(value))
                  }}
                  contentStyle={TIP}
                />
                {hasPeaks && <Line dataKey="rx_peak" name="Download peak" stroke="var(--network-rx)" strokeOpacity={0.48} strokeDasharray="4 3" {...SOFT_SERIES} strokeWidth={1} />}
                {hasPeaks && <Line dataKey="tx_peak" name="Upload peak" stroke="var(--network-tx)" strokeOpacity={0.48} strokeDasharray="4 3" {...SOFT_SERIES} strokeWidth={1} />}
                <Line dataKey="rx_trend" name="Download" stroke="var(--network-rx)" {...SOFT_SERIES} />
                <Line dataKey="tx_trend" name="Upload" stroke="var(--network-tx)" {...SOFT_SERIES} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          )}

          {/* The disk it is filling, for the same reason as memory: a node
              using 2.7% of its disk draws along the top of the panel when the
              axis tracks the window's own maximum. */}
          {tab === "disk" && (
          <Panel tall title={`Disk · ${bytes(node.disk_total)}`}>
            <ResponsiveContainer>
              <AreaChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows, hours)} />
                <YAxis domain={[0, node.disk_total]} ticks={quarters(node.disk_total)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(_v, _name, item) => bytes(Number(item.payload.disk_used))}
                  contentStyle={TIP}
                />
                <Area dataKey="disk_trend" name="Disk" stroke="var(--color-chart-5)" fill="var(--color-chart-5)" fillOpacity={0.15} {...SOFT_SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
          )}
        </>
      )}
    </div>
  )
}

function sameNodeDetail(prev: { node: Node }, next: { node: Node }) {
  const a = prev.node
  const b = next.node
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.online === b.online &&
    a.country === b.country &&
    a.os === b.os &&
    a.agent_version === b.agent_version &&
    a.cpu_cores === b.cpu_cores &&
    a.remark === b.remark &&
    a.mem_total === b.mem_total &&
    a.disk_total === b.disk_total
  )
}

export const NodeDetail = memo(NodeDetailView, sameNodeDetail)
