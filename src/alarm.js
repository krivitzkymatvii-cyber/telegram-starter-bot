// Повітряні тривоги для конкретного місця (м. Рожище).
// 1) офіційне API ukrainealarm.com (якщо задано UKRAINEALARM_TOKEN)
// 2) alerts.in.ua (якщо задано ALERTS_TOKEN) 3) siren.pp.ua (з громадами) 4) ubilling.net.ua (лише область).
import { fmtDur } from "./schedule.js"

const OFFICIAL = "https://api.ukrainealarm.com/api/v3/alerts"
const ALERTS_IN = "https://api.alerts.in.ua/v1/alerts/active.json"
const SIREN = "https://siren.pp.ua/api/v3/alerts"
const UBILLING = "https://ubilling.net.ua/aerialalerts/"

export const PLACE = process.env.ALARM_PLACE || "м. Рожище"

// Які території стосуються вашого місця: від найширшої до найвужчої.
// Рожище входить до Рожищенської громади Луцького району Волинської області.
export const AREAS = [
  { level: 3, test: (n) => n.includes("Волинська область"), scope: "по всій Волинській області" },
  { level: 2, test: (n) => n.includes("Луцький район"), scope: "у Луцькому районі" },
  { level: 1, test: (n) => /Рожищ/i.test(n), scope: "у Рожищенській громаді" },
]

// стан останньої перевірки (для команди /alarm)
export const health = { at: 0, source: "", error: "" }

const COLOR = {
  red: "🔴 Червоний рівень: ракетна чи балістична загроза",
  yellow: "🟡 Жовтий рівень: загроза дронів",
}

function colorOf(alertRec) {
  const levels = (alertRec.activeAlerts || [])
    .filter((a) => a.type === "AIR")
    .flatMap((a) => a.activeAlertLevels || [])
    .map((l) => String(l.alertLevel || "").toLowerCase())

  if (levels.includes("red")) return "red"
  if (levels.includes("yellow")) return "yellow"
  return null
}

// data — масив регіонів з активними тривогами (формат ukrainealarm v3)
export function parseSiren(data) {
  let best = { level: 0, color: null, scope: "" }

  for (const rec of data) {
    const name = String(rec.regionName || "")
    const hasAir = (rec.activeAlerts || []).some((a) => a.type === "AIR")
    if (!hasAir) continue

    const area = AREAS.find((a) => a.test(name))
    if (!area) continue

    const color = colorOf(rec)
    if (area.level > best.level) best = { level: area.level, color, scope: area.scope }
    else if (area.level === best.level && color === "red") best.color = "red"
  }

  return { ...best, source: "siren.pp.ua" }
}

// alerts.in.ua: { alerts: [{ location_title, location_type, location_oblast, alert_type }] }
export function parseAlertsIn(data) {
  if (!Array.isArray(data?.alerts)) throw new Error("alerts.in.ua: неочікувана відповідь")

  let best = { level: 0, color: null, scope: "" }

  for (const a of data.alerts) {
    if (a.alert_type !== "air_raid" || a.location_oblast !== "Волинська область") continue

    const name = a.location_type === "oblast" ? "Волинська область" : String(a.location_title || "")
    const area = AREAS.find((x) => x.test(name))
    if (!area) continue

    const color = a.alert_level === "red" || a.alert_level === "yellow" ? a.alert_level : null
    if (area.level > best.level) best = { level: area.level, color, scope: area.scope }
    else if (area.level === best.level && color === "red") best.color = "red"
  }

  return { ...best, source: "alerts.in.ua" }
}

export function parseUbilling(data) {
  const st = data?.states?.["Волинська область"]
  if (typeof st?.alertnow !== "boolean") throw new Error("ubilling: неочікувана відповідь")

  return st.alertnow
    ? { level: 3, color: null, scope: "у Волинській області (точніший район невідомий)", source: "ubilling.net.ua" }
    : { level: 0, color: null, scope: "", source: "ubilling.net.ua" }
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`${new URL(url).host}: ${res.status}`)
  return res.json()
}

export async function pollAlarm() {
  // офіційний ключ UkraineAlarm: заголовок Authorization без «Bearer», формат відповіді той самий, що в siren.pp.ua
  const official = (process.env.UKRAINEALARM_TOKEN || "").trim()

  if (official) {
    try {
      const data = await getJson(OFFICIAL, { Authorization: official })
      if (!Array.isArray(data)) throw new Error("ukrainealarm: неочікувана відповідь")
      const cur = { ...parseSiren(data), source: "api.ukrainealarm.com" }
      Object.assign(health, { at: Date.now(), source: cur.source, error: "" })
      return cur
    } catch (error) {
      console.error("[alarm] ukrainealarm:", error?.message || error)
    }
  }

  const token = (process.env.ALERTS_TOKEN || "").trim()

  if (token) {
    try {
      const cur = parseAlertsIn(await getJson(ALERTS_IN, { Authorization: `Bearer ${token}` }))
      Object.assign(health, { at: Date.now(), source: cur.source, error: "" })
      return cur
    } catch (error) {
      console.error("[alarm] alerts.in.ua:", error?.message || error)
    }
  }

  try {
    const data = await getJson(SIREN)
    if (!Array.isArray(data)) throw new Error("siren: неочікувана відповідь")
    const cur = parseSiren(data)
    Object.assign(health, { at: Date.now(), source: cur.source, error: "" })
    return cur
  } catch (error) {
    console.error("[alarm] siren:", error?.message || error)

    try {
      const cur = parseUbilling(await getJson(UBILLING))
      Object.assign(health, { at: Date.now(), source: cur.source, error: "основне джерело недоступне" })
      return cur
    } catch (error2) {
      Object.assign(health, { error: String(error2?.message || error2) })
      throw error2
    }
  }
}

const EMPTY = { active: false, level: 0, color: null, since: null, scope: "", clear: 0 }

// prev — попередній стан, cur — результат pollAlarm()
export function evaluateAlarm(prev, cur, nowMs = Date.now()) {
  prev = { ...EMPTY, ...prev }
  const events = []
  let state

  if (cur.level > 0 && !prev.active) {
    state = { active: true, level: cur.level, color: cur.color, since: nowMs, scope: cur.scope, clear: 0 }
    events.push({
      type: "start",
      text:
        `🚨 ПОВІТРЯНА ТРИВОГА!\n📍 ${PLACE}: тривога ${cur.scope}.` +
        (cur.color ? `\n${COLOR[cur.color]}` : "") +
        "\n\nПрямуйте в укриття.",
    })
  } else if (cur.level > 0) {
    const widened = cur.level > prev.level
    const worse = prev.color !== "red" && cur.color === "red"
    state = {
      active: true, level: cur.level, color: cur.color || prev.color,
      since: prev.since, scope: cur.scope, clear: 0,
    }
    if (widened || worse) {
      events.push({
        type: "escalate",
        text:
          `🚨 Ситуація змінилась: ${PLACE}, тривога ${cur.scope}.` +
          (cur.color ? `\n${COLOR[cur.color]}` : "") +
          "\n\nПрямуйте в укриття.",
      })
    }
  } else if (prev.active) {
    // відбій лише після двох порожніх перевірок поспіль, щоб не реагувати на збій
    if (prev.clear < 1) {
      state = { ...prev, clear: prev.clear + 1 }
    } else {
      const mins = Math.max(1, Math.round((nowMs - (prev.since || nowMs)) / 60000))
      state = { ...EMPTY }
      events.push({
        type: "end",
        text: `✅ Відбій повітряної тривоги (${PLACE}).\nТривала: ${fmtDur(mins)}.`,
      })
    }
  } else {
    state = prev
  }

  return { state, events }
}
