import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))
const pkg = read("package.json")
const lock = read("package-lock.json")
const theme = read("theme.json")
assert.equal(theme.version, pkg.version, "Theme and package versions must match")
assert.equal(lock.version, pkg.version, "Lockfile version must match")
assert.equal(lock.packages[""].version, pkg.version, "Root lockfile package must match")
if (process.env.GITHUB_REF?.startsWith("refs/tags/")) {
  assert.equal(process.env.GITHUB_REF, `refs/tags/v${pkg.version}`, "Release tag must match the packaged version")
}
const preview = readFileSync(new URL("../preview.png", import.meta.url))
assert.equal(preview.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Preview must be a PNG")
assert.ok(preview.readUInt32BE(16) >= 1280 && preview.readUInt32BE(20) >= 720, "Preview must be large enough to read")
const notes = readFileSync(new URL("../RELEASE_NOTES.md", import.meta.url), "utf8")
assert.ok(notes.startsWith(`# Monitor Glass v${pkg.version}\n`), "Release notes must describe this version")
console.log(`Release metadata and preview verified: v${pkg.version}`)
