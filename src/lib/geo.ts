/** Node/country geo tables ported verbatim from the v190 theme.
 * NODE_GEO/NODE_CC/NODE_CITY are hand-placed city coordinates keyed by
 * lowercase node name; CC_* are the automatic per-country fallbacks the
 * v190 "full-auto" rule uses when a node has no hand entry or its
 * reported country no longer matches the hand entry's country. */
export const NODE_GEO: Record<string, [number, number]> = {
  "home": [
    30,
    114
  ],
  "star": [
    46.5,
    2.5
  ],
  "sailor": [
    22.2,
    113.55
  ],
  "haruka": [
    37.4,
    -122.1
  ],
  "kuroit": [
    1.35,
    103.8
  ],
  "exact": [
    50.1,
    8.7
  ],
  "cheap1": [
    35.7,
    139.7
  ],
  "cheap2": [
    1.35,
    103.8
  ],
  "alice": [
    51.5,
    -0.1
  ]
}
export const NODE_CC: Record<string, string> = {
  "home": "CN",
  "star": "FR",
  "sailor": "MO",
  "haruka": "US",
  "kuroit": "SG",
  "exact": "DE",
  "cheap1": "JP",
  "cheap2": "SG",
  "alice": "GB"
}
export const CC_GEO: Record<string, [number, number]> = {
  "CN": [
    35,
    105
  ],
  "HK": [
    22.3,
    114.2
  ],
  "MO": [
    22.2,
    113.55
  ],
  "TW": [
    23.7,
    121
  ],
  "JP": [
    36,
    138
  ],
  "KR": [
    36.5,
    127.9
  ],
  "SG": [
    1.35,
    103.8
  ],
  "US": [
    39.8,
    -98.5
  ],
  "CA": [
    56,
    -106
  ],
  "GB": [
    54,
    -2
  ],
  "DE": [
    51,
    10
  ],
  "FR": [
    46.5,
    2.5
  ],
  "NL": [
    52.2,
    5.3
  ],
  "RU": [
    60,
    90
  ],
  "AU": [
    -25,
    133
  ],
  "AQ": [
    -80,
    0
  ]
}
export const CC_NAME: Record<string, string> = {
  "CN": "China",
  "HK": "Hong Kong",
  "MO": "Macao",
  "TW": "Taiwan",
  "JP": "Japan",
  "KR": "South Korea",
  "SG": "Singapore",
  "US": "United States",
  "CA": "Canada",
  "GB": "United Kingdom",
  "DE": "Germany",
  "FR": "France",
  "NL": "Netherlands",
  "RU": "Russia",
  "AU": "Australia",
  "AQ": "Antarctica"
}
export const CC_CITY: Record<string, string> = {
  "CN": "Beijing",
  "HK": "Hong Kong",
  "MO": "Macao",
  "TW": "Taipei",
  "JP": "Tokyo",
  "KR": "Seoul",
  "SG": "Singapore",
  "US": "Washington",
  "CA": "Ottawa",
  "GB": "London",
  "DE": "Berlin",
  "FR": "Paris",
  "NL": "Amsterdam",
  "RU": "Moscow",
  "AU": "Canberra"
}
export const NODE_CITY: Record<string, string> = {
  "home": "Wuhan",
  "star": "Paris",
  "sailor": "Macao",
  "haruka": "San Francisco",
  "kuroit": "Singapore",
  "exact": "Frankfurt",
  "cheap1": "Tokyo",
  "cheap2": "Singapore",
  "alice": "London"
}
