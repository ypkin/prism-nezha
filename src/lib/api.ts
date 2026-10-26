import { startTransition, useEffect, useState } from "react"
import { monthUsage, periodKeyFor } from "./format.ts"

export type Metrics = {
  uptime: number
  cpu: number
  load: [number, number, number]
  mem_total: number
  mem_used: number
  swap_total: number
  swap_used: number
  disk_total: number
  disk_used: number
  net_rx: number
  net_tx: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  tcp: number
  udp: number
  procs: number
}

export type Node = {
  id: number
  name: string
  sort: number
  public: boolean
  online: boolean
  /** ISO 3166-1 alpha-2, or empty when the hub could not locate the address. */
  country: string
  /** Public group label added in hub 1.3.0. */
  group?: string
  /** Seconds since the last report, measured by the hub clock; null means never reported. */
  last_seen_ago?: number | null
  last_seen: number
  metrics: Metrics | null
  os: string
  kernel: string
  arch: string
  virt: string
  cpu_name: string
  cpu_cores: number
  mem_total: number
  swap_total: number
  disk_total: number
  agent_version: string
  price: number
  currency: string
  billing_cycle: string
  expires_at: string | null
  starts_at: string | null
  /** Remaining calendar days as counted by the hub; absent on older versions. */
  expires_in?: number | null
  traffic_limit: number
  traffic_mode: string
  traffic_reset_day: number
  /** Declared stacks from the note's planDataMod (IPv4 / IPv6 flags). */
  ipv4: boolean
  ipv6: boolean
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  /** This period's usage as the plan meters it (`traffic_mode`). Absent on older hubs. */
  month_used?: number
  month_start: string
  day_rx: number
  day_tx: number
  /** Panel only. */
  hostname?: string
  ip?: string
  remark?: string
}

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/* =====================================================================
 * Nezha v0 adapter.
 *
 * This build runs as a standalone frontend in front of a Nezha v0
 * (nezha-zero) dashboard instead of a Monitor Hub:
 *  - live data comes from the dashboard's `/ws` push ({now, servers}),
 *  - the initial snapshot, billing notes (PublicNote) and the site name
 *    come from the dashboard home page, which embeds the same payload
 *    plus each server's PublicNote (the WS push omits it),
 *  - month/day traffic is accumulated locally from the lifetime
 *    counters, because the v0 feed has no monthly counters,
 *  - metric history is accumulated locally from the live stream,
 *    because the v0 public API exposes no per-server history.
 * ===================================================================== */

type V0Host = {
  Platform?: string
  PlatformVersion?: string
  CPU?: string[]
  MemTotal?: number
  DiskTotal?: number
  SwapTotal?: number
  Arch?: string
  Virtualization?: string
  CountryCode?: string
  Version?: string
}

type V0State = {
  CPU?: number
  MemUsed?: number
  SwapUsed?: number
  DiskUsed?: number
  NetInTransfer?: number
  NetOutTransfer?: number
  NetInSpeed?: number
  NetOutSpeed?: number
  Uptime?: number
  Load1?: number
  Load5?: number
  Load15?: number
  TcpConnCount?: number
  UdpConnCount?: number
  ProcessCount?: number
}

type V0Server = {
  ID: number
  Name?: string
  Tag?: string
  DisplayIndex?: number
  HideForGuest?: boolean
  Host?: V0Host
  State?: V0State
  LastActive?: string
  PublicNote?: string
}

type Note = {
  country?: string
  price: number
  currency: string
  cycle: string
  expiresAt: string | null
  startAt: string | null
  trafficLimit: number
  trafficMode: string
  ipv4: boolean
  ipv6: boolean
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0)

function parseNote(raw: string | undefined): Note | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      billingDataMod?: { startDate?: string; endDate?: string; cycle?: string; amount?: string }
      planDataMod?: { trafficVol?: string; trafficType?: string; IPv4?: string; IPv6?: string }
      countryCode?: string
    }
    const billing = parsed.billingDataMod ?? {}
    const plan = parsed.planDataMod ?? {}
    const amountText = String(billing.amount ?? "")
    const amount = Number.parseFloat(amountText.replace(/[^0-9.]/g, ""))
    const currency = /[￥¥]/.test(amountText) ? "CNY" : amountText.includes("€") ? "EUR" : amountText.includes("£") ? "GBP" : "USD"
    const cycles: Record<string, string> = {
      "月": "monthly", "月付": "monthly", "年": "yearly", "年付": "yearly",
      "季": "quarterly", "季度": "quarterly", "半年": "semiannual",
      "两年": "biennial", "三年": "triennial", "一次性": "once",
    }
    const volText = String(plan.trafficVol ?? "").trim()
    const vol = /^([\d.]+)\s*([KMGT])?B?$/i.exec(volText)
    const unitPow = vol?.[2] ? "KMGT".indexOf(vol[2].toUpperCase()) + 1 : 0
    // -1 marks an unlimited plan ("Unlimited" / 不限量 in the note).
    const trafficLimit = /unlimited|不限/i.test(volText) ? -1 : vol ? Math.round(Number.parseFloat(vol[1]) * 1024 ** unitPow) : 0
    const end = String(billing.endDate ?? "")
    const start = String(billing.startDate ?? "")
    return {
      country: parsed.countryCode ? parsed.countryCode.toLowerCase() : undefined,
      price: Number.isFinite(amount) ? amount : 0,
      currency,
      cycle: cycles[String(billing.cycle ?? "")] ?? String(billing.cycle ?? ""),
      expiresAt: /^\d{4}-\d{2}-\d{2}$/.test(end) && end !== "0000-00-00" ? end : null,
      startAt: /^\d{4}-\d{2}-\d{2}$/.test(start) && start !== "0000-00-00" ? start : null,
      trafficLimit,
      // The plan's own metering, surfaced in the details. trafficType per
      // the official note generator: 1 = upload only, 2 = both ways,
      // 3 = max(in, out). (The mapping in the upstream theme was off by one.)
      trafficMode: ({ "1": "up", "2": "sum", "3": "max" } as Record<string, string>)[String(plan.trafficType ?? "")] ?? "",
      ipv4: plan.IPv4 === "1",
      ipv6: plan.IPv6 === "1",
    }
  } catch {
    return null
  }
}

function mapServer(sv: V0Server, note: Note | null, notes: Map<number, Note | null>, nowMs: number): Node {
  const host = sv.Host ?? {}
  const state = sv.State ?? {}
  const lastActiveMs = sv.LastActive ? Date.parse(sv.LastActive) : NaN
  const agoSec = Number.isFinite(lastActiveMs) ? Math.max(0, (nowMs - lastActiveMs) / 1000) : null
  const online = agoSec !== null && agoSec <= 20
  const cpuRaw = (host.CPU ?? []).join(" ").trim()
  const cores = /(\d+)\s+(?:Physical|Virtual)\s+Core/i.exec(cpuRaw)
  const platform = (host.Platform ?? "").trim()
  const osBase = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : ""
  const own = note ?? notes.get(sv.ID) ?? null
  const monthStart = new Date()
  monthStart.setDate(1)
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    id: sv.ID,
    name: sv.Name ?? String(sv.ID),
    sort: sv.DisplayIndex ?? 0,
    public: !sv.HideForGuest,
    online,
    country: own?.country || (host.CountryCode ?? "").toLowerCase(),
    group: sv.Tag || undefined,
    last_seen_ago: agoSec === null ? null : Math.round(agoSec),
    last_seen: Number.isFinite(lastActiveMs) ? Math.floor(lastActiveMs / 1000) : 0,
    metrics: {
      uptime: num(state.Uptime),
      cpu: typeof state.CPU === "number" && Number.isFinite(state.CPU) ? Math.max(0, state.CPU) : 0,
      load: [num(state.Load1), num(state.Load5), num(state.Load15)],
      mem_total: num(host.MemTotal),
      mem_used: num(state.MemUsed),
      swap_total: num(host.SwapTotal),
      swap_used: num(state.SwapUsed),
      disk_total: num(host.DiskTotal),
      disk_used: num(state.DiskUsed),
      net_rx: num(state.NetInSpeed),
      net_tx: num(state.NetOutSpeed),
      total_rx: num(state.NetInTransfer),
      total_tx: num(state.NetOutTransfer),
      month_rx: 0,
      month_tx: 0,
      tcp: num(state.TcpConnCount),
      udp: num(state.UdpConnCount),
      procs: num(state.ProcessCount),
    },
    os: [osBase, host.PlatformVersion].filter(Boolean).join(" "),
    kernel: "",
    arch: host.Arch ?? "",
    virt: host.Virtualization ?? "",
    cpu_name: cpuRaw.replace(/\s*\d+\s+(?:Physical|Virtual)\s+Core.*$/i, "").trim(),
    cpu_cores: cores ? Number.parseInt(cores[1], 10) : (host.CPU ?? []).length,
    mem_total: num(host.MemTotal),
    swap_total: num(host.SwapTotal),
    disk_total: num(host.DiskTotal),
    agent_version: host.Version ?? "",
    price: own?.price ?? 0,
    currency: own?.currency ?? "USD",
    billing_cycle: own?.cycle ?? "",
    expires_at: own?.expiresAt ?? null,
    starts_at: own?.startAt ?? null,
    traffic_limit: own?.trafficLimit ?? 0,
    traffic_mode: own?.trafficMode ?? "",
    traffic_reset_day: 0,
    ipv4: own?.ipv4 ?? false,
    ipv6: own?.ipv6 ?? false,
    total_rx: num(state.NetInTransfer),
    total_tx: num(state.NetOutTransfer),
    month_rx: 0,
    month_tx: 0,
    month_start: `${monthStart.getFullYear()}-${pad(monthStart.getMonth() + 1)}-01`,
    day_rx: 0,
    day_tx: 0,
  }
}

/* ---------- panel snapshot (PublicNote, site name, fallback data) ---------- */

const notesById = new Map<number, Note | null>()
let siteName = ""
let snapshotAt = 0
let snapshotNodes: Node[] | null = null
let snapshotFlight: Promise<Node[]> | null = null

/** Decode a single-quoted JS string literal body (Go template escaping). */
function decodeJsString(raw: string): string {
  let out = ""
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c !== "\\") { out += c; continue }
    const e = raw[++i]
    if (e === "u" && raw[i + 1] === "{") {
      const end = raw.indexOf("}", i + 2)
      out += String.fromCodePoint(Number.parseInt(raw.slice(i + 2, end), 16))
      i = end
    } else if (e === "u") {
      out += String.fromCharCode(Number.parseInt(raw.slice(i + 1, i + 5), 16))
      i += 4
    } else if (e === "x") {
      out += String.fromCharCode(Number.parseInt(raw.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" }
      out += simple[e] ?? e
    }
  }
  return out
}

function extractSnapshot(html: string): { now: number; servers: V0Server[] } | null {
  const marker = "JSON.parse('"
  let from = 0
  for (;;) {
    const at = html.indexOf(marker, from)
    if (at < 0) return null
    let j = at + marker.length
    let raw = ""
    while (j < html.length) {
      const c = html[j]
      if (c === "\\") { raw += c + (html[j + 1] ?? ""); j += 2; continue }
      if (c === "'") break
      raw += c; j++
    }
    try {
      const data = JSON.parse(decodeJsString(raw)) as { now?: number; servers?: V0Server[] }
      if (data && Array.isArray(data.servers)) return { now: data.now ?? Date.now(), servers: data.servers }
    } catch { /* not the payload; keep scanning */ }
    from = j + 1
  }
}

async function fetchSnapshot(signal?: AbortSignal): Promise<Node[]> {
  const res = await fetch("/panel-snapshot", { signal })
  if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText)
  const html = await res.text()
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim()
  if (title) siteName = title
  const snap = extractSnapshot(html)
  if (!snap) throw new Error("Failed to parse the panel snapshot")
  const nowMs = snap.now || Date.now()
  const nodes = snap.servers.map((sv) => {
    const note = parseNote(sv.PublicNote)
    notesById.set(sv.ID, note)
    return mapServer(sv, note, notesById, nowMs)
  })
  snapshotAt = Date.now()
  snapshotNodes = nodes
  return nodes
}

function ensureSnapshot(maxAgeMs: number, signal?: AbortSignal): Promise<Node[]> {
  if (snapshotNodes && Date.now() - snapshotAt < maxAgeMs) return Promise.resolve(snapshotNodes)
  if (!snapshotFlight) {
    snapshotFlight = fetchSnapshot(signal).finally(() => { snapshotFlight = null })
  }
  return snapshotFlight
}

/* ---------- month/day traffic accumulation (from lifetime counters) ---------- */

/*
 * Month/day usage is accounted by the resident collector service behind
 * `/usage/` (same origin, proxied to a small service next to the
 * frontend): it polls the panel once a minute and owns period, restart
 * and day handling, so a closed page loses nothing. The page only adds
 * the live delta since the collector's last poll, keeping the numbers
 * live between polls, and refreshes the collector records at most once
 * a minute (rollovers, re-alignments and calibrations arrive that way).
 *
 * localStorage keeps browser-side baselines as a fallback for when the
 * store is unreachable (dev, or the service down): the page still works,
 * it just falls back to this browser's own accumulation, with the same
 * banking-on-restart the collector model replaced.
 *
 * `used` is the metered usage already banked at the baseline: the user can
 * align it (calibrate) to an external figure, and from then on the display
 * keeps accumulating upward from it. Agent restarts reset the lifetime
 * counters, so on a counter drop the accrued metered usage is banked into
 * `used` instead of being lost.
 *
 * `p` is the usage period key (see periodKeyFor): the calendar month by
 * default, or anchored at the plan's monthly reset day (`reset_day`, 0 =
 * unset) once the user sets one in the calibration dialog.
 */
type TrafficBase = { p: string; mrx: number; mtx: number; d: string; drx: number; dtx: number; used: number; reset_day: number }
const TRAFFIC_KEY = "glass-nezha:traffic:v1"
let trafficBases: Record<string, TrafficBase> = {}
try {
  const raw = JSON.parse(localStorage.getItem(TRAFFIC_KEY) ?? "{}") as Record<string, Partial<TrafficBase> & { m?: string }>
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof (v.p ?? v.m) === "string") {
      trafficBases[k] = {
        p: (v.p ?? v.m) as string, mrx: v.mrx ?? 0, mtx: v.mtx ?? 0,
        d: v.d ?? "", drx: v.drx ?? 0, dtx: v.dtx ?? 0, used: v.used ?? 0,
        reset_day: v.reset_day ?? 0,
      }
    }
  }
} catch { trafficBases = {} }
let trafficSaveAt = 0

/* ---------- VPS usage store ---------- */

type CollectorRecord = {
  last_rx: number; last_tx: number
  month_rx: number; month_tx: number
  day_rx: number; day_tx: number
  month_start: string; day_start: string; reset_day: number
}
const isCollectorRecord = (r: unknown): r is CollectorRecord =>
  !!r && typeof r === "object" &&
  typeof (r as CollectorRecord).last_rx === "number" &&
  typeof (r as CollectorRecord).month_rx === "number" &&
  typeof (r as CollectorRecord).day_rx === "number"
let vpsUsage: Record<string, CollectorRecord> | null = null
/** Whether the store has a calibration password (null = store not reached yet). */
let vpsPasswordSet: boolean | null = null
export function usagePasswordSet(): boolean | null { return vpsPasswordSet }
let vpsUsageStarted = false
let vpsUsageLoaded = false
let vpsFetchAt = 0
// Previous push's month_used per node: on a counter drop (agent restart)
// this is the accrued usage the new baseline must preserve (legacy path).
const lastMonthUsed: Record<string, number> = {}

async function fetchVpsUsage(): Promise<void> {
  try {
    const res = await fetch("/usage/", { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`usage store ${res.status}`)
    const data = await res.json() as { nodes?: Record<string, CollectorRecord>; password_set?: boolean }
    vpsUsage = data.nodes && typeof data.nodes === "object" ? data.nodes : {}
    vpsPasswordSet = typeof data.password_set === "boolean" ? data.password_set : false
  } catch {
    // On a refresh failure keep the previous records: the page keeps
    // showing them plus the live delta until the service is back. Only
    // the very first load reports the store as unreachable.
    if (!vpsUsageLoaded) vpsUsage = null
  }
  vpsUsageLoaded = true
}

function loadVpsUsage(): void {
  if (vpsUsageStarted) return
  vpsUsageStarted = true
  void fetchVpsUsage()
}

async function postUsage(path: string, body: unknown): Promise<number> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    return res.status
  } catch { return 0 }
}

/**
 * User alignment: set this period's used amount; the display accumulates
 * upward from it. The service splits the figure into month_rx/month_tx
 * by the plan's metering mode and stamps the current period, so the next
 * collection accumulates on top of it instead of discarding it.
 * `resetDay` (1-31, 0 = keep the current one) anchors the period at that
 * day of the month. `password` must match the store's calibration
 * password once one exists; `newPassword`, when non-empty, becomes (or
 * replaces) that password. The password itself is never kept in the
 * browser.
 */
export async function calibrateUsage(
  id: number, usedBytes: number, trafficMode: string,
  password: string, newPassword: string, resetDay: number,
): Promise<"ok" | "wrong-password" | "failed"> {
  const status = await postUsage("/usage/calibrate", {
    id: String(id), used_bytes: usedBytes, traffic_mode: trafficMode, reset_day: resetDay,
    ...(password ? { password } : {}),
    ...(newPassword ? { new_password: newPassword } : {}),
  })
  if (status === 403) return "wrong-password"
  if (status !== 200) return "failed"
  if (newPassword) vpsPasswordSet = true
  // Pick the calibrated figures up promptly instead of waiting for the
  // next minute's refresh.
  vpsFetchAt = 0
  void fetchVpsUsage()
  return "ok"
}

function applyTraffic(nodes: Node[]): Node[] {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const dayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  let dirty = false
  for (const node of nodes) {
    const key = String(node.id)
    const rec = vpsUsage?.[key]
    if (rec && isCollectorRecord(rec)) {
      // Collector mode: the service owns period, restart and day
      // handling; the page only adds the live delta since its last poll.
      // A counter drop (agent restart between polls) floors the delta at
      // zero, so the display holds the collector figure until the next
      // refresh picks up the re-aligned baselines.
      const drx = Math.max(0, node.total_rx - rec.last_rx)
      const dtx = Math.max(0, node.total_tx - rec.last_tx)
      node.month_rx = rec.month_rx + drx
      node.month_tx = rec.month_tx + dtx
      node.day_rx = rec.day_rx + drx
      node.day_tx = rec.day_tx + dtx
      node.month_used = monthUsage({ month_rx: node.month_rx, month_tx: node.month_tx, traffic_mode: node.traffic_mode })
      // The reset day comes from the collector record, so the 流量重置 row lights up.
      node.traffic_reset_day = rec.reset_day
      if (node.metrics) {
        node.metrics.month_rx = node.month_rx
        node.metrics.month_tx = node.month_tx
        node.metrics.total_rx = node.total_rx
        node.metrics.total_tx = node.total_tx
      }
      continue
    }
    let base = trafficBases[key]
    const periodKey = periodKeyFor(now, base?.reset_day ?? 0)
    if (!base || base.p !== periodKey) {
      base = {
        p: periodKey, mrx: node.total_rx, mtx: node.total_tx,
        d: dayKey, drx: node.total_rx, dtx: node.total_tx, used: 0,
        reset_day: base?.reset_day ?? 0,
      }
      trafficBases[key] = base
      dirty = true
    } else if (base.d !== dayKey) {
      base.d = dayKey; base.drx = node.total_rx; base.dtx = node.total_tx
      dirty = true
    }
    // Agent restarts reset the lifetime counters; bank the accrued metered
    // usage into `used` instead of reporting a smaller month.
    if (node.total_rx < base.mrx || node.total_tx < base.mtx) {
      base.used = lastMonthUsed[key] ?? base.used
      base.mrx = node.total_rx; base.mtx = node.total_tx
      dirty = true
    }
    if (node.total_rx < base.drx || node.total_tx < base.dtx) { base.drx = node.total_rx; base.dtx = node.total_tx; dirty = true }
    node.month_rx = node.total_rx - base.mrx
    node.month_tx = node.total_tx - base.mtx
    node.day_rx = node.total_rx - base.drx
    node.day_tx = node.total_tx - base.dtx
    // Banked usage plus this push's delta, metered the way the plan meters it.
    node.month_used = (base.used || 0) + monthUsage({ month_rx: node.month_rx, month_tx: node.month_tx, traffic_mode: node.traffic_mode })
    lastMonthUsed[key] = node.month_used
    // The reset day comes from the VPS record, so the 流量重置 row lights up.
    node.traffic_reset_day = base.reset_day
    if (node.metrics) {
      node.metrics.month_rx = node.month_rx
      node.metrics.month_tx = node.month_tx
      node.metrics.total_rx = node.total_rx
      node.metrics.total_tx = node.total_tx
    }
  }
  if (dirty || Date.now() - trafficSaveAt > 15000) {
    trafficSaveAt = Date.now()
    try { localStorage.setItem(TRAFFIC_KEY, JSON.stringify(trafficBases)) } catch { /* storage may be blocked */ }
  }
  // Refresh the collector records at most once a minute; the next push
  // picks up rollovers, re-alignments and calibrations.
  if (Date.now() - vpsFetchAt > 60000) {
    vpsFetchAt = Date.now()
    void fetchVpsUsage()
  }
  return nodes
}

/* ---------- local metric history (accumulated from the live stream) ---------- */

type Agg = { n: number; cpu: number; mem: number; disk: number; rx: number; tx: number; rxMax: number; txMax: number }
const FINE_BUCKET = 30
const COARSE_BUCKET = 300
const fine = new Map<number, Map<number, Agg>>()
const coarse = new Map<number, Map<number, Agg>>()

function recordInto(store: Map<number, Map<number, Agg>>, size: number, keepSec: number, id: number, ts: number, node: Node) {
  let series = store.get(id)
  if (!series) { series = new Map(); store.set(id, series) }
  const bucket = Math.floor(ts / size) * size
  let agg = series.get(bucket)
  if (!agg) { agg = { n: 0, cpu: 0, mem: 0, disk: 0, rx: 0, tx: 0, rxMax: 0, txMax: 0 }; series.set(bucket, agg) }
  const m = node.metrics!
  agg.n++
  agg.cpu += m.cpu
  agg.mem += m.mem_used
  agg.disk += m.disk_used
  agg.rx += m.net_rx
  agg.tx += m.net_tx
  agg.rxMax = Math.max(agg.rxMax, m.net_rx)
  agg.txMax = Math.max(agg.txMax, m.net_tx)
  const cutoff = ts - keepSec
  for (const key of series.keys()) if (key < cutoff) series.delete(key)
}

function recordHistory(nodes: Node[], tsSec: number) {
  for (const node of nodes) {
    if (!node.online || !node.metrics) continue
    recordInto(fine, FINE_BUCKET, 26 * 3600, node.id, tsSec, node)
    recordInto(coarse, COARSE_BUCKET, 8 * 86400, node.id, tsSec, node)
  }
}

type HistoryPoint = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  net_rx_max: number
  net_tx_max: number
}

function historyFor(id: number, hours: number, points: number): { metrics: HistoryPoint[]; ping: never[]; probes: Record<string, string> } {
  const nowSec = Math.floor(Date.now() / 1000)
  const from = nowSec - hours * 3600
  const store = hours <= 26 ? fine : coarse
  const series = store.get(id)
  if (!series) return { metrics: [], ping: [], probes: {} }
  let buckets = [...series.entries()]
    .filter(([ts]) => ts >= from - COARSE_BUCKET)
    .sort((a, b) => a[0] - b[0])
    .map(([ts, a]) => ({
      ts, cpu: a.cpu / a.n, mem_used: a.mem / a.n, disk_used: a.disk / a.n,
      net_rx: a.rx / a.n, net_tx: a.tx / a.n, net_rx_max: a.rxMax, net_tx_max: a.txMax, n: a.n,
    }))
  if (buckets.length > points) {
    const group = Math.ceil(buckets.length / points)
    const merged: typeof buckets = []
    for (let i = 0; i < buckets.length; i += group) {
      const slice = buckets.slice(i, i + group)
      const n = slice.reduce((s, b) => s + b.n, 0)
      merged.push({
        ts: slice[0].ts,
        cpu: slice.reduce((s, b) => s + b.cpu * b.n, 0) / n,
        mem_used: slice.reduce((s, b) => s + b.mem_used * b.n, 0) / n,
        disk_used: slice.reduce((s, b) => s + b.disk_used * b.n, 0) / n,
        net_rx: slice.reduce((s, b) => s + b.net_rx * b.n, 0) / n,
        net_tx: slice.reduce((s, b) => s + b.net_tx * b.n, 0) / n,
        net_rx_max: Math.max(...slice.map((b) => b.net_rx_max)),
        net_tx_max: Math.max(...slice.map((b) => b.net_tx_max)),
        n,
      })
    }
    buckets = merged
  }
  return {
    metrics: buckets.map(({ n: _n, ...point }) => point),
    ping: [],
    probes: {},
  }
}

/* ---------- latency history (Nezha service monitors) ---------- */

type MonitorSeries = {
  monitor_id: number
  monitor_name: string
  created_at: number[]
  avg_delay: (number | null)[]
}

const monitorCache = new Map<number, { at: number; data: Promise<MonitorSeries[]> }>()

function fetchMonitorSeries(id: number): Promise<MonitorSeries[]> {
  const hit = monitorCache.get(id)
  if (hit && Date.now() - hit.at < 60000) return hit.data
  const data = (async () => {
    const res = await fetch(`/api/v1/monitor/${id}`)
    if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText)
    const body = (await res.json()) as { result?: MonitorSeries[] | null }
    return body.result ?? []
  })()
  monitorCache.set(id, { at: Date.now(), data })
  return data
}

type PingPointOut = { task_id: number; ts: number; latency: number | null }

/**
 * The dashboard's per-server monitor API answers with parallel arrays of
 * minute buckets (ms timestamps + average delay) for the last 24 hours.
 * A bucket at the 1000 ms cap, at zero, or missing is a lost minute: it
 * becomes a null point and counts towards the window loss the chips show.
 */
async function pingHistory(id: number, hours: number) {
  const series = await fetchMonitorSeries(id)
  const fromSec = Math.floor(Date.now() / 1000) - hours * 3600
  const ping: PingPointOut[] = []
  const probes: Record<string, string> = {}
  const loss: Record<string, number> = {}
  for (const s of series) {
    probes[s.monitor_id] = s.monitor_name
    let total = 0
    let lost = 0
    for (let i = 0; i < s.created_at.length; i++) {
      const ts = Math.floor(s.created_at[i] / 60000) * 60
      if (ts < fromSec) continue
      const raw = s.avg_delay[i]
      const bad = raw === null || raw === undefined || !Number.isFinite(raw) || raw <= 0 || raw >= 1000
      total++
      if (bad) lost++
      ping.push({ task_id: s.monitor_id, ts, latency: bad ? null : raw })
    }
    if (total > 0 && lost > 0) loss[s.monitor_id] = (lost / total) * 100
  }
  return { metrics: [], ping, probes, loss }
}

/* ---------- api() routing ---------- */

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (path === "/me") {
    // The site name lives in the panel snapshot; load it on first use. A
    // failed load must not block the page: fall back to a neutral name.
    try { await ensureSnapshot(60000, init?.signal ?? undefined) } catch { /* keep fallback */ }
    return { authed: false, github: false, site_name: siteName || "Monitor", public_page: true } as T
  }
  const metricsMatch = /^\/nodes\/(\d+)\/metrics\?(.*)$/.exec(path)
  if (metricsMatch) {
    const params = new URLSearchParams(metricsMatch[2])
    const hours = Number(params.get("hours") ?? 1) || 1
    const points = Number(params.get("points") ?? 600) || 600
    const series = params.get("series") ?? "metrics"
    if (series === "ping") return (await pingHistory(Number(metricsMatch[1]), hours)) as T
    return historyFor(Number(metricsMatch[1]), hours, points) as T
  }
  if (path === "/nodes") {
    const nodes = await ensureSnapshot(0, init?.signal ?? undefined)
    const cloned = nodes.map((n) => ({ ...n, metrics: n.metrics ? { ...n.metrics } : null }))
    return { nodes: ingest(cloned) } as unknown as T
  }
  throw new ApiError(404, `Unsupported endpoint: ${path}`)
}

/** Shared ingest: traffic accounting + history sampling for one snapshot of nodes. */
function ingest(nodes: Node[]): Node[] {
  const stamped = applyTraffic(nodes)
  recordHistory(stamped, Math.floor(Date.now() / 1000))
  return stamped
}

const METRIC_FIELDS = ["uptime", "cpu", "mem_total", "mem_used", "swap_total", "swap_used", "disk_total", "disk_used",
  "net_rx", "net_tx", "total_rx", "total_tx", "month_rx", "month_tx", "tcp", "udp", "procs"] as const
const nonnegativeNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0

/** A malformed report must not remove every other node from the page. */
export function safeNodes(nodes: unknown): Node[] {
  if (!Array.isArray(nodes)) throw new Error("Invalid node data format")
  return nodes.filter((node): node is Node => node !== null && typeof node === "object" && Number.isSafeInteger(node.id)).map((node) => {
    const m = node.metrics
    return m == null || (METRIC_FIELDS.every((key) => nonnegativeNumber(m[key])) && Array.isArray(m.load) && m.load.length === 3 && m.load.every(nonnegativeNumber))
      ? node : { ...node, metrics: null }
  })
}

/** Keep unchanged rows stable across JSON snapshots so memoized rows can skip a paint. */
export function shareNodes(previous: Node[] | null, incoming: Node[]): Node[] {
  if (!previous) return incoming
  const byId = new Map(previous.map((node) => [node.id, node]))
  const next = incoming.map((node) => {
    const old = byId.get(node.id)
    if (!old) return node
    const a = old.metrics
    const b = node.metrics
    const sameMetrics = a === b || (a != null && b != null && METRIC_FIELDS.every((key) => a[key] === b[key]) && a.load.every((value, i) => value === b.load[i]))
    const keys = Object.keys(node) as (keyof Node)[]
    if (sameMetrics && keys.length === Object.keys(old).length && keys.every((key) => key === "metrics" || old[key] === node[key])) return old
    return sameMetrics && a !== b ? { ...node, metrics: a } : node
  })
  return next.length === previous.length && next.every((node, i) => node === previous[i]) ? previous : next
}

type NodeObserver = {
  onNodes: (nodes: Node[]) => void
  onError: (error: Error) => void
}

/**
 * One live subscription against the Nezha dashboard: the embedded panel
 * snapshot seeds the list (and carries the billing notes), the dashboard
 * `/ws` push keeps it live, and snapshot polling is the fallback.
 */
export function subscribeNodes({ onNodes, onError }: NodeObserver) {
  // Month baselines come from the VPS store when it answers; otherwise the
  // localStorage fallback in applyTraffic keeps the page working.
  loadVpsUsage()
  let socket: WebSocket | null = null
  let poll: ReturnType<typeof setTimeout> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let notesTimer: ReturnType<typeof setTimeout> | null = null
  let polling = false
  let pollGeneration = 0
  let disposed = false
  let visible = typeof document === "undefined" || document.visibilityState !== "hidden"

  const emit = (nodes: Node[]) => onNodes(safeNodes(ingest(nodes)))

  const fetchOnce = async () => {
    if (disposed || !visible) return
    try {
      emit(await ensureSnapshot(0))
    } catch (error) {
      if (!disposed) onError(error instanceof Error ? error : new Error("Network error"))
    }
  }

  const pollOnce = () => {
    poll = null
    const generation = pollGeneration
    void fetchOnce().finally(() => {
      if (polling && !disposed && visible && generation === pollGeneration) poll = setTimeout(pollOnce, 5000)
    })
  }
  const startPolling = () => {
    if (!polling && !disposed && visible) {
      polling = true
      poll = setTimeout(pollOnce, 5000)
    }
  }
  const stopPolling = () => {
    polling = false
    pollGeneration++
    if (poll) clearTimeout(poll)
    poll = null
  }

  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
  const reconnect = () => {
    if (!disposed && visible && !retry) retry = setTimeout(() => { retry = null; connect() }, 5000)
  }
  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = null
  }
  const armWatchdog = (current: WebSocket) => {
    clearWatchdog()
    watchdog = setTimeout(() => {
      watchdog = null
      if (disposed || !visible || socket !== current) return
      socket = null
      current.onmessage = current.onerror = current.onclose = null
      try { current.close() } catch { /* A pending handshake may reject close(). */ }
      startPolling()
      reconnect()
    }, 30000)
  }
  const connect = () => {
    if (disposed || !visible) return
    let current: WebSocket
    try {
      current = new WebSocket(url)
      socket = current
      armWatchdog(current)
    } catch {
      startPolling()
      reconnect()
      return
    }
    current.onmessage = (event) => {
      if (disposed || !visible || socket !== current || typeof event.data !== "string") return
      try {
        const data = JSON.parse(event.data) as { now?: number; servers?: V0Server[] }
        if (!Array.isArray(data?.servers)) return
        const nowMs = data.now ?? Date.now()
        emit(data.servers.map((sv) => mapServer(sv, null, notesById, nowMs)))
        stopPolling()
        armWatchdog(current)
      } catch {
        if (disposed || !visible || socket !== current) return
        onError(new Error("Invalid live data format; reconnecting"))
        current.close()
      }
    }
    current.onerror = () => current.close()
    current.onclose = () => {
      if (disposed || !visible || socket !== current) return
      clearWatchdog()
      socket = null
      startPolling()
      reconnect()
    }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      visible = false
      stopPolling()
      clearWatchdog()
      if (retry) clearTimeout(retry)
      retry = null
      const current = socket
      socket = null
      if (current) {
        current.onmessage = current.onerror = current.onclose = null
        current.close()
      }
    } else if (!visible && !disposed) {
      visible = true
      void fetchOnce()
      connect()
    }
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange)

  void fetchOnce()
  if (visible) connect()
  // Notes and the site name change rarely; refresh the snapshot quietly.
  const refreshNotes = () => {
    notesTimer = null
    if (disposed) return
    void ensureSnapshot(0).catch(() => { /* the stream remains authoritative */ })
    notesTimer = setTimeout(refreshNotes, 300000)
  }
  notesTimer = setTimeout(refreshNotes, 300000)
  return () => {
    disposed = true
    clearWatchdog()
    stopPolling()
    if (retry) clearTimeout(retry)
    if (notesTimer) clearTimeout(notesTimer)
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange)
    if (socket) {
      socket.onmessage = socket.onerror = socket.onclose = null
      socket.close()
    }
  }
}

/** Live node list, preferring the hub's two-second WebSocket snapshots. */
export function useNodes() {
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A 401 means the status page was closed to anonymous callers after loading.
  const [closed, setClosed] = useState(false)

  useEffect(() => subscribeNodes({
    onNodes: (next) => {
      // Let taps and scrolling win over the recurring telemetry paints.
      startTransition(() => setNodes((previous) => shareNodes(previous, next)))
      setError(null)
      setClosed(false)
    },
    onError: (error) => {
      setError(error.message || "Network error")
      if (error instanceof ApiError && error.status === 401) setClosed(true)
    },
  }), [])

  return { nodes, error, closed }
}
