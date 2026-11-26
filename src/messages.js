import {
  kyivNow, dayLabel, fmtTime, fmtRange, fmtDur, fmtHours,
  intervalsText, lightText, currentStatus, DAY,
} from "./schedule.js"
import { jokeBefore, jokeBack, jokeChange, jokesEnabled } from "./jokes.js"

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

const jokes = {
  none: [
    "Світло сьогодні без вихідних. Можна смажити, прати і пилососити одночасно 😎",
    "Енергетики сьогодні в доброму гуморі. Користуйтеся, поки дають!",
  ],
  light: [
    "Відключення невеликі, тож це не криза, а коротка медитація без розетки 🧘",
    "Трохи посидимо при свічках, романтика ж. Головне, щоб Wi-Fi не образився 🕯️",
  ],
  medium: [
    "Світло сьогодні як гість: приходить і йде, коли захоче. Тож заряджайте все, що заряджається 🔋",
    "Пральну машину запускаємо, поки є світло. Потім вона теж піде в тінь 🧺",
  ],
  heavy: [
    "Сьогодні світла небагато, зате буде що розповісти онукам 📖",
    "Дістаємо павербанки, ліхтарики й настільні ігри. Вечір обіцяє бути живим 🎲",
  ],
}

const tips = [
  "Зарядіть телефон і павербанк 🔋",
  "Закип'ятіть воду й заваріть чай у термос ☕",
  "Запустіть пральну чи посудомийну машину, поки є світло 🧺",
  "Приготуйте ліхтарик і свічки під рукою 🔦",
  "Увімкніть режим економії на телефоні 📱",
]

export function jokeFor(hours) {
  if (!jokesEnabled()) return ""
  if (hours === 0) return pick(jokes.none)
  if (hours <= 4) return pick(jokes.light)
  if (hours <= 7) return pick(jokes.medium)
  return pick(jokes.heavy)
}

function statusLine(slots, nowMin) {
  const st = currentStatus(slots, nowMin)

  if (st.off) {
    return st.changeAt === null
      ? "🔴 Зараз світла немає, за графіком до кінця доби"
      : `🔴 Зараз світла немає. Має з'явитися о ${fmtTime(st.changeAt)} (через ${fmtDur(st.changeAt - nowMin)})`
  }

  return st.nextOutage
    ? `🟢 Зараз світло є. Відключення о ${fmtTime(st.nextOutage[0])} (через ${fmtDur(st.nextOutage[0] - nowMin)})`
    : "🟢 Зараз світло є, до кінця доби відключень немає"
}

export function buildDayMessage({ village, day, sched, weather, morning = false }) {
  const { dayNum, minutes } = kyivNow()
  const off = day === "today" ? 0 : 1
  const when = off === 0 ? "сьогодні" : "завтра"

  const parts = [
    morning
      ? "🌅 Доброго ранку, любі гості, дорога родино!"
      : "👋 Любі гості, дорога родино!",
    `Графік на ${when}, ${dayLabel(dayNum + off)}, для «${village.name}», черга ${village.queue}, такий:`,
    [
      intervalsText(sched.intervals),
      lightText(sched.intervals),
      `Разом без світла: ${fmtHours(sched.totalHours)} год`,
    ].filter(Boolean).join("\n"),
  ]

  if (off === 0) parts.push(statusLine(sched.slots, minutes))
  const dayJoke = jokeFor(sched.totalHours)
  if (dayJoke) parts.push(dayJoke)
  if (weather) parts.push(weather)
  parts.push("ℹ️ Фактичний час перемикання може відрізнятися.")

  return parts.join("\n\n")
}

export function buildNowMessage({ village, today, tomorrow }) {
  const { minutes } = kyivNow()
  const slots = tomorrow ? [...today.slots, ...tomorrow.slots] : today.slots
  const st = currentStatus(slots, minutes)

  const lines = [
    `📍 «${village.name}», черга ${village.queue}`,
    statusLine(slots, minutes),
  ]

  const upcoming = st.intervals.filter(([, b]) => b > minutes)
  if (upcoming.length) {
    lines.push(
      "Далі за графіком:\n" +
        upcoming.map(([a, b]) => `🔴 ${fmtRange(a, b)}`).join("\n")
    )
  } else {
    lines.push("Більше відключень за графіком немає.")
  }

  lines.push(`🕒 Станом на ${fmtTime(minutes)}`)
  return lines.join("\n\n")
}

export function buildBefore({ village, ev, nowMin }) {
  const joke = jokeBefore(ev)
  return (
    `⏰ «${village.name}» (черга ${village.queue})\n` +
    `Через ${fmtDur(ev.s - nowMin)} (о ${fmtTime(ev.s)}) відключення світла: ` +
    `${fmtRange(ev.s, ev.e)}, це ${fmtDur(ev.e - ev.s)}.\n\n` +
    (joke ? `😄 ${joke}\n\n` : "") +
    `💡 ${pick(tips)}`
  )
}

export function buildBack({ village, ev, next }) {
  const joke = jokeBack(ev)
  return (
    `🟢 «${village.name}»: за графіком світло вже має з'явитися (з ${fmtTime(ev.e)}).\n` +
    "Якщо ще немає, трохи зачекайте: перемикання може затримуватися.\n\n" +
    (joke ? `😄 ${joke}\n\n` : "") +
    (next
      ? `Наступне відключення: 🔴 ${fmtRange(next[0], next[1])}`
      : "Подальших відключень за графіком немає ✅")
  )
}

export function parseSig(sig) {
  if (!sig || sig === "none") return []
  return sig.split(",").map((x) => x.split("-").map(Number))
}

export function buildChanged({ village, off, oldSig, newSig }) {
  const { dayNum } = kyivNow()
  const when = off === 0 ? "сьогодні" : "завтра"
  const block = (sig) => intervalsText(parseSig(sig))
  const joke = jokeChange(parseSig(oldSig), parseSig(newSig))

  return (
    `⚠️ Графік на ${when}, ${dayLabel(dayNum + off)}, змінився!\n` +
    `📍 «${village.name}», черга ${village.queue}\n\n` +
    `Було:\n${block(oldSig)}\n\nСтало:\n${block(newSig)}` +
    (joke ? `\n\n😄 ${joke}` : "")
  )
}

export function buildPublished({ village, sched }) {
  const { dayNum } = kyivNow()
  return (
    `📣 Опубліковано графік на завтра, ${dayLabel(dayNum + 1)}\n` +
    `📍 «${village.name}», черга ${village.queue}\n\n` +
    [
      intervalsText(sched.intervals),
      lightText(sched.intervals),
      `Разом без світла: ${fmtHours(sched.totalHours)} год`,
    ].filter(Boolean).join("\n") +
    (jokeFor(sched.totalHours) ? `\n\n${jokeFor(sched.totalHours)}` : "")
  )
}

export function buildStatsMessage({ village, stats }) {
  const { dayNum } = kyivNow()
  const rows = []
  let sum = 0
  let n = 0

  for (let i = 6; i >= 0; i--) {
    const d = dayNum - i
    const h = stats[d]
    const label = dayLabel(d)

    if (h === undefined) {
      rows.push(`${label}  —`)
    } else {
      rows.push(`${label}  ${"█".repeat(Math.round(h / 1.5)) || "·"}  ${fmtHours(h)} год`)
      sum += h
      n++
    }
  }

  const summary = n
    ? `Разом: ${fmtHours(sum)} год за ${n} дн., у середньому ${fmtHours((sum / n).toFixed(1))} год на добу`
    : "Даних поки немає"

  return (
    `📊 Відключення за 7 днів\n📍 «${village.name}», черга ${village.queue}\n\n` +
    rows.join("\n") +
    `\n\n${summary}\n\nℹ️ Рахується за опублікованими графіками з моменту, коли бот почав їх збирати.`
  )
}

export function settingsText(chat, names) {
  return (
    "⚙️ НАЛАШТУВАННЯ\n\n" +
    `Підписки: ${names.length ? names.join(", ") : "немає (оберіть місце в /start)"}\n\n` +
    "Натискайте кнопки, щоб змінити."
  )
}

export { DAY }
