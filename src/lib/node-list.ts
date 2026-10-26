import type { Node } from "./api.ts"
import { monthUsage, percent } from "./format.ts"

export type NodeSortKey = "default" | "name" | "cpu" | "memory" | "traffic" | "network"
export type NodeListPreferences = {
  /** "all" or a server group name (the panel's Tag). */
  group: string
  sort: NodeSortKey
  direction: "asc" | "desc"
}

export const DEFAULT_LIST_PREFERENCES: NodeListPreferences = { group: "all", sort: "default", direction: "asc" }
export const LIST_PREFERENCES_KEY = "monitor-glass:node-list:v1"

/** Persist choices, never a search query or server data. Storage may be blocked. */
export function readListPreferences(storage?: Pick<Storage, "getItem">): NodeListPreferences {
  try {
    const raw = (storage ?? window.localStorage).getItem(LIST_PREFERENCES_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return { ...DEFAULT_LIST_PREFERENCES }
    const saved = value as Record<string, unknown>
    return {
      group: typeof saved.group === "string" && saved.group ? saved.group : "all",
      sort: typeof saved.sort === "string" && ["default", "name", "cpu", "memory", "traffic", "network"].includes(saved.sort) ? saved.sort as NodeSortKey : "default",
      direction: saved.direction === "desc" ? "desc" : "asc",
    }
  } catch {
    return { ...DEFAULT_LIST_PREFERENCES }
  }
}

export function saveListPreferences(preferences: NodeListPreferences, storage?: Pick<Storage, "setItem">) {
  try {
    (storage ?? window.localStorage).setItem(LIST_PREFERENCES_KEY, JSON.stringify({ version: 1, ...preferences }))
  } catch {
    // A disabled or full storage must not interrupt the live list.
  }
}

/** Same resource thresholds as the red meters; offline and missing reports need attention too. */
export function needsAttention(node: Node) {
  const metrics = node.metrics
  return !node.online || !metrics || metrics.cpu >= 90
    || percent(metrics.mem_used, metrics.mem_total) >= 90
    || percent(metrics.disk_used, metrics.disk_total) >= 90
    || (node.traffic_limit > 0 && monthUsage(node) >= node.traffic_limit)
}

const regionNames = [new Intl.DisplayNames(["zh-CN"], { type: "region" }), new Intl.DisplayNames(["en"], { type: "region" })]
const countryCache = new Map<string, string>()

function countryTerms(country: string) {
  const code = country.toUpperCase()
  if (countryCache.has(code)) return countryCache.get(code)!
  let names = code
  if (/^[A-Z]{2}$/.test(code)) names += " " + regionNames.map((regions) => regions.of(code) ?? "").join(" ")
  countryCache.set(code, names)
  return names
}

/** Only public fields: panel-only hostname, IP and remarks cannot become search hints. */
function searchText(node: Node) {
  return [node.name, node.group, countryTerms(node.country), node.os, node.kernel, node.arch, node.virt, node.cpu_name]
    .join(" ").toLocaleLowerCase()
}

const nameOrder = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })

function metricValue(node: Node, sort: NodeSortKey): number | null {
  if (sort === "traffic") return node.total_rx + node.total_tx
  if (!node.online || !node.metrics) return null
  if (sort === "cpu") return node.metrics.cpu
  if (sort === "memory") return node.metrics.mem_total > 0 ? percent(node.metrics.mem_used, node.metrics.mem_total) : null
  if (sort === "network") return node.metrics.net_rx + node.metrics.net_tx
  return null
}

/** Keep the source array untouched and equal values in administrator order on every update. */
export function selectNodes(nodes: readonly Node[], query: string, preferences: NodeListPreferences): Node[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const selected = nodes.filter((node) => {
    if (preferences.group !== "all" && node.group !== preferences.group) return false
    if (!terms.length) return true
    const text = searchText(node)
    return terms.every((term) => text.includes(term))
  })
  const direction = preferences.direction === "desc" ? -1 : 1
  return selected.sort((a, b) => {
    // Panel order: DisplayIndex descending, exactly as the source site lists
    // them; the direction toggle never flips the panel's own order.
    const fallback = b.sort - a.sort || a.id - b.id
    if (preferences.sort === "default") return fallback
    if (preferences.sort === "name") return direction * nameOrder.compare(a.name, b.name) || fallback
    const av = metricValue(a, preferences.sort)
    const bv = metricValue(b, preferences.sort)
    // Missing telemetry belongs at the end in either direction, never among real zeroes.
    if (av === null || bv === null) return av === bv ? fallback : av === null ? 1 : -1
    return direction * (av - bv) || fallback
  })
}
