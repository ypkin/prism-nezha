/// <reference types="node" />
import assert from "node:assert/strict"
import type { Node } from "./api.ts"
import { DEFAULT_LIST_PREFERENCES, LIST_PREFERENCES_KEY, needsAttention, readListPreferences, saveListPreferences, selectNodes, type NodeListPreferences } from "./node-list.ts"

const base: Node = {
  id: 1, name: "Tokyo 2", sort: 2, public: true, online: true, country: "JP", last_seen: 100,
  os: "Debian GNU/Linux 12", kernel: "6.1", arch: "aarch64", virt: "KVM", cpu_name: "AMD EPYC", cpu_cores: 2,
  mem_total: 1000, swap_total: 0, disk_total: 10000, agent_version: "1.0", price: 0, currency: "USD",
  billing_cycle: "monthly", expires_at: null, starts_at: null, traffic_limit: 1000, traffic_mode: "sum", traffic_reset_day: 1, ipv4: true, ipv6: true,
  total_rx: 100, total_tx: 300, month_rx: 30, month_tx: 70, month_start: "2026-09", day_rx: 10, day_tx: 10,
  hostname: "secret-host", ip: "192.0.2.44", remark: "private-note", group: "Local",
  metrics: {
    uptime: 3600, cpu: 30, load: [0.1, 0.2, 0.3], mem_total: 1000, mem_used: 500,
    swap_total: 0, swap_used: 0, disk_total: 10000, disk_used: 2000, net_rx: 10, net_tx: 20,
    total_rx: 100, total_tx: 300, month_rx: 30, month_tx: 70, tcp: 10, udp: 2, procs: 30,
  },
}
const offline: Node = { ...base, id: 2, sort: 1, name: "Tokyo 10", online: false, country: "US", metrics: { ...base.metrics!, cpu: 99 } }
const busy: Node = { ...base, id: 3, sort: 3, name: "Berlin", country: "DE", group: "Stable", month_used: 700, metrics: { ...base.metrics!, cpu: 90, mem_used: 950, net_rx: 500 } }
const missing: Node = { ...base, id: 4, sort: 4, name: "Waiting", country: "", group: "Free", metrics: null }
const source = [base, busy, missing, offline]
const ids = (query = "", preferences: Partial<NodeListPreferences> = {}, nodes: Node[] = source) => selectNodes(nodes, query, { ...DEFAULT_LIST_PREFERENCES, ...preferences }).map((node) => node.id)

assert.deepEqual(ids(), [4, 3, 1, 2], "default order follows the panel (DisplayIndex descending)")
assert.deepEqual(ids("", { direction: "desc" }), [4, 3, 1, 2])
assert.deepEqual(source.map((node) => node.id), [1, 3, 4, 2], "sorting never mutates the live source")
assert.deepEqual(ids(" tokYO  "), [2, 1], "search trims whitespace and ignores case")
assert.deepEqual(ids("JP debian KVM aarch64"), [1], "tokens match across public fields")
assert.deepEqual(ids("日本"), [1], "Chinese country names are searchable")
assert.deepEqual(ids("Germany"), [3], "English country names are searchable")
assert.deepEqual(ids("东京 no-such-node"), [], "every search term is required")
for (const query of ["secret-host", "192.0.2.44", "private-note"]) assert.deepEqual(ids(query), [], "admin-only fields never match")
assert.deepEqual(ids("", { group: "Local" }), [2, 1])
assert.deepEqual(ids("", { group: "Stable" }), [3])
assert.deepEqual(ids("", { group: "Free" }), [4])
assert.deepEqual(ids("", { group: "Nope" }), [])
assert.deepEqual(ids("Tokyo", { group: "Local" }), [2, 1], "search and group filters compose")
assert.deepEqual(ids("", { sort: "name" }), [3, 1, 2, 4], "natural names put node 2 before node 10")
assert.deepEqual(ids("", { sort: "cpu" }), [1, 3, 2, 4])
assert.deepEqual(ids("", { sort: "cpu", direction: "desc" }), [3, 1, 2, 4], "offline and missing telemetry stay last in either direction")
assert.deepEqual(ids("", { sort: "memory", direction: "desc" }), [3, 1, 2, 4])
assert.deepEqual(ids("", { sort: "network", direction: "desc" }), [3, 1, 2, 4])
assert.deepEqual(ids("", { sort: "traffic", direction: "desc" }), [3, 2, 1, 4], "monthly plan usage sorts even for offline servers")
assert.deepEqual(ids("", { sort: "cpu", direction: "desc" }, [base, { ...base, id: 8, sort: 0 }]), [8, 1], "equal metrics use stable administrator order")
assert.deepEqual(ids("", { sort: "memory" }, [base, { ...base, id: 9, metrics: { ...base.metrics!, mem_total: 0 } }]), [1, 9], "an unknown memory capacity is not a real zero")
assert.deepEqual(ids("", { sort: "traffic" }, [base, { ...base, id: 9, month_rx: 500, month_tx: 2, traffic_mode: "up" }]), [9, 1], "traffic follows the configured accounting mode")

assert.equal(needsAttention(base), false)
assert.equal(needsAttention(offline), true)
assert.equal(needsAttention(missing), true)
for (const patch of [{ cpu: 90 }, { mem_used: 900 }, { disk_used: 9000 }]) {
  assert.equal(needsAttention({ ...base, metrics: { ...base.metrics!, ...patch } }), true, "resource threshold includes exactly 90%")
}
assert.equal(needsAttention({ ...base, metrics: { ...base.metrics!, cpu: 89.9, mem_used: 899, disk_used: 8999 } }), false)
assert.equal(needsAttention({ ...base, month_used: 1000 }), true, "an exhausted traffic allowance needs attention")
assert.equal(needsAttention({ ...base, month_used: 999 }), false)
assert.equal(needsAttention({ ...base, traffic_limit: 0, month_used: 99999 }), false, "an unlimited plan cannot exceed a quota")

const read = (raw: string | null) => readListPreferences({ getItem: () => raw })
for (const raw of [null, "not-json", "null", "[]", "1", '{"version":2}', '{"status":"offline"}']) {
  assert.deepEqual(read(raw), DEFAULT_LIST_PREFERENCES, "unknown or malformed storage falls back safely")
}
assert.deepEqual(read('{"version":1,"status":["online"],"sort":"invalid","direction":"sideways"}'), DEFAULT_LIST_PREFERENCES)
const preferences: NodeListPreferences = { group: "Stable", sort: "cpu", direction: "desc" }
let saved = ""
saveListPreferences(preferences, { setItem: (key, value) => { assert.equal(key, LIST_PREFERENCES_KEY); saved = value } })
assert.deepEqual(read(saved), preferences, "supported preferences round-trip")
assert.equal(Object.hasOwn(JSON.parse(saved), "query"), false)
assert.deepEqual(readListPreferences({ getItem: () => { throw new Error("blocked") } }), DEFAULT_LIST_PREFERENCES)
assert.doesNotThrow(() => saveListPreferences(preferences, { setItem: () => { throw new Error("full") } }))
assert.deepEqual(readListPreferences(), DEFAULT_LIST_PREFERENCES, "reading without a browser is safe")
console.log("node list: public search, group filters, attention thresholds, stable sorting, missing metrics and safe preferences passed")
