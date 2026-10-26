import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const fixture = spawn(process.execPath, [fileURLToPath(new URL("../tests/serve.mjs", import.meta.url))], {
  stdio: ["ignore", "pipe", "inherit"],
})
let ready = false
const started = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Preview fixture did not start within 30 seconds")), 30000)
  fixture.stdout.on("data", (chunk) => {
    process.stdout.write(chunk)
    if (!ready && chunk.toString().includes("fixture ready")) {
      ready = true
      clearTimeout(timeout)
      resolve()
    }
  })
  fixture.on("error", reject)
  fixture.on("exit", (code) => { if (!ready) reject(new Error(`Preview fixture exited (${code})`)) })
})
try {
  await started
  const runner = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url)), "test", ...process.argv.slice(2)], {
    stdio: "inherit",
  })
  const code = await new Promise((resolve, reject) => {
    runner.on("error", reject)
    runner.on("exit", (result) => resolve(result ?? 1))
  })
  fixture.kill()
  process.exit(code)
} catch (error) {
  fixture.kill()
  console.error(error)
  process.exit(1)
}
