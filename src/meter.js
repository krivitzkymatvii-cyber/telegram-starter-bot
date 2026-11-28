// Облік електрики: показники лічильника, споживання, прогноз і вартість.
//   /meter 12345        внести показник за сьогодні
//   /meter 12000 01.10  внести показник за дату (щоб заповнити історію)
//   /meter              підсумок і прогноз
//   /tariff 4.32        тариф, грн за кВт·год (або змінна ELECTRICITY_TARIFF)
import { InlineKeyboard } from "grammy"
import { ensureChat, getChat, save } from "./store.js"
import { kyivNow, dayLabel } from "./schedule.js"
import { markMetersDone } from "./monthly.js"

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
export function addReading(list, d, v) {
  const sorted = [...list].sort((a, b) => a.d - b.d)
  const prev = [...sorted].reverse().find((r) => r.d < d)
  const next = sorted.find((r) => r.d > d)

  if (prev && v < prev.v) {
    return { ok: false, error: `Це менше за попередній показник ${fmtNum(prev.v, 1)} від ${shortDate(prev.d)}. Перевірте цифри.` }
  }
  if (next && v > next.v) {
    return { ok: false, error: `Це більше за наступний показник ${fmtNum(next.v, 1)} від ${shortDate(next.d)}. Перевірте дату.` }
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

export function formatSummary(s) {
  if (!s) return "Показників ще немає. Внесіть перший: /meter 12345"

  const lines = [`⚡ Електрика\n\nОстанній показник: ${fmtNum(s.last.v, 1)} кВт·год (${shortDate(s.last.d)})`]

  if (s.prev) {
    lines.push(
      `З ${shortDate(s.prev.d)}: +${fmtNum(s.delta, 1)} кВт·год за ${s.days} дн.` +
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
      `🔮 Прогноз на ${s.forecast.monthLabel}: ≈ ${fmtNum(s.forecast.kwh)} кВт·год${money(s.forecast.kwh, s.tariff)}` +
        (s.vsPrev != null ? `\nПорівняно з минулим місяцем: ${s.vsPrev >= 0 ? "+" : ""}${fmtNum(s.vsPrev)}%` : "")
    )
  }

  if (!s.tariff) lines.push("💡 Вкажіть тариф, щоб бачити суму: /tariff 4.32")
  return lines.join("\n\n")
}

// ---------- розбір команди ----------

export function parseMeterArgs(text, now) {
  const m = String(text || "").trim().match(/^(\d+(?:[.,]\d{1,2})?)(?:\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?)?$/)
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

const tariffOf = (chat) => chat.meter?.tariff ?? (Number(process.env.ELECTRICITY_TARIFF) || null)

const helpText =
  "⚡ Облік електрики\n\n" +
  "/meter 12345 — внести показник за сьогодні\n" +
  "/meter 12000 01.10 — показник за дату (щоб заповнити історію)\n" +
  "/meter — споживання, прогноз і сума\n" +
  "/tariff 4.32 — тариф, грн за кВт·год"

export function registerMeter(bot) {
  bot.command("meter", async (ctx) => {
    const chat = ensureChat(ctx.chat.id)
    const arg = (ctx.match || "").trim()
    const list = chat.meter?.readings || []

    if (/^(скинути|reset)$/i.test(arg)) {
      return ctx.reply("Видалити всі показники?", {
        reply_markup: new InlineKeyboard().text("🗑 Так, видалити", "meter:reset").text("Скасувати", "meter:cancel"),
      })
    }

    if (!arg) {
      return ctx.reply(formatSummary(summarize(list, kyivNow().dayNum, tariffOf(chat))) + (list.length ? "" : "\n\n" + helpText))
    }

    const parsed = parseMeterArgs(arg, kyivNow())
    if (!parsed) return ctx.reply("⚠️ Не зрозумів.\n\n" + helpText)

    const res = addReading(list, parsed.d, parsed.v)
    if (!res.ok) return ctx.reply("⚠️ " + res.error)

    chat.meter = { ...(chat.meter || {}), readings: res.list }
    markMetersDone(chat, kyivNow().dayNum) // якщо ввімкнено місячне нагадування, позначаємо «подано»
    save()

    await ctx.reply(
      `✅ Записано: ${fmtNum(parsed.v, 1)} кВт·год (${shortDate(parsed.d)})\n\n` +
        formatSummary(summarize(res.list, kyivNow().dayNum, tariffOf(chat)))
    )
  })

  bot.command("tariff", async (ctx) => {
    const chat = ensureChat(ctx.chat.id)
    const arg = (ctx.match || "").trim().replace(",", ".")

    if (!arg) {
      const t = tariffOf(chat)
      return ctx.reply(t ? `Тариф: ${fmtNum(t, 2)} грн за кВт·год. Змінити: /tariff 4.32` : "Тариф не вказано. Вкажіть: /tariff 4.32")
    }

    const t = parseFloat(arg)
    if (!(t > 0 && t < 100)) return ctx.reply("⚠️ Вкажіть число, наприклад: /tariff 4.32")

    chat.meter = { ...(chat.meter || { readings: [] }), tariff: t }
    save()
    await ctx.reply(`✅ Тариф: ${fmtNum(t, 2)} грн за кВт·год`)
  })

  bot.callbackQuery("meter:reset", async (ctx) => {
    const chat = getChat(ctx.chat.id)
    if (chat?.meter) chat.meter.readings = []
    save()
    await ctx.answerCallbackQuery({ text: "Видалено" })
    await ctx.editMessageText("🗑 Показники видалено.").catch(() => {})
  })

  bot.callbackQuery("meter:cancel", async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageText("Гаразд, нічого не змінено.").catch(() => {})
  })
}
