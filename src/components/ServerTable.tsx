import { Fragment, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ArrowDown, ArrowUp, Search } from "lucide-react"
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siOpensuse, siRedhat,
  siRockylinux, siUbuntu, type SimpleIcon,
} from "simple-icons"

import { Skeleton } from "@/components/ui/skeleton"
import { V190StatBar } from "@/components/StatBar"
import { calibrateUsage, usagePasswordSet, type Node } from "@/lib/api"
import {
  billingCycle, bytes, compact, daysUntil, dayUsage, distro, gb, money, monthUsage, osName, cpuName, pair,
  parseTraffic, percent, rate, uptime,
} from "@/lib/format"
import { readListPreferences, saveListPreferences, selectNodes, type NodeSortKey } from "@/lib/node-list"
import { cn } from "@/lib/utils"

// Emitted as files and fetched on first use, so a page carries only the flags its
// nodes are in rather than all 271. vite.config.ts keeps the small ones from being
// inlined into the bundle as data URLs.
export const FLAGS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("/node_modules/flag-icons/flags/4x3/*.svg", {
      query: "?url",
      import: "default",
      eager: true,
    }),
  ).map(([path, url]) => [path.match(/([\w-]+)\.svg$/)![1], url]),
)

const Latency = lazy(() => import("@/components/NodeDetail").then((m) => ({ default: m.Latency })))

const LATENCY_RANGES = [
  { hours: 1, label: "1小时" },
  { hours: 6, label: "6小时" },
  { hours: 24, label: "24小时" },
  { hours: 168, label: "7天" },
]

/** A node that has reported once knows its shape; one that never connected has nothing to show. */
export function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

export function Dot({ node, className }: { node: Node; className?: string }) {
  const state = node.online ? "online" : deployed(node) ? "offline" : "pending"
  return (
    <span
      title={state === "online" ? "Online" : state === "offline" ? "Offline" : "Not connected"}
      data-status={state}
      className={cn("status-dot relative inline-block size-4 shrink-0 align-middle", className)}
    >
      {state !== "pending" && <span aria-hidden="true" className="status-dot-pulse absolute rounded-full" />}
      <span aria-hidden="true" className="status-dot-halo absolute inset-0 rounded-full" />
      <span aria-hidden="true" className="status-dot-core absolute rounded-full" />
    </span>
  )
}

export function Flag({ code, className, round }: { code: string; className?: string; round?: boolean }) {
  if (!code) return round ? null : <span className="text-muted-foreground">—</span>
  const src = FLAGS[code.toLowerCase()]
  return (
    <span className={cn("inline-flex items-center justify-center gap-1", className)}>
      {src && <img src={src} alt="" className={round ? "h-3 w-3 shrink-0 rounded-full object-cover ring-1 ring-foreground/10" : "h-3 w-4 shrink-0 rounded-[2px] object-cover ring-1 ring-foreground/10"} />}
      {!round && <span className="@max-3xl:hidden">{code.toUpperCase()}</span>}
    </span>
  )
}

// Matched against the whole release name, since "Red Hat Enterprise Linux" and
// "Raspbian GNU/Linux" do not lead with one word to key on. The distributions a
// VPS ships with; the rest take the penguin. Each logo costs 1-6 KB of entry
// bundle, the Raspberry Pi alone 12 KB, so the list stays at what hosts offer.
const DISTROS: [string, SimpleIcon][] = [
  ["debian", siDebian], ["raspbian", siDebian], ["ubuntu", siUbuntu], ["alpine", siAlpinelinux],
  ["centos", siCentos], ["rocky", siRockylinux], ["almalinux", siAlmalinux], ["red hat", siRedhat],
  ["fedora", siFedora], ["arch", siArchlinux], ["opensuse", siOpensuse],
]

/**
 * The distribution's logo in its brand colour. Mixed toward white on the dark
 * theme, where AlmaLinux's black and CentOS's navy would otherwise vanish.
 */
export function OsIcon({ os, className }: { os: string; className?: string }) {
  if (!os) return null
  const name = os.toLowerCase()
  const icon = DISTROS.find(([key]) => name.includes(key))?.[1] ?? siLinux
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      style={{ "--brand": `#${icon.hex}` } as CSSProperties}
      className={cn("size-3.5 shrink-0 fill-(--brand) dark:fill-[color-mix(in_oklab,var(--brand)_60%,white)]", className)}
    >
      <path d={icon.path} />
    </svg>
  )
}



function Line({ label, wide, wrap, children }: { label: string; wide?: boolean; wrap?: boolean; children: ReactNode }) {
  return (
    <div data-line-label={label} className={`grid min-w-0 grid-cols-[8.4em_minmax(0,1fr)] gap-x-2${wide ? " line-wide" : ""}${wrap ? " tnum-wrap" : ""}`}>
      <span className="whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="tnum min-w-0 whitespace-nowrap text-foreground/95">{children}</span>
    </div>
  )
}

function L({ label, children, wrap, wide }: { label: string; children: ReactNode; wrap?: boolean; wide?: boolean }) {
  return (
    <Line label={label} wide={wide} wrap={wrap}>{children}</Line>
  )
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-group min-w-0">
      <h4 className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">{title}</h4>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

// 套餐流量行：今日用量 / 本月用量 / 总量（剩余多少）。本月用量是实时月度
// 用量（按计费模式），用户对齐后从对齐值往上累计；设定改的就是本月用量。
function PlanTraffic({ node }: { node: Node }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState("")
  const [dateText, setDateText] = useState("")
  const [password, setPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [override, setOverride] = useState<number | null>(null)
  const month = override ?? monthUsage(node)
  const today = dayUsage(node)
  // 下一次实时推送会按对齐后的基线重算；那时起显示计算值，不再用乐观值。
  useEffect(() => { setOverride(null) }, [node.month_used])
  const total = node.traffic_limit
  const remaining = total > 0 ? total - month : null

  const open = () => {
    setText(""); setPassword(""); setNewPassword(""); setError(null)
    setDateText(node.traffic_reset_day > 0 ? String(node.traffic_reset_day) : "")
    setPasswordSet(usagePasswordSet())
    setEditing(true)
  }

  const save = async () => {
    const v = parseTraffic(text)
    if (v === null) { setError("格式不对，如 26GB"); return }
    let resetDay = node.traffic_reset_day || 0
    const dt = dateText.trim()
    if (dt !== "") {
      if (!/^\d{1,2}$/.test(dt)) { setError("日期填 1-31 的号数"); return }
      const n = Number.parseInt(dt, 10)
      if (n < 1 || n > 31) { setError("日期填 1-31 的号数"); return }
      resetDay = n
    }
    setError(null)
    setSaving(true)
    const result = await calibrateUsage(node.id, v, node.traffic_mode, password, newPassword, resetDay)
    setSaving(false)
    if (result === "wrong-password") { setError("密码不对"); setPasswordSet(true); return }
    if (result !== "ok") { setError("保存失败，请重试"); return }
    if (newPassword) setPasswordSet(true)
    setOverride(v)
    setEditing(false)
  }

  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="grid w-full grid-cols-4 text-center text-muted-foreground">
        <span>今日</span>
        <span>本月</span>
        <span>总计</span>
        <span>剩余</span>
      </span>
      <span className="grid w-full grid-cols-4 text-center">
        <span>{gb(today)}</span>
        <span>{gb(month)}</span>
        <span>{total > 0 ? gb(total) : "不限量"}</span>
        <span>
          {total > 0 && remaining !== null
            ? (remaining >= 0 ? gb(remaining) : `已超 ${gb(-remaining)}`)
            : "不限量"}
        </span>
      </span>
      {editing ? (
        <span className="inline-flex flex-col gap-1">
          <span className="inline-flex flex-nowrap items-center gap-1">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false) }}
              placeholder="如 26GB"
              disabled={saving}
              className="h-6 w-24 rounded-md border border-border bg-background px-1.5 text-xs shadow-none"
            />
            <button type="button" onClick={() => void save()} disabled={saving} className="server-monitor-link rounded-full px-2 py-0.5 text-xs">确定</button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="server-monitor-link rounded-full px-2 py-0.5 text-xs">取消</button>
          </span>
          <span className="inline-flex flex-nowrap items-center gap-1">
            {passwordSet === true && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false) }}
                placeholder="密码（必填）"
                autoComplete="current-password"
                disabled={saving}
                className="h-6 w-24 rounded-md border border-border bg-background px-1.5 text-xs shadow-none"
              />
            )}
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false) }}
              placeholder={passwordSet ? "新密码（留空不改）" : "设定密码（可选）"}
              autoComplete="new-password"
              disabled={saving}
              className="h-6 w-24 rounded-md border border-border bg-background px-1.5 text-xs shadow-none"
            />
          </span>
          <span className="inline-flex flex-nowrap items-center gap-1">
            <input
              value={dateText}
              onChange={(e) => setDateText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false) }}
              placeholder="每月几号，如 15"
              inputMode="numeric"
              disabled={saving}
              className="h-6 w-24 rounded-md border border-border bg-background px-1.5 text-xs shadow-none"
            />
            <span className="text-xs text-muted-foreground">每月重置日</span>
          </span>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </span>
      ) : (
        <button
          type="button"
          onClick={open}
          className="server-monitor-link rounded-full px-2 py-0.5 text-xs"
        >
          设定
        </button>
      )}
    </span>
  )
}

function Details({ node }: { node: Node }) {
  const [latencyHours, setLatencyHours] = useState(24)
  const [detailTab, setDetailTab] = useState<"latency" | "overview">("latency")
  if (!deployed(node)) {
    return <p className="px-4 py-6 text-center text-muted-foreground">Not connected yet. Generate an install command in the dashboard and run it once.</p>
  }
  const m = node.online ? node.metrics : null
  const usage = (used: number, total: number) => `${pair(used, total).replace(" / ", "/")} (${percent(used, total).toFixed(1)}%)`
  const flow = (rx: number, tx: number) => `↓ ${bytes(rx)} · ↑ ${bytes(tx)}`
  const away = node.last_seen_ago === null
    ? null
    : typeof node.last_seen_ago === "number" && Number.isFinite(node.last_seen_ago) && node.last_seen_ago >= 0
      ? node.last_seen_ago
      : node.last_seen > 0 ? Math.max(0, Date.now() / 1000 - node.last_seen) : null
  const days = daysLeft(node)

  // Narrow drawers: a line whose value cannot fit on one line is measured
  // (not guessed), latched, and sunk to the bottom of its group where it
  // may wrap; every fittable line stays a one-line row.
  const cardRef = useRef<HTMLElement>(null)
  const [wideLabels, setWideLabels] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => { setWideLabels(new Set()) }, [node.id])
  useLayoutEffect(() => {
    const root = cardRef.current
    if (!root) return
    const found: string[] = []
    root.querySelectorAll<HTMLElement>("[data-line-label]").forEach((row) => {
      if (row.classList.contains("line-wide")) return
      const val = row.querySelector<HTMLElement>(".tnum")
      if (val && val.scrollWidth > val.clientWidth + 1) found.push(row.dataset.lineLabel as string)
    })
    if (found.length) setWideLabels((prev) => new Set([...prev, ...found]))
  })

  return (
    <div className="space-y-3 text-[13px] leading-6">
      <div className="flex gap-1">
        {([
          { key: "latency", label: "网络延迟" },
          { key: "overview", label: "系统概览" },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={detailTab === t.key}
            onClick={() => setDetailTab(t.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors max-md:h-5 max-md:py-0 max-md:inline-flex max-md:items-center",
              detailTab === t.key ? "border-transparent bg-foreground text-background" : "text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {detailTab === "latency" && (
      <div className="latency-float-card space-y-2 rounded-2xl border p-3">
        <Suspense fallback={<Skeleton className="h-[240px] @max-3xl:h-[150px]" />}>
          <Latency
            id={node.id}
            hours={latencyHours}
            className="h-[240px] @max-3xl:h-[150px]"
            toolbar={
              <span className="flex flex-nowrap items-center gap-1">
                {LATENCY_RANGES.map((range) => (
                  <button
                    key={range.hours}
                    type="button"
                    aria-pressed={latencyHours === range.hours}
                    onClick={() => setLatencyHours(range.hours)}
                    className="monitor-range-tab shrink-0 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap transition-colors max-md:px-1.5 max-md:py-0 max-md:text-[10px] max-md:leading-5 max-md:h-5 max-md:inline-flex max-md:items-center md:h-5 md:py-0 md:inline-flex md:items-center"
                  >
                    {range.label}
                  </button>
                ))}
              </span>
            }
          />
        </Suspense>
      </div>
      )}

      {detailTab === "overview" && (
      <section ref={cardRef} className="detail-float-card system-detail-card rounded-2xl border">
        <div className="detail-groups grid gap-0">
          <DetailGroup title="系统信息">
            <L label="系统" wide={wideLabels.has("系统")}>
              <span className="inline-flex items-center gap-1.5 align-middle">
                <OsIcon os={node.os} className="detail-os-icon" />
                {[osName(node.os), node.kernel].filter(Boolean).join(" · ") || "—"}
              </span>
            </L>
            <L label="架构" wide={wideLabels.has("架构")}>
              {[node.arch, node.virt !== "none" && node.virt, node.agent_version && `agent ${node.agent_version}`]
                .filter(Boolean)
                .join(" · ") || "—"}
            </L>
            <L label="处理器" wide={wideLabels.has("处理器")}>
              {node.cpu_name ? `${cpuName(node.cpu_name).replace(/\s@\s.*$/, "")} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
              {m && ` (${m.cpu.toFixed(1)}%)`}
            </L>
            <L label="在线" wide={wideLabels.has("在线")}>{node.online ? (m ? uptime(m.uptime) : "等待数据") : away === null ? "从未上报" : away >= 60 ? uptime(away) : "刚刚"}</L>
          </DetailGroup>

          <DetailGroup title="资源">
            <L label="内存" wide={wideLabels.has("内存")}>{m ? usage(m.mem_used, m.mem_total) : bytes(node.mem_total)}</L>
            <L label="交换" wide={wideLabels.has("交换")}>
              {node.swap_total > 0 ? (m ? usage(m.swap_used, m.swap_total) : bytes(node.swap_total)) : "未启用"}
            </L>
            <L label="磁盘" wide={wideLabels.has("磁盘")}>{m ? usage(m.disk_used, m.disk_total) : bytes(node.disk_total)}</L>
            <L label="负载" wide={wideLabels.has("负载")}>{m ? m.load.map((n) => n.toFixed(2)).join(" / ") : "—"}</L>
          </DetailGroup>
        </div>
        <div className="detail-groups grid gap-0">
          <DetailGroup title="网络与连接">
            <L label="进程" wide={wideLabels.has("进程")}>{m ? `${m.procs} · TCP ${m.tcp} · UDP ${m.udp}` : "—"}</L>
            <L label="网速" wide={wideLabels.has("网速")}>
              {m ? (
                <>
                  <span className="whitespace-nowrap">↓ {rate(m.net_rx)}</span>{" "}
                  <span className="whitespace-nowrap">↑ {rate(m.net_tx)}</span>
                </>
              ) : "—"}
            </L>
            <L label="总流量" wide={wideLabels.has("总流量")}>{flow(node.total_rx, node.total_tx)}</L>
            {(node.ipv4 || node.ipv6) && (
              <L label="网络栈" wide={wideLabels.has("网络栈")}>
                {node.ipv4 && node.ipv6 ? "双栈 (IPv4 + IPv6)" : node.ipv4 ? "仅 IPv4" : "仅 IPv6"}
              </L>
            )}
          </DetailGroup>

          <DetailGroup title="套餐">
            <L label="价格" wide={wideLabels.has("价格")}>
              {node.price > 0 ? `${money(node.price, node.currency)} / ${cycleZh(billingCycle(node.billing_cycle))}` : "免费"}
            </L>
            <L label="到期" wide={wideLabels.has("到期")}>
              {node.expires_at
                ? `${node.expires_at} (${days !== null && days < 0 ? `已过期 ${-days} 天` : `剩 ${days} 天`})`
                : "无到期"}
            </L>
            {node.traffic_mode && (
              <L label="计费" wide={wideLabels.has("计费")}>
                {{ sum: "双向", up: "单向 · 仅上行", down: "单向 · 仅下行", max: "双向 · 取大值" }[node.traffic_mode] ?? node.traffic_mode}
              </L>
            )}
            {node.traffic_limit !== 0 && (
              <L label="套餐流量" wide={wideLabels.has("套餐流量")} wrap><PlanTraffic node={node} /></L>
            )}
            {node.traffic_reset_day > 0 && <L label="流量重置" wide={wideLabels.has("流量重置")}>每月 {node.traffic_reset_day} 号</L>}
          </DetailGroup>
        </div>
      </section>
      )}
    </div>
  )
}

function ServerInlineDetail({ node }: { node: Node }) {
  // Inline expansion under the clicked row (user-directed, replacing the
  // overlay drawer): the row itself is the header; the detail content —
  // latency / overview behind its dropdown — unfolds in the list.
  return (
    <div className="server-inline-detail px-0.5 py-2 md:px-1.5">
      <Details node={node} />
    </div>
  )
}

/** Billing-cycle wording in Chinese for the overview's 价格 row. */
function cycleZh(s: string): string {
  return s
    .replace(/^(\d+) years?$/, "$1 年")
    .replace(/^(\d+) months?$/, "$1 个月")
    .replace(/^month$/, "月")
    .replace(/^year$/, "年")
    .replace(/^quarter$/, "季")
    .replace(/^week$/, "周")
    .replace(/^day$/, "天")
}

function daysLeft(node: Node): number | null {
  return typeof node.expires_in === "number" && Number.isFinite(node.expires_in) ? node.expires_in : daysUntil(node.expires_at)
}

/** The drawer's 到期 wording, reused as the expiry column's hover text. */
function expiryTitle(node: Node): string {
  if (!node.expires_at) return "No expiry"
  const days = daysLeft(node)
  if (days === null) return node.expires_at
  return `${node.expires_at} (${days < 0 ? `expired ${-days} days ago` : `${days} days left`})`
}

/** Panel-style remaining days: dates read as UTC midnights, partial days round up. */
function expiryDays(node: Node): number | null {
  if (!node.expires_at) return null
  const end = Date.parse(node.expires_at)
  if (!Number.isFinite(end)) return null
  return Math.ceil((end - Date.now()) / 86400000)
}

/** Share of the billing period still left, from the note's start and end dates. */
function expiryPercent(node: Node): number | null {
  if (!node.expires_at || !node.starts_at) return null
  const start = Date.parse(node.starts_at)
  const end = Date.parse(node.expires_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return Math.max(0, Math.min(100, ((end - Date.now()) / (end - start)) * 100))
}

function CompactMeter({ label, value, pct, className, pair }: { label: string; value: string; pct: number | null; className?: string; pair?: [string, string] }) {
  const level = pct !== null && pct >= 90 ? "danger" : pct !== null && pct >= 75 ? "warn" : "normal"
  const inner = pair ? <span className="compact-card-pair"><span className="pair-l">{pair[0]}</span><span className="pair-sep">|</span><span className="pair-r">{pair[1]}</span></span> : value
  return (
    <span className={cn("compact-card-meter tnum", className)} data-level={level} title={`${label} ${value}`} style={{ "--fill": `${Math.max(0, Math.min(100, pct ?? 0))}%` } as CSSProperties}>
      <span className="compact-card-meter-label">{inner}</span>
      <span className="compact-card-meter-label-filled" aria-hidden="true">{inner}</span>
    </span>
  )
}

/** The panel's 有效 cell: a meter pill reading "344天 94.04%", coloured by the
 * share of the period left (green, amber under 20%, red under 10%); 永久 plain. */
function ExpiryCell({ node }: { node: Node }) {
  const title = expiryTitle(node)
  const render = (text: string, level: string, fill: number, flat = false) => (
    <span className={cn("compact-card-meter compact-card-expiry tnum", flat && "compact-card-expiry-flat")} data-level={level} title={title} style={{ "--fill": `${fill}%` } as CSSProperties}>
      <span className="compact-card-meter-label">{text}</span>
      <span className="compact-card-meter-label-filled" aria-hidden="true">{text}</span>
    </span>
  )
  if (!node.expires_at) return render("Never", "none", 0, true)
  const days = expiryDays(node)
  if (days === null) return <span className="compact-card-expiry tnum" title={title}>{node.expires_at}</span>
  if (days <= 0) return render("Expired", "danger", 0)
  const pct = expiryPercent(node)
  const level = pct === null ? "ok" : pct < 10 ? "danger" : pct < 20 ? "warn" : "ok"
  return render(`${days}d`, level, pct ?? 0)
}

const ServerCard = memo(function ServerCard({ node, onOpen, open, badge }: { node: Node; onOpen: (id: number) => void; open?: boolean; badge?: "busy" | "fast" | "both" | null }) {
  const m = node.online ? node.metrics : null
  const memPct = m ? percent(m.mem_used, m.mem_total) : null
  const diskPct = m ? percent(m.disk_used, m.disk_total) : null

  return (
    <article className="server-card" data-online={node.online ? "true" : "false"}>
      <button
        type="button"
        onClick={() => onOpen(node.id)}
        aria-label={`View details for ${node.name}`}
        aria-expanded={open ?? false}
        className="compact-card-hit compact-card-grid"
      >
        <span className="compact-card-status">
          {badge ? (
            <span className="compact-card-badge" aria-hidden="true">
              {(badge === "busy" || badge === "both") && <span title="Busiest node">🔥</span>}
              {(badge === "fast" || badge === "both") && <span title="Fastest node">⚡</span>}
            </span>
          ) : (
            <Dot node={node} className="compact-card-dot" />
          )}
          <span className="compact-card-flag-m"><Flag code={node.country} round /></span>
        </span>
        <span className={cn("compact-card-name", badge === "busy" || badge === "both" ? "nz-shine-busy" : badge === "fast" ? "nz-shine-fast" : undefined)} title={node.name}>{node.name}</span>
        <span className="compact-card-region"><Flag code={node.country} /></span>
        <span className="compact-card-os"><OsIcon os={node.os} /><span>{distro(node.os) || "—"}</span></span>
        <span className="compact-card-uptime tnum" title={m ? `Online for ${uptime(m.uptime)}` : undefined}>{m ? uptime(m.uptime) : "—"}</span>
        <span className="compact-card-speed tnum" title={m ? `${compact(m.net_rx)} | ${compact(m.net_tx)}` : "—"}>{m ? <span className="compact-card-pair"><span className="pair-l"><span className="pair-arrow">↑</span>{compact(m.net_tx)}</span><span className="pair-sep">|</span><span className="pair-r"><span className="pair-arrow">↓</span>{compact(m.net_rx)}</span></span> : "—"}</span>
        <CompactMeter label="Traffic" value={`${compact(node.total_rx)} | ${compact(node.total_tx)}`} pair={[compact(node.total_rx), compact(node.total_tx)]} pct={null} className="compact-card-traffic" />
        <CompactMeter label="CPU" value={m ? `${m.cpu.toFixed(1)}%` : "—"} pct={m?.cpu ?? null} className="compact-card-usage" />
        <CompactMeter label="Memory" value={memPct === null ? "—" : `${memPct.toFixed(1)}%`} pct={memPct} className="compact-card-usage" />
        <CompactMeter label="Disk" value={diskPct === null ? "—" : `${diskPct.toFixed(1)}%`} pct={diskPct} className="compact-card-usage" />
        <span className="compact-card-price tnum" title={node.price > 0 ? `Price ${money(node.price, node.currency)} / ${billingCycle(node.billing_cycle)}` : "Free"}>{node.price > 0 ? `${money(node.price, node.currency)}/${billingCycle(node.billing_cycle)}` : "Free"}</span>
        <ExpiryCell node={node} />
      </button>
    </article>
  )
})

export function ServerTable({ nodes }: { nodes: Node[] }) {
  const [detailId, setDetailId] = useState<number | null>(null)
  const [preferences, setPreferences] = useState(() => readListPreferences())
  const toggleDetail = useCallback((id: number) => setDetailId((current) => (current === id ? null : id)), [])
  const visibleNodes = useMemo(() => selectNodes(nodes, "", preferences), [nodes, preferences])
  // The stat bar's busiest/fastest designations, mirrored onto the rows:
  // that node's status dot becomes 🔥 / ⚡ instead of the plain dot.
  const { busiestId, fastestId } = useMemo(() => {
    let busy: { id: number; cpu: number } | null = null
    let fast: { id: number; rx: number } | null = null
    for (const node of nodes) {
      if (!node.online || !node.metrics) continue
      if (!busy || node.metrics.cpu > busy.cpu) busy = { id: node.id, cpu: node.metrics.cpu }
      if (!fast || node.metrics.net_rx > fast.rx) fast = { id: node.id, rx: node.metrics.net_rx }
    }
    return { busiestId: busy?.id ?? null, fastestId: fast?.id ?? null }
  }, [nodes])
  const groupFilters = useMemo(() => {
    const values: { value: string; label: string; count: number }[] = [{ value: "all", label: "All", count: nodes.length }]
    for (const node of nodes) {
      if (!node.group) continue
      const entry = values.find((item) => item.value === node.group)
      if (entry) entry.count += 1
      else values.push({ value: node.group, label: node.group, count: 1 })
    }
    return values
  }, [nodes])
  const hasFilters = preferences.group !== "all"

  useEffect(() => saveListPreferences(preferences), [preferences])

  const clearFilters = () => {
    setPreferences((current) => ({ ...current, group: "all" }))
  }
  const sortBy = (sort: NodeSortKey) => {
    setPreferences((current) => ({
      ...current,
      sort,
      direction: current.sort === sort ? (current.direction === "asc" ? "desc" : "asc") : (sort === "name" ? "asc" : "desc"),
    }))
  }
  const SortArrow = preferences.direction === "asc" ? ArrowUp : ArrowDown

  return (
    <section className="server-panel @container space-y-2 md:space-y-3">
      <div className="server-list-controls flex items-center gap-3 pt-1">
        <div className="server-status-filters inline-flex items-center gap-1 rounded-full border p-1" role="group" aria-label="Server group filter">
            {groupFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={preferences.group === filter.value}
                onClick={() => setPreferences((current) => ({ ...current, group: filter.value }))}
                className="server-filter-button inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs"
              >
                {filter.label}<span className="tnum text-[10px] opacity-65">{filter.count}</span>
              </button>
            ))}
          </div>
        {/* Wide screens: the one-line stat bar rides in the filter row,
            replacing the header's stacked bar (hidden from xl up there). */}
        <V190StatBar nodes={nodes} variant="line" className="ml-auto max-xl:hidden" />
      </div>

      <div className="server-node-list">
        <div className="compact-card-head compact-card-grid">
          <span>Status</span>
          <button type="button" className="compact-sort" onClick={() => sortBy("name")} aria-label="Sort by server name">Name{preferences.sort === "name" && <SortArrow />}</button>
          <span className="compact-card-region">Region</span>
          <span className="compact-card-system-head">System</span>
          <span className="compact-card-uptime">Uptime</span>
          <button type="button" className="compact-sort compact-card-speed-head" onClick={() => sortBy("network")} aria-label="Sort by network speed">Speed<span className="compact-card-directions"> ↓|↑</span>{preferences.sort === "network" && <SortArrow />}</button>
          <button type="button" className="compact-sort compact-card-traffic-head" onClick={() => sortBy("traffic")} aria-label="Sort by total traffic">Traffic<span className="compact-card-directions"> ↓|↑</span>{preferences.sort === "traffic" && <SortArrow />}</button>
          <button type="button" className="compact-sort" onClick={() => sortBy("cpu")} aria-label="Sort by CPU">CPU{preferences.sort === "cpu" && <SortArrow />}</button>
          <button type="button" className="compact-sort" onClick={() => sortBy("memory")} aria-label="Sort by memory">Memory{preferences.sort === "memory" && <SortArrow />}</button>
          <span>Disk</span>
          <span className="compact-card-price">Price</span>
          <span className="compact-card-expiry">Expiry</span>
        </div>
        {visibleNodes.length ? visibleNodes.map((node) => (
          <Fragment key={node.id}>
            <ServerCard node={node} onOpen={toggleDetail} open={detailId === node.id} badge={node.id === busiestId && node.id === fastestId ? "both" : node.id === busiestId ? "busy" : node.id === fastestId ? "fast" : null} />
            {detailId === node.id && <ServerInlineDetail node={node} />}
          </Fragment>
        )) : (
          <div className="server-empty-state rounded-2xl border border-dashed px-5 py-10 text-center">
            <Search aria-hidden="true" className="mx-auto mb-3 size-5 text-muted-foreground" />
            <p className="text-sm font-medium">{nodes.length ? "No servers in this group" : "No servers yet"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{nodes.length ? "Switch to All to view every server." : "Servers will appear here after they are added."}</p>
            {hasFilters && <button type="button" onClick={clearFilters} className="server-monitor-link mt-4 rounded-full px-4 py-2 text-xs font-medium">Clear filters</button>}
          </div>
        )}
      </div>

    </section>
  )
}
