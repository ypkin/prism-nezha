// Synthetic public telemetry shared by browser checks and preview generation.
// Never points at a real hub or includes private addresses or credentials.
const GiB = 1024 ** 3
export const nodes = [
  ["Tokyo", "JP", "Debian 13", 12.8, 29.6, 10.0],
  ["Singapore", "SG", "Ubuntu 24.04", 24.5, 48.2, 28.6],
  ["Hong Kong", "HK", "Debian 13", 8.4, 36.5, 18.2],
  ["Los Angeles", "US", "Debian 12", 38.6, 62.4, 41.8],
  ["Frankfurt", "DE", "Ubuntu 24.04", 18.2, 42.0, 24.5],
  ["Sydney", "AU", "Alpine Linux", 5.6, 21.3, 12.7],
].map(([name, country, os, cpu, mem, disk], index) => ({
  id: index + 1, name, country, os, sort: index, public: true, online: true,
  last_seen: 1790143200, kernel: "6.12.43-amd64", arch: "x86_64", virt: "kvm",
  cpu_name: "AMD EPYC 7B13", cpu_cores: 2, mem_total: 2 * GiB, swap_total: 0,
  disk_total: 40 * GiB, agent_version: "1.0.0", price: 0, currency: "USD",
  billing_cycle: "monthly", expires_at: null, traffic_limit: 2 * 1024 * GiB,
  traffic_mode: "sum", traffic_reset_day: 1, month_start: "2026-09-01",
  total_rx: (620 + index * 85) * GiB, total_tx: (410 + index * 72) * GiB,
  month_rx: (82 + index * 30) * GiB, month_tx: (48 + index * 18) * GiB,
  day_rx: (2.4 + index) * GiB, day_tx: (1.2 + index) * GiB,
  metrics: {
    uptime: (17 + index * 3) * 86400, cpu, load: [0.12, 0.08, 0.06],
    mem_total: 2 * GiB, mem_used: 2 * GiB * mem / 100, swap_total: 0, swap_used: 0,
    disk_total: 40 * GiB, disk_used: 40 * GiB * disk / 100,
    net_rx: (420 + index * 125) * 1024, net_tx: (185 + index * 90) * 1024,
    total_rx: (620 + index * 85) * GiB, total_tx: (410 + index * 72) * GiB,
    month_rx: (82 + index * 30) * GiB, month_tx: (48 + index * 18) * GiB,
    tcp: 126 + index * 15, udp: 18, procs: 82 + index * 3,
  },
}))

export function history(id, hours = 24, series = "metrics") {
  const node = nodes.find((n) => n.id === id) ?? nodes[0]
  const end = 1790143200
  const metrics = Array.from({ length: 120 }, (_, i) => ({
    ts: end - (119 - i) * hours * 3600 / 119,
    cpu: Math.max(0, node.metrics.cpu + 4 * Math.sin(i / 7)),
    mem_used: node.metrics.mem_used * (1 + 0.05 * Math.sin(i / 13)),
    disk_used: node.metrics.disk_used,
    net_rx: node.metrics.net_rx * (1 + 0.4 * Math.sin(i / 5)),
    net_tx: node.metrics.net_tx * (1 + 0.3 * Math.cos(i / 9)),
    net_rx_max: node.metrics.net_rx * (i % 12 === 0 ? 2.6 : 1.3),
    net_tx_max: node.metrics.net_tx * (i % 17 === 0 ? 2.4 : 1.2),
  }))
  const ping = metrics.flatMap((point, i) => [1, 2, 3].map((task_id) => ({
    ts: point.ts, task_id, latency: 28 + task_id * 14 + 3 * Math.sin(i / 8 + task_id),
  })))
  return { metrics: series === "metrics" ? metrics : [], ping: series === "ping" ? ping : [],
    probes: { 1: "联通", 2: "电信", 3: "移动" }, loss: {} }
}
