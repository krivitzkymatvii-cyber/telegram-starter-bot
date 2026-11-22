import { DAY, dayLabel, fmtTime } from "./schedule.js"

export const remindHelp =
  "⏰ Приклади:\n" +
  "/remind через 30 хв вимкнути плиту\n" +
  "/remind через 2 год 15 хв забрати пральну\n" +
  "/remind сьогодні 18:30 купити хліб\n" +
  "/remind завтра о 8:00 забрати посилку\n" +
  "/remind 25.11 09:00 до лікаря\n" +
  "/remind щодня 21:00 випити ліки\n" +
  "/remind viber завтра о 8:00 текст (ще й у Viber, лише для дозволених)\n\n" +
  "Усі нагадування: /reminders"

const toDayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000)

// now = { dayNum, minutes } за київським часом
export function parseRemind(input, now) {
  const s = input.trim().replace(/\s+/g, " ")
  const nowAbs = now.dayNum * DAY + now.minutes

  // щодня
  let m = s.match(/^щодня\s+(?:о\s*)?(\d{1,2}):(\d{2})\s+(.+)$/i)
  if (m) {
    const h = +m[1], mi = +m[2]
    if (h > 23 || mi > 59) return { ok: false, error: "Некоректний час." }
    return {
      ok: true, kind: "daily", time: h * 60 + mi, text: m[3].slice(0, 300),
      whenLabel: `щодня о ${fmtTime(h * 60 + mi)}`,
    }
  }

  // через N год M хв
  m = s.match(/^через\s+((?:\d+\s*(?:годин\w*|год\w*|хвилин\w*|хв\w*)\s*)+)(.+)$/i)
  if (m) {
    let mins = 0
    for (const p of m[1].matchAll(/(\d+)\s*(годин\w*|год\w*|хвилин\w*|хв\w*)/gi)) {
      mins += +p[1] * (/^год/i.test(p[2]) ? 60 : 1)
    }
    if (mins < 1 || mins > 7 * DAY) return { ok: false, error: "Вкажіть від 1 хвилини до 7 діб." }
    const due = nowAbs + mins
    const dn = Math.floor(due / DAY)
    return {
      ok: true, kind: "once", due, text: m[2].slice(0, 300),
      whenLabel: `${dayLabel(dn)} ${fmtTime(due % DAY)}`,
    }
  }

  // [день] час текст
  m = s.match(
    /^(сьогодні|завтра|післязавтра|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)?\s*(о\s*)?(\d{1,2})(?::(\d{2}))?\s+(.+)$/i
  )
  if (!m) return { ok: false, error: "Не зрозумів, коли нагадати." }

  const [, dayWord, hasO, hh, mm, text] = m
  if (mm === undefined && !hasO) {
    return { ok: false, error: "Вкажіть час у форматі 18:30 або «о 8»." }
  }

  const h = +hh, mi = mm === undefined ? 0 : +mm
  if (h > 23 || mi > 59) return { ok: false, error: "Некоректний час." }

  let dn = now.dayNum
  const w = (dayWord || "").toLowerCase()

  if (w === "завтра") dn += 1
  else if (w === "післязавтра") dn += 2
  else if (/^\d/.test(w)) {
    const [d, mo, y] = w.split(".").map(Number)
    const curYear = new Date(now.dayNum * 86400000).getUTCFullYear()
    const year = y === undefined ? curYear : y < 100 ? 2000 + y : y
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return { ok: false, error: "Некоректна дата." }
    dn = toDayNum(year, mo, d)
    if (y === undefined && dn < now.dayNum) dn = toDayNum(year + 1, mo, d)
  } else if (!w && h * 60 + mi <= now.minutes) {
    dn += 1 // «18:30» вже минуло сьогодні, значить завтра
  }

  const due = dn * DAY + h * 60 + mi
  if (due <= nowAbs) return { ok: false, error: "Цей час уже минув." }
  if (due - nowAbs > 366 * DAY) return { ok: false, error: "Занадто далеко: максимум рік." }

  return {
    ok: true, kind: "once", due, text: text.slice(0, 300),
    whenLabel: `${dayLabel(dn)} ${fmtTime(h * 60 + mi)}`,
  }
}

export function fmtReminder(r) {
  const when =
    r.kind === "daily"
      ? `щодня о ${fmtTime(r.time)}`
      : `${dayLabel(Math.floor(r.due / DAY))} ${fmtTime(r.due % DAY)}`
  return `#${r.id}  ${when}${r.viber ? "  📣 + Viber" : ""}\n${r.text}`
}

// Які нагадування спрацьовують зараз. Повертає [{ r, late }].
export function dueReminders(list, now) {
  const nowAbs = now.dayNum * DAY + now.minutes
  const out = []

  for (const r of list) {
    if (r.kind === "once" && r.due <= nowAbs) {
      out.push({ r, late: nowAbs - r.due > 10 })
    } else if (
      r.kind === "daily" &&
      r.last !== now.dayNum &&
      now.minutes >= r.time &&
      now.minutes - r.time < 180
    ) {
      out.push({ r, late: now.minutes - r.time > 10 })
    }
  }

  return out
}
