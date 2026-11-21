// Курс обмінного пункту «Говерла» (Луцьк): goverla.lutsk.ua.
// Якщо сайт недоступний або змінив розмітку, показуємо офіційний курс НБУ.
import { getRatesState, setRatesState } from "./store.js"

const GOVERLA_URL = "https://goverla.lutsk.ua/"
const NBU = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange"
const WANT = ["USD", "EUR", "PLN"]
const TTL = 30 * 60_000

const n2 = (x) => x.toFixed(2).replace(".", ",")
let cache = { at: 0, value: null }

// ---------- Говерла ----------

export function parseGoverla(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")

  const head = text.match(/Курс валют на (\d{1,2} [А-Яа-яІіЇїЄєҐґ']+ \d{4})/)
  if (!head) return null

  const section = text.slice(head.index, head.index + 3000)
  const rates = {}

  for (const cc of WANT) {
    const m = section.match(
      new RegExp(`\\b${cc}\\b[^\\d]{0,150}?(\\d+[.,]\\d+)[\\s|]+(\\d+[.,]\\d+)`)
    )
    if (!m) continue
    const buy = parseFloat(m[1].replace(",", "."))
    const sell = parseFloat(m[2].replace(",", "."))
    if (buy > 0 && sell >= buy) rates[cc] = { buy, sell }
  }

  // перевірка здорового глузду: без долара або з дивними числами не довіряємо
  const usd = rates.USD
  if (!usd || usd.sell < 10 || usd.sell > 200) return null

  return { date: head[1], rates }
}

async function fetchGoverla() {
  const res = await fetch(GOVERLA_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FamilyBot/1.0)" },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`goverla: ${res.status}`)

  const parsed = parseGoverla(await res.text())
  if (!parsed) throw new Error("goverla: не вдалося розібрати сторінку")
  return parsed
}

// зберігає попереднє значення, щоб показувати зміну
export function updateState(state, fresh) {
  if (!state.cur) return { cur: fresh, prev: null }
  if (JSON.stringify(state.cur) === JSON.stringify(fresh)) return state
  return { cur: fresh, prev: state.cur }
}

function arrow(now, before) {
  if (before === undefined) return ""
  const d = now - before
  return Math.abs(d) < 0.005 ? "" : d > 0 ? ` ▲${n2(d)}` : ` ▼${n2(-d)}`
}

export function formatGoverla(cur, prev) {
  const rows = WANT.filter((cc) => cur.rates[cc]).map((cc) => {
    const a = cur.rates[cc]
    const b = prev?.rates?.[cc]
    return (
      `${cc}   купівля ${n2(a.buy)}${arrow(a.buy, b?.buy)}\n` +
      `        продаж ${n2(a.sell)}${arrow(a.sell, b?.sell)}`
    )
  })

  const usd = cur.rates.USD
  const eur = cur.rates.EUR

  return {
    text:
      `💱 Обмінний пункт «Говерла», Луцьк\nКурс на ${cur.date}\n\n` +
      rows.join("\n\n") +
      "\n\nℹ️ Це готівковий курс пункту обміну. Стрілки показують зміну " +
      "відносно попереднього значення, яке бачив бот.",
    line:
      "💱 Говерла: " +
      [usd && `USD ${n2(usd.buy)}/${n2(usd.sell)}`, eur && `EUR ${n2(eur.buy)}/${n2(eur.sell)}`]
        .filter(Boolean)
        .join(" · "),
  }
}

// ---------- НБУ (запасний варіант) ----------

async function fetchNbu(dateStr) {
  const res = await fetch(`${NBU}?json${dateStr ? `&date=${dateStr}` : ""}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`NBU: ${res.status}`)
  return res.json()
}

export function formatNbu(today) {
  const date = today[0]?.exchangedate || ""
  const rows = WANT.map((cc) => today.find((x) => x.cc === cc))
    .filter(Boolean)
    .map((x) => `${x.cc}  ${n2(x.rate)}`)

  return {
    text: `🏛 Офіційний курс НБУ на ${date}\n\n${rows.join("\n")}`,
    line: "🏛 НБУ: " + rows.filter((r) => !r.startsWith("PLN")).map((r) => r.replace("  ", " ")).join(" · "),
  }
}

// ---------- загальний інтерфейс ----------

async function load() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value

  let value
  try {
    const fresh = await fetchGoverla()
    const state = updateState(getRatesState(), fresh)
    if (state !== getRatesState()) setRatesState(state)
    value = formatGoverla(state.cur, state.prev)
  } catch (error) {
    console.error("[rates] goverla:", error?.message || error)
    const nbu = formatNbu(await fetchNbu())
    value = {
      text: nbu.text + "\n\n⚠️ Сайт «Говерла» зараз недоступний, показано офіційний курс.",
      line: nbu.line,
    }
  }

  cache = { at: Date.now(), value }
  return value
}

export async function getRatesText() {
  return (await load()).text
}

export async function getRatesLine() {
  try {
    return (await load()).line
  } catch (error) {
    console.error("[rates] error:", error?.message || error)
    return ""
  }
}
