// Чиста логіка часу й інтервалів (без мережі та sharp)

export const DAY = 1440
const pad = (n) => String(n).padStart(2, "0")

const kyivFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

// dayNum — номер доби (днів від 1970-01-01) за київським часом
export function kyivNow(date = new Date()) {
  const p = Object.fromEntries(
    kyivFmt.formatToParts(date).map((x) => [x.type, x.value])
  )
  const dayNum = Math.floor(
    Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000
  )
  return { dayNum, minutes: +p.hour * 60 + +p.minute }
}

const WD = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"]

export function dayLabel(dayNum) {
  const d = new Date(dayNum * 86400000)
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} (${WD[d.getUTCDay()]})`
}

export function fmtTime(m) {
  if (m === DAY) return "24:00"
  const x = ((m % DAY) + DAY) % DAY
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`
}

export function fmtRange(s, e) {
  if (s >= DAY) return `${fmtTime(s)} – ${fmtTime(e)} (завтра)`
  if (e > DAY) return `${fmtTime(s)} – ${fmtTime(e)} (до завтра)`
  return `${fmtTime(s)} – ${fmtTime(e)}`
}

export const fmtHours = (h) => String(h).replace(".", ",")

export function fmtDur(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h && m) return `${h} год ${m} хв`
  if (h) return `${h} год`
  return `${m} хв`
}

// slots: масив по 30 хв, true = світла немає
export function slotsToIntervals(slots) {
  const result = []
  let start = null

  slots.forEach((off, i) => {
    if (off && start === null) start = i * 30
    if (!off && start !== null) {
      result.push([start, i * 30])
      start = null
    }
  })

  if (start !== null) result.push([start, slots.length * 30])
  return result
}

export function complement(intervals, total = DAY) {
  const result = []
  let cur = 0
  for (const [a, b] of intervals) {
    if (a > cur) result.push([cur, a])
    cur = b
  }
  if (cur < total) result.push([cur, total])
  return result
}

export function intervalsText(intervals) {
  if (!intervals.length) return "✅ Відключень не заплановано"
  return intervals.map(([a, b]) => `🔴 ${fmtRange(a, b)}`).join("\n")
}

export function lightText(intervals) {
  const lights = complement(intervals)
  if (!intervals.length || !lights.length) return ""
  return "🟢 Світло є: " + lights.map(([a, b]) => fmtRange(a, b)).join(", ")
}

export function currentStatus(slots, nowMin) {
  const idx = Math.min(Math.floor(nowMin / 30), slots.length - 1)
  const off = !!slots[idx]
  let changeAt = null

  for (let i = idx + 1; i < slots.length; i++) {
    if (!!slots[i] !== off) {
      changeAt = i * 30
      break
    }
  }

  const intervals = slotsToIntervals(slots)
  const nextOutage = intervals.find(([a]) => a > nowMin) || null
  const current =
    intervals.find(([a, b]) => a <= nowMin && nowMin < b) || null

  return { off, changeAt, nextOutage, current, intervals }
}

// Події, які саме зараз треба сповістити.
// before: за lead хв до початку. back: після закінчення (вікно 20 хв).
export function dueEvents(intervals, nowMin, lead, knownLen) {
  const events = []
  for (const [s, e] of intervals) {
    if (nowMin >= s - lead && nowMin < s) events.push({ type: "before", s, e })
    if (nowMin >= e && nowMin < e + 20 && e < knownLen) {
      events.push({ type: "back", s, e })
    }
  }
  return events
}

// Після півночі ВОЕ деякий час віддає у «сьогодні» вчорашню картинку.
// Така картинка має той самий хеш, що й «сьогодні» минулої доби.
// Тоді беремо те, що вчора було «завтра». state: { lastToday, carried }
export function createStaleState() {
  return { lastToday: { dayNum: 0, hash: null }, carried: new Map() }
}

export function fixStaleDays(days, dayNum, state) {
  const out = { ...days }

  if (out.today) {
    const stale =
      state.lastToday.hash === out.today.hash && state.lastToday.dayNum < dayNum
    if (stale) {
      out.today = state.carried.get(dayNum) || null
    } else {
      state.lastToday = { dayNum, hash: out.today.hash }
    }
  }

  if (out.tomorrow) {
    // «завтра» збігається з тим, що вже є справжнім «сьогодні» => ще не оновили
    if (state.carried.get(dayNum)?.hash === out.tomorrow.hash) {
      out.tomorrow = null
    } else {
      state.carried.set(dayNum + 1, out.tomorrow)
    }
  }

  for (const k of state.carried.keys()) if (k < dayNum) state.carried.delete(k)
  return out
}
