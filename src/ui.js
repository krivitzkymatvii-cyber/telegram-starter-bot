// Зручний інтерфейс кнопками: головне меню, що оновлюється на місці, живий статус світла,
// розділи «Дім і побут» та «Розваги», кнопки швидкого доступу внизу екрана (у приватному чаті).
import { InlineKeyboard, Keyboard } from "grammy"
import { villages, villageIds } from "./villages.js"
import { getSchedule } from "./outages.js"
import { getWeatherText } from "./weather.js"
import { ensureChat, subscribe, unsubscribe, save, getAlarm } from "./store.js"
import { kyivNow, fmtTime, fmtDur, currentStatus } from "./schedule.js"

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))])

// Запам'ятовує обробники команд, щоб кнопки могли запускати їх без дублювання коду.
export function captureCommands(bot) {
  const registry = new Map()
  const orig = bot.command.bind(bot)

  bot.command = (name, ...handlers) => {
    for (const n of [].concat(name)) registry.set(n, handlers[handlers.length - 1])
    return orig(name, ...handlers)
  }

  return registry
}

export function currentVillage(chat) {
  if (villages[chat.ui?.v]) return chat.ui.v
  return chat.villages?.find((id) => villages[id]) || villageIds[0]
}

// Рядок «світло є / немає» за слотами сьогодні й завтра (чиста функція, її легко перевірити)
export function statusFromSlots(todaySlots, tomorrowSlots, minutes) {
  const slots = tomorrowSlots ? [...todaySlots, ...tomorrowSlots] : todaySlots
  const st = currentStatus(slots, minutes)

  if (st.off) {
    return st.changeAt === null
      ? "🔴 Світла немає, за графіком до кінця доби"
      : `🔴 Світла немає. З'явиться о ${fmtTime(st.changeAt)} (через ${fmtDur(st.changeAt - minutes)})`
  }

  return st.nextOutage
    ? `🟢 Світло є. Відключення о ${fmtTime(st.nextOutage[0])} (через ${fmtDur(st.nextOutage[0] - minutes)})`
    : "🟢 Світло є, відключень за графіком більше немає"
}

async function liveStatus(village) {
  const today = await getSchedule("today", village.queue)
  if (!today) return "ℹ️ Графік на сьогодні ще не опублікований"
  const tomorrow = await getSchedule("tomorrow", village.queue).catch(() => null)
  return statusFromSlots(today.slots, tomorrow?.slots, kyivNow().minutes)
}

export async function homeView(chat) {
  const vid = currentVillage(chat)
  const v = villages[vid]
  const subscribed = (chat.villages || []).includes(vid)

  let status = ""
  try {
    status = await withTimeout(liveStatus(v), 4000)
  } catch {
    // без мережі меню все одно відкривається
  }

  const alarm = getAlarm()
  const text = [
    alarm.active ? `🚨 Триває тривога: ${alarm.scope}` : "",
    `⚡ ${v.name}`,
    `Черга ${v.queue}`,
    status,
    subscribed ? "🔔 Сповіщення увімкнені" : "🔕 Сповіщення вимкнені",
    "Оберіть дію 👇",
  ]
    .filter(Boolean)
    .join("\n\n")
    .replace(`⚡ ${v.name}\n\nЧерга`, `⚡ ${v.name}\nЧерга`)

  const kb = new InlineKeyboard()
  for (const id of villageIds) kb.text(`${id === vid ? "✅ " : ""}${villages[id].short}`, `ui:v:${id}`)
  kb.row()
    .text("📅 Сьогодні", `d:${vid}:today`)
    .text("📅 Завтра", `d:${vid}:tomorrow`)
    .row()
    .text("⚡ Що зараз", `n:${vid}`)
    .text("📊 Статистика", `s:${vid}`)
    .row()
    .text("🚨 Тривога", "ui:run:alarm")
    .text("🌦 Погода", "ui:weather")
    .row()
    .text("🧰 Дім і побут", "ui:sec:home")
    .text("🎈 Розваги", "ui:sec:fun")
    .row()
    .text(subscribed ? "🔕 Вимкнути сповіщення" : "🔔 Підписатися", "ui:sub")
    .text("⚙️ Налаштування", "st:open")

  return { text, kb }
}

const SECTIONS = {
  home: {
    title: "🧰 Дім і побут",
    rows: [
      [["⚡ Електрика", "meter"], ["💵 Курс", "rates"]],
      [["⏰ Нагадування", "reminders"], ["📆 Щомісячне", "monthly"]],
      [["🗓 Календар", "calendar"], ["📰 Новини", "news"]],
    ],
  },
  fun: {
    title: "🎈 Розваги",
    rows: [
      [["🧠 Факт", "fact"], ["😄 Жарт", "joke"]],
      [["🧩 Загадка", "riddle"], ["📖 Прислів'я", "proverb"]],
      [["❓ Вікторина", "quiz"], ["🌙 Казка", "kazka"]],
      [["📜 День в історії", "history"]],
    ],
  },
}

export function sectionView(name) {
  const s = SECTIONS[name]
  const kb = new InlineKeyboard()
  for (const row of s.rows) {
    for (const [label, cmd] of row) kb.text(label, `ui:run:${cmd}`)
    kb.row()
  }
  kb.text("⬅️ Меню", "ui:home")
  return { text: `${s.title}\n\nОберіть, що показати:`, kb }
}

const ALLOWED = new Set(Object.values(SECTIONS).flatMap((s) => s.rows.flat().map(([, c]) => c)).concat("alarm"))

export function quickKeyboard() {
  const kb = new Keyboard().text("📅 Сьогодні").text("📅 Завтра").row().text("⚡ Зараз").text("🧰 Меню").resized()
  if (typeof kb.persistent === "function") kb.persistent()
  return kb
}

async function render(ctx, view, edit) {
  const opts = { reply_markup: view.kb }

  if (edit) {
    try {
      await ctx.editMessageText(view.text, opts)
      return
    } catch (e) {
      if (/not modified/i.test(e?.description || e?.message || "")) return
      // повідомлення не текстове чи застаре: надсилаємо нове
    }
  }

  await ctx.reply(view.text, opts)
}

export async function showHome(ctx, edit = false) {
  const chat = ensureChat(ctx.chat.id)
  await render(ctx, await homeView(chat), edit)
}

export async function startHub(ctx) {
  ensureChat(ctx.chat.id) // щоб доходили тривоги й поради
  save()

  if (ctx.chat.type === "private") {
    await ctx.reply("👋 Вітаю! Кнопки швидкого доступу з'явилися внизу екрана.", {
      reply_markup: quickKeyboard(),
    })
  }

  await showHome(ctx, false)
}

export function registerUI(bot, { registry, showDay, showNow }) {
  bot.command("menu", (ctx) => showHome(ctx, false))

  bot.callbackQuery("ui:home", async (ctx) => {
    await ctx.answerCallbackQuery()
    await showHome(ctx, true)
  })

  bot.callbackQuery(/^ui:v:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const id = ctx.match[1]
    if (!villages[id]) return
    const chat = ensureChat(ctx.chat.id)
    chat.ui = { ...(chat.ui || {}), v: id }
    save()
    await showHome(ctx, true)
  })

  bot.callbackQuery("ui:sub", async (ctx) => {
    const chat = ensureChat(ctx.chat.id)
    const id = currentVillage(chat)
    const was = chat.villages.includes(id)

    if (was) unsubscribe(chat, id)
    else subscribe(chat, id)
    save()

    await ctx.answerCallbackQuery({ text: was ? "Сповіщення вимкнено 🔕" : "Підписано 🔔" })
    await showHome(ctx, true)
  })

  bot.callbackQuery(/^ui:sec:(home|fun)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    await render(ctx, sectionView(ctx.match[1]), true)
  })

  bot.callbackQuery("ui:weather", async (ctx) => {
    await ctx.answerCallbackQuery()
    const chat = ensureChat(ctx.chat.id)
    const v = villages[currentVillage(chat)]
    const text = await getWeatherText(v.lat, v.lon)
    await ctx.reply(text ? `📍 ${v.name}\n\n${text}` : "⚠️ Погода тимчасово недоступна.")
  })

  // запуск існуючої команди кнопкою (без аргументів)
  bot.callbackQuery(/^ui:run:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const cmd = ctx.match[1]
    const handler = registry.get(cmd)

    if (!ALLOWED.has(cmd) || !handler) {
      return ctx.reply("⚠️ Ця функція зараз недоступна.")
    }

    const c = Object.create(ctx)
    Object.defineProperty(c, "match", { value: "" })
    await handler(c)
  })

  // кнопки швидкого доступу внизу екрана
  const mine = async (ctx, fn) => fn(ctx, currentVillage(ensureChat(ctx.chat.id)))
  bot.hears("📅 Сьогодні", (ctx) => mine(ctx, (c, id) => showDay(c, id, "today")))
  bot.hears("📅 Завтра", (ctx) => mine(ctx, (c, id) => showDay(c, id, "tomorrow")))
  bot.hears("⚡ Зараз", (ctx) => mine(ctx, (c, id) => showNow(c, id)))
  bot.hears("🧰 Меню", (ctx) => showHome(ctx, false))
}
