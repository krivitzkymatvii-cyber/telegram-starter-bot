// Короткі повідомлення для Viber: без картинок, жартів, порад і погоди.
import { kyivNow, dayLabel, fmtTime, fmtRange, fmtDur, fmtHours } from "./schedule.js"
import { parseSig } from "./messages.js"

const lines = (intervals) =>
  intervals.map(([a, b]) => `🔴 ${fmtRange(a, b)}`).join("\n")

const total = (intervals) =>
  fmtHours(+(intervals.reduce((s, [a, b]) => s + (b - a), 0) / 60).toFixed(1))

const dayWord = (off) => (off === 0 ? "сьогодні" : "завтра")
const dateOf = (off) => dayLabel(kyivNow().dayNum + off)

// Графік на день (ранок або «опубліковано»)
export function vDay({ village, off, intervals, published = false }) {
  const head = `${village.short}, ${dayWord(off)} ${dateOf(off)}`

  if (!intervals.length) {
    return `🎉 ${village.short}: ${dayWord(off)} ВІДКЛЮЧЕНЬ НЕ БУДЕ! УРАААА! 🎉\n${dateOf(off)}, черга ${village.queue}`
  }

  return (
    `${published ? "📣 Опубліковано графік" : "⚡ Графік"}\n${head}, черга ${village.queue}\n\n` +
    `${lines(intervals)}\n\nРазом без світла: ${total(intervals)} год`
  )
}

// Графік змінився
export function vChanged({ village, off, oldSig, newSig }) {
  const now = parseSig(newSig)
  const head = `⚠️ Графік змінився\n${village.short}, ${dayWord(off)} ${dateOf(off)}`

  if (!now.length) {
    return `🎉 ${village.short}: ${dayWord(off)} тепер ВІДКЛЮЧЕНЬ НЕ БУДЕ! УРАААА! 🎉\n(графік змінився, ${dateOf(off)})`
  }

  const was = parseSig(oldSig)
  return (
    `${head}\n\nСтало:\n${lines(now)}\n\nРазом: ${total(now)} год` +
    (was.length ? `\n\nБуло:\n${lines(was)}` : "\n\nБуло: без відключень")
  )
}

// Попередження перед відключенням
export function vBefore({ village, ev, nowMin }) {
  return (
    `⏰ ${village.short}: через ${fmtDur(ev.s - nowMin)} відключення\n` +
    `🔴 ${fmtRange(ev.s, ev.e)} (${fmtDur(ev.e - ev.s)})`
  )
}

// Світло має з'явитися
export function vBack({ village, ev, next }) {
  return (
    `🟢 ${village.short}: світло має бути (з ${fmtTime(ev.e)})\n` +
    (next ? `Далі: 🔴 ${fmtRange(next[0], next[1])}` : "Більше відключень за графіком немає ✅")
  )
}
