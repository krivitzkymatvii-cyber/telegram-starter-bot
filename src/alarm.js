// Повітряні тривоги: alerts.in.ua (потрібен токен у ALERTS_TOKEN)
import { fmtDur } from "./schedule.js"

const API = "https://api.alerts.in.ua/v1/alerts/active.json"
export const OBLAST = "Волинська область"

export async function fetchAlerts(token) {
  const res = await fetch(API, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`alerts API: ${res.status}`)

  const data = await res.json()
  if (!Array.isArray(data.alerts)) throw new Error("alerts API: неочікувана відповідь")
  return data.alerts
}

// prev — попередній стан, alerts — активні тривоги з API.
// Повертає новий стан і список подій (start / escalate / end).
export function evaluateAlarm(prev, alerts, nowMs = Date.now()) {
  const mine = alerts.filter(
    (a) => a.location_oblast === OBLAST && a.alert_type === "air_raid"
  )

  const level = !mine.length
    ? null
    : mine.some((a) => a.location_type === "oblast")
      ? "oblast"
      : "district"

  const places = [
    ...new Set(
      mine.filter((a) => a.location_type !== "oblast").map((a) => a.location_title)
    ),
  ]

  const events = []
  let state

  if (level && !prev.active) {
    state = { active: true, level, since: nowMs, places }
    events.push({
      type: "start",
      text:
        "🚨 ПОВІТРЯНА ТРИВОГА!\n" +
        (level === "oblast"
          ? `${OBLAST}.`
          : `${places.join(", ")} (${OBLAST}).`) +
        "\n\nПрямуйте в укриття.",
    })
  } else if (level && prev.active) {
    state = { active: true, level, since: prev.since, places }
    if (prev.level === "district" && level === "oblast") {
      events.push({
        type: "escalate",
        text: `🚨 Тривогу оголошено по всій області (${OBLAST}).\n\nПрямуйте в укриття.`,
      })
    }
  } else if (!level && prev.active) {
    const mins = Math.max(1, Math.round((nowMs - (prev.since || nowMs)) / 60000))
    state = { active: false, level: null, since: null, places: [] }
    events.push({
      type: "end",
      text: `✅ Відбій повітряної тривоги (${OBLAST}).\nТривала: ${fmtDur(mins)}.`,
    })
  } else {
    state = prev
  }

  return { state, events }
}
