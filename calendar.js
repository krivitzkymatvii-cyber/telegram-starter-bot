// Чиста логіка: календар .ics і місячна статистика (без мережі та sharp)
import { DAY, dayLabel, fmtHours } from "./schedule.js"

const tzFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
})

// зсув Києва відносно UTC у мілісекундах на момент utcMs
function kyivOffset(utcMs) {
  const p = Object.fromEntries(
    tzFmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value])
  )
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

// київська «стінна» година (dayNum, хвилини від півночі) -> UTC мс
export function kyivToUtc(dayNum, minutes) {
  const wall = (dayNum * DAY + minutes) * 60000
  let utc = wall - kyivOffset(wall)
  utc = wall - kyivOffset(utc) // уточнення на межі переходу часу
  return utc
}

const icsDate = (ms) =>
  new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")

const esc = (s) => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n")

// items: [{ village, dayNum, intervals: [[startMin, endMin], ...] }]
export function buildIcs(items, { lead = 30, nowMs = Date.now() } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//svitlo-bot//outages//UK",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Відключення світла",
  ]
  let count = 0

  for (const { village, dayNum, intervals } of items) {
    for (const [s, e] of intervals) {
      const start = kyivToUtc(dayNum, s)
      const end = kyivToUtc(dayNum, e)
      if (end <= nowMs) continue // минулі не потрібні
      count++

      lines.push(
        "BEGIN:VEVENT",
        `UID:${village.queue}-${dayNum}-${s}@svitlo-bot`,
        `DTSTAMP:${icsDate(nowMs)}`,
        `DTSTART:${icsDate(start)}`,
        `DTEND:${icsDate(end)}`,
        `SUMMARY:${esc(`🔌 Відключення світла (${village.short})`)}`,
        `DESCRIPTION:${esc(`Черга ${village.queue}. За графіком Волиньобленерго.`)}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `TRIGGER:-PT${lead}M`,
        `DESCRIPTION:${esc(`Через ${lead} хв відключення світла`)}`,
        "END:VALARM",
        "END:VEVENT"
      )
    }
  }

  lines.push("END:VCALENDAR")
  // рядки .ics мають закінчуватись CRLF
  return { text: lines.join("\r\n") + "\r\n", count }
}

// stats: { [dayNum]: години }. Повертає підсумок за останні days діб.
export function monthSummary(stats, dayNum, days = 30) {
  const rows = []
  for (let i = 0; i < days; i++) {
    const d = dayNum - i
    if (stats[d] !== undefined) rows.push({ d, h: stats[d] })
  }
  if (!rows.length) return null

  const total = rows.reduce((a, r) => a + r.h, 0)
  const worst = rows.reduce((a, r) => (r.h > a.h ? r : a))
  const best = rows.reduce((a, r) => (r.h < a.h ? r : a))
  const free = rows.filter((r) => r.h === 0).length

  return {
    n: rows.length, total, avg: total / rows.length, worst, best, free,
  }
}

export function monthText(village, sum, days = 30) {
  if (!sum) {
    return `📈 Відключення за ${days} днів\n📍 «${village.name}», черга ${village.queue}\n\nДаних поки немає.`
  }
  return (
    `📈 Відключення за ${days} днів\n📍 «${village.name}», черга ${village.queue}\n\n` +
    `Днів з даними: ${sum.n}\n` +
    `Разом без світла: ${fmtHours(+sum.total.toFixed(1))} год\n` +
    `У середньому: ${fmtHours(+sum.avg.toFixed(1))} год на добу\n` +
    `Найважчий день: ${dayLabel(sum.worst.d)}, ${fmtHours(sum.worst.h)} год\n` +
    `Найлегший: ${dayLabel(sum.best.d)}, ${fmtHours(sum.best.h)} год\n` +
    `Днів без відключень: ${sum.free}\n\n` +
    "ℹ️ Рахується за графіками з моменту, коли бот почав їх збирати."
  )
}
