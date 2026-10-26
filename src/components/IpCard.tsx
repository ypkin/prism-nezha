import { useEffect, useState } from "react"
import { FLAGS } from "./ServerTable"

/**
 * The v190 visitor-IP card, ported as-is: a floating pill showing the
 * visitor's own flag | IP | ISP, fetched from ip-api.com with ipapi.co
 * and api.ip.sb as fallbacks. Bottom-left card on desktop, a centred
 * pill near the bottom on mobile; auto-hides 15s after it appears and
 * can be closed with the ×.
 */
type IpInfo = { ip: string; isp: string; cc: string }

const SOURCES: { url: string; parse: (d: any) => IpInfo | null }[] = [
  {
    url: "https://ip-api.com/json/?fields=status,countryCode,isp,query",
    parse: (d: any) => (d && d.status === "success" ? { ip: d.query, isp: d.isp, cc: d.countryCode } : null),
  },
  {
    url: "https://ipapi.co/json/",
    parse: (d: any) => (d && d.ip ? { ip: d.ip, isp: d.org, cc: d.country_code } : null),
  },
  {
    url: "https://api.ip.sb/geoip",
    parse: (d: any) => (d && d.ip ? { ip: d.ip, isp: d.isp, cc: d.country_code } : null),
  },
]

function flagEmoji(cc: string): string {
  if (!cc || cc.length !== 2) return ""
  const up = cc.toUpperCase()
  if (!/^[A-Z]{2}$/.test(up)) return ""
  return String.fromCodePoint(...[...up].map((c) => 127397 + c.charCodeAt(0)))
}

export function IpCard() {
  const [info, setInfo] = useState<IpInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let cancelled = false
    const hideTimer = setTimeout(() => setHidden(true), 15000)
    ;(async () => {
      for (const source of SOURCES) {
        try {
          const response = await fetch(source.url)
          const data = await response.json()
          const parsed = source.parse(data)
          if (parsed && parsed.ip) {
            if (!cancelled) setInfo(parsed)
            return
          }
        } catch {
          // fall through to the next source
        }
      }
      if (!cancelled) setFailed(true)
    })()
    return () => {
      cancelled = true
      clearTimeout(hideTimer)
    }
  }, [])

  if (hidden) return null
  const flag = info ? flagEmoji(info.cc) : ""
  const flagSrc = info ? FLAGS[info.cc.toLowerCase()] : undefined
  return (
    <div className="nz-ip-card">
      <span className="nz-ip-flag">{flagSrc ? <img src={flagSrc} alt={info ? info.cc.toUpperCase() : ""} className="nz-ip-flag-img" /> : (flag || (info ? info.cc.toUpperCase() : ""))}</span>
      <span className="nz-ip-sep">|</span>
      <span className={info && info.ip.includes(":") ? "nz-ip-addr nz-ip-v6" : "nz-ip-addr"}>{info ? info.ip : failed ? "Failed to get IP" : "Getting IP..."}</span>
      <span className="nz-ip-sep">|</span>
      <span className="nz-ip-isp">{info ? info.isp : ""}</span>
      <span
        className="nz-ip-close"
        title="Close"
        role="button"
        aria-label="Close"
        onClick={() => setHidden(true)}
      >
        ×
      </span>
    </div>
  )
}
