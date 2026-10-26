import { createServer } from "node:http"
import { createReadStream, existsSync, statSync } from "node:fs"
import { resolve, sep, extname } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "vite"
import { nodes, history } from "./fixtures.mjs"

const dist = resolve(fileURLToPath(new URL("../dist/", import.meta.url)))
await build({ logLevel: "error" })
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1")
  let data
  if (url.pathname === "/api/me") data = { authed: false, github: false, site_name: "Monitor Glass", public_page: true }
  else if (url.pathname === "/api/nodes") data = { nodes }
  else if (/^\/api\/nodes\/\d+\/metrics$/.test(url.pathname)) {
    data = history(Number(url.pathname.split("/")[3]), Number(url.searchParams.get("hours")) || 24, url.searchParams.get("series"))
  } else if (url.pathname.startsWith("/api/")) { res.writeHead(404).end(); return }
  if (data) {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data))
    return
  }
  let file = resolve(dist, `.${decodeURIComponent(url.pathname)}`)
  if (!file.startsWith(dist + sep) && file !== dist) { res.writeHead(403).end(); return }
  if (!existsSync(file) || !statSync(file).isFile()) file = resolve(dist, "index.html")
  res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" })
  createReadStream(file).pipe(res)
})

// The page uses the HTTP fallback for integration checks. Socket races and
// reconnect behavior have focused fake-clock coverage in api.test.ts.
server.on("upgrade", (_req, socket) => socket.destroy())
await new Promise((resolve, reject) => {
  server.once("error", reject)
  server.listen(4173, "127.0.0.1", resolve)
})
console.log("Synthetic Monitor fixture ready at http://127.0.0.1:4173")

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  server.closeAllConnections()
  server.close()
  process.exit(0)
}
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(signal, stop)
