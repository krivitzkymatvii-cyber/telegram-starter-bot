// Облік лічильників: електрика (кВт·год) і газ (м³): показники, споживання, прогноз і вартість.
//   /meter 12345        внести показник світла за сьогодні      /gas 1234.567  показник газу
//   /meter 12000 01.10  показник за дату (історія)               /gas          підсумок і прогноз
//   /meter              підсумок і прогноз                       /gastariff 7.96  тариф, грн за м³
//   /tariff 4.32        тариф, грн за кВт·год (або ELECTRICITY_TARIFF; для газу GAS_TARIFF)
import { InlineKeyboard } from "grammy"
import { ensureChat, getChat, save } from "./store.js"
import { kyivNow, dayLabel } from "./schedule.js"
import { markMetersDone } from "./monthly.js"

export const KINDS = {
  electricity: {
    field: "meter", cmd: "meter", tariffCmd: "tariff", icon: "⚡", title: "Електрика", unit: "кВт·год",
    tariffUnit: "грн за кВт·год", env: "ELECTRICITY_TARIFF", example: "12345", tariffExample: "4.32", digits: 1, reset: "meter:reset",
  },
  gas: {
    field: "gas", cmd: "gas", tariffCmd: "gastariff", icon: "🔥", title: "Газ", unit: "м³",
    tariffUnit: "грн за м³", env: "GAS_TARIFF", example: "1234.567", tariffExample: "7.96", digits: 3, reset: "meter:reset:gas",
  },
}

const MS = 86_400_000
const MONTHS = ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"]

const ymd = (dn) => {
  const d = new Date(dn * MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }
}
const dayOf = (y, m, d) => Math.floor(Date.UTC(y, m, d) / MS)
const monthStart = (dn) => { const { y, m } = ymd(dn); return dayOf(y, m, 1) }
const nextMonthStart = (dn) => { const { y, m } = ymd(dn); return dayOf(y, m + 1, 1) }
const shortDate = (dn) => dayLabel(dn).replace(/ \(.+\)$/, "")

export function fmtNum(x, digits = 0) {
  const s = Number(x).toFixed(digits)
  const [int, frac] = s.split(".")
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (frac ? "," + frac : "")
}

// ---------- чиста логіка ----------

// Додає показник; повертає { ok, list } або { ok:false, error }
export function addReading(list, d, v, digits = 1) {
  const sorted = [...list].sort((a, b) => a.d - b.d)
  const prev = [...sorted].reverse().find((r) => r.d < d)
  const next = sorted.find((r) => r.d > d)

  if (prev && v < prev.v) {
    return { ok: false, error: `Це менше за попередній показник ${fmtNum(prev.v, digits)} від ${shortDate(prev.d)}. Перевірте цифри.` }
  }
  if (next && v > next.v) {
    return { ok: false, error: `Це більше за наступний показник ${fmtNum(next.v, digits)} від ${shortDate(next.d)}. Перевірте дату.` }
  }

  const out = sorted.filter((r) => r.d !== d)
  out.push({ d, v })
  out.sort((a, b) => a.d - b.d)
  return { ok: true, list: out.slice(-400) }
}

// Значення лічильника на день (лінійна інтерполяція між показниками), поза діапазоном null
export function valueAt(list, day) {
  if (!list.length || day < list[0].d || day > list[list.length - 1].d) return null
  for (let i = 0; i < list.length; i++) {
    if (list[i].d === day) return list[i].v
    if (list[i].d > day) {
      const a = list[i - 1], b = list[i]
      return a.v + ((b.v - a.v) * (day - a.d)) / (b.d - a.d)
    }
  }
  return null
}

// Споживання за місяць, у якому є дані; partial = місяць неповний (початок чи кінець за межами даних)
export function monthUsage(list, anyDayInMonth) {
  if (list.length < 2) return null
  const first = list[0].d, last = list[list.length - 1].d
  const ms = monthStart(anyDayInMonth), ne = nextMonthStart(anyDayInMonth)
  const from = Math.max(ms, first), to = Math.min(ne, last)
  if (to <= from) return null
  const kwh = valueAt(list, to) - valueAt(list, from)
  return { kwh, partial: from > ms || to < ne, days: to - from }
}

export function summarize(list, today, tariff) {
  if (!list.length) return null
  const last = list[list.length - 1]
  const prev = list.length > 1 ? list[list.length - 2] : null
  const out = { last, prev, tariff }

  if (prev) {
    out.delta = last.v - prev.v
    out.days = last.d - prev.d
    out.perDay = out.days > 0 ? out.delta / out.days : null
  }

  // останні 6 місяців
  const months = []
  const cur = ymd(last.d)
  for (let i = 5; i >= 0; i--) {
    const day = dayOf(cur.y, cur.m - i, 1)
    const u = monthUsage(list, day)
    if (u) months.push({ ...u, label: MONTHS[ymd(day).m], isCurrent: i === 0 })
  }
  out.months = months

  // прогноз до кінця місяця останнього показника: темп за останні до 14 днів
  const ne = nextMonthStart(last.d)
  const lookFrom = Math.max(list[0].d, last.d - 14)
  if (last.d > lookFrom && ne > last.d) {
    const rate = (last.v - valueAt(list, lookFrom)) / (last.d - lookFrom)
    const sofar = monthUsage(list, last.d)
    if (sofar && !sofar.partialStart) {
      out.forecast = { kwh: sofar.kwh + rate * (ne - last.d), rate, monthLabel: MONTHS[ymd(last.d).m], reliable: !sofar.partial || monthStart(last.d) >= list[0].d }
    }
  }

  const prevMonth = months.length >= 2 ? months[months.length - 2] : null
  if (prevMonth && !prevMonth.partial && out.forecast) {
    out.vsPrev = (out.forecast.kwh / prevMonth.kwh - 1) * 100
  }

  return out
}

const money = (kwh, tariff) => (tariff ? ` · ${fmtNum(kwh * tariff)} грн` : "")

export function formatSummary(s, kind = KINDS.electricity) {
  if (!s) return `Показників ще немає. Внесіть перший: /${kind.cmd} ${kind.example}`

  const u = kind.unit
  const lines = [`${kind.icon} ${kind.title}\n\nОстанній показник: ${fmtNum(s.last.v, kind.digits)} ${u} (${shortDate(s.last.d)})`]

  if (s.prev) {
    lines.push(
      `З ${shortDate(s.prev.d)}: +${fmtNum(s.delta, 1)} ${u} за ${s.days} дн.` +
        (s.perDay != null ? ` (≈ ${fmtNum(s.perDay, 1)} на добу)` : "") +
        money(s.delta, s.tariff)
    )
  } else {
    lines.push("Внесіть ще один показник (наприклад, через кілька днів), і я порахую споживання.")
  }

  if (s.months?.length) {
    const max = Math.max(...s.months.map((m) => m.kwh), 1)
    lines.push(
      "📊 По місяцях\n" +
        s.months
          .map((m) => {
            const bar = "█".repeat(Math.max(1, Math.round((m.kwh / max) * 10)))
            return `${m.label}${m.partial ? "*" : ""}  ${bar}  ${fmtNum(m.kwh)}${money(m.kwh, s.tariff)}`
          })
          .join("\n") +
        (s.months.some((m) => m.partial) ? "\n* неповний місяць (за наявними показниками)" : "")
    )
  }

  if (s.forecast) {
    lines.push(
      `🔮 Прогноз на ${s.forecast.monthLabel}: ≈ ${fmtNum(s.forecast.kwh)} ${u}${money(s.forecast.kwh, s.tariff)}` +
        (s.vsPrev != null ? `\nПорівняно з минулим місяцем: ${s.vsPrev >= 0 ? "+" : ""}${fmtNum(s.vsPrev)}%` : "")
    )
  }

  if (!s.tariff) lines.push(`💡 Вкажіть тариф, щоб бачити суму: /${kind.tariffCmd} ${kind.tariffExample}`)
  return lines.join("\n\n")
}

// ---------- розбір команди ----------

export function parseMeterArgs(text, now) {
  const m = String(text || "").trim().match(/^(\d+(?:[.,]\d{1,3})?)(?:\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?)?$/)
  if (!m) return null
  const v = parseFloat(m[1].replace(",", "."))
  if (!(v >= 0) || v > 99_999_999) return null

  let d = now.dayNum
  if (m[2]) {
    const cur = ymd(now.dayNum)
    const year = m[4] ? (+m[4] < 100 ? 2000 + +m[4] : +m[4]) : cur.y
    if (+m[3] < 1 || +m[3] > 12 || +m[2] < 1 || +m[2] > 31) return null
    d = dayOf(year, +m[3] - 1, +m[2])
    if (!m[4] && d > now.dayNum) d = dayOf(year - 1, +m[3] - 1, +m[2]) // без року: дата в минулому
  }
  if (d > now.dayNum) return null
  return { v, d }
}

const tariffOf = (chat, kind) => chat[kind.field]?.tariff ?? (Number(process.env[kind.env]) || null)

const helpText = (k) =>
  `${k.icon} Облік: ${k.title.toLowerCase()}\n\n` +
  `/${k.cmd} ${k.example} — внести показник за сьогодні\n` +
  `/${k.cmd} ${k.example} 01.10 — показник за дату (щоб заповнити історію)\n` +
  `/${k.cmd} — споживання, прогноз і сума\n` +
  `/${k.tariffCmd} ${k.tariffExample} — тариф, ${k.tariffUnit}`

function registerKind(bot, kind) {
  bot.command(kind.cmd, async (ctx) => {
    const chat = ensureChat(ctx.chat.id)
    const arg = (ctx.match || "").trim()
    const list = chat[kind.field]?.readings || []
    const today = kyivNow().dayNum

    if (/^(скинути|reset)$/i.test(arg)) {
      return ctx.reply(`Видалити всі показники (${kind.title.toLowerCase()})?`, {
        reply_markup: new InlineKeyboard().text("🗑 Так, видалити", kind.reset).text("Скасувати", "meter:cancel"),
      })
    }

    if (!arg) {
      return ctx.reply(formatSummary(summarize(list, today, tariffOf(chat, kind)), kind) + (list.length ? "" : "\n\n" + helpText(kind)))
    }

    const parsed = parseMeterArgs(arg, kyivNow())
    if (!parsed) return ctx.reply("⚠️ Не зрозумів.\n\n" + helpText(kind))

    const res = addReading(list, parsed.d, parsed.v, kind.digits)
    if (!res.ok) return ctx.reply("⚠️ " + res.error)

    chat[kind.field] = { ...(chat[kind.field] || {}), readings: res.list }
    markMetersDone(chat, today) // якщо ввімкнено місячне нагадування, позначаємо «подано»
    save()

    await ctx.reply(
      `✅ Записано: ${fmtNum(parsed.v, kind.digits)} ${kind.unit} (${shortDate(parsed.d)})\n\n` +
        formatSummary(summarize(res.list, today, tariffOf(chat, kind)), kind)
    )
  })

  bot.command(kind.tariffCmd, async (ctx) => {
    const chat = ensureChat(ctx.chat.id)
    const arg = (ctx.match || "").trim().replace(",", ".")

    if (!arg) {
      const t = tariffOf(chat, kind)
      return ctx.reply(
        t
          ? `Тариф (${kind.title.toLowerCase()}): ${fmtNum(t, 2)} ${kind.tariffUnit}. Змінити: /${kind.tariffCmd} ${kind.tariffExample}`
          : `Тариф не вказано. Вкажіть: /${kind.tariffCmd} ${kind.tariffExample}`
      )
    }

    const t = parseFloat(arg)
    if (!(t > 0 && t < 1000)) return ctx.reply(`⚠️ Вкажіть число, наприклад: /${kind.tariffCmd} ${kind.tariffExample}`)

    chat[kind.field] = { ...(chat[kind.field] || { readings: [] }), tariff: t }
    save()
    await ctx.reply(`✅ Тариф (${kind.title.toLowerCase()}): ${fmtNum(t, 2)} ${kind.tariffUnit}`)
  })

  bot.callbackQuery(kind.reset, async (ctx) => {
    const chat = getChat(ctx.chat.id)
    if (chat?.[kind.field]) chat[kind.field].readings = []
    save()
    await ctx.answerCallbackQuery({ text: "Видалено" })
    await ctx.editMessageText(`🗑 Показники (${kind.title.toLowerCase()}) видалено.`).catch(() => {})
  })
}

export function registerMeter(bot) {
  for (const kind of Object.values(KINDS)) registerKind(bot, kind)

  bot.callbackQuery("meter:cancel", async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageText("Гаразд, нічого не змінено.").catch(() => {})
  })
}
