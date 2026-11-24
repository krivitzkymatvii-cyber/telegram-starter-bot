// Щомісячне нагадування: подати показники лічильників і оплатити інтернет.
// День: 30-те число; у коротких місяцях (лютий) за день до кінця місяця.
// Час: MONTHLY_TIME (за замовчуванням 09:00), повтор MONTHLY_TIME2 (19:00), якщо щось не позначено.
import { InlineKeyboard } from "grammy"
import { allChats, ensureChat, save } from "./store.js"
import { kyivNow, DAY } from "./schedule.js"
import { safeSend } from "./send.js"
import { isViberKey, viberEnabled, postViberText } from "../viber.js"

const MS_DAY = 86_400_000

const TASKS = [
  { id: "meters", done: "Показники лічильників подано", todo: "Подати показники лічильників", btn: "✅ Подав показники" },
  { id: "internet", done: "Інтернет оплачено", todo: "Оплатити інтернет", btn: "✅ Оплатив інтернет" },
]

const parseTime = (v, fallback) => {
  const m = String(v || "").trim().match(/^(\d{1,2}):(\d{2})$/)
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : fallback
}

// День місяця, коли треба нагадати
export function targetDay(year, month /* 0-11 */) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return last >= 30 ? 30 : last - 1
}

const ymd = (dayNum) => {
  const d = new Date(dayNum * MS_DAY)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }
}

export function isTargetDay(dayNum) {
  const { y, m, d } = ymd(dayNum)
  return d === targetDay(y, m)
}

// найближчий день нагадування, не раніше dayNum
export function nextTarget(dayNum) {
  for (let i = 0; i < 62; i++) if (isTargetDay(dayNum + i)) return dayNum + i
  return null
}

const fmtDate = (dayNum) => {
  const { y, m, d } = ymd(dayNum)
  return `${String(d).padStart(2, "0")}.${String(m + 1).padStart(2, "0")}.${y}`
}

const monthKey = (dayNum) => {
  const { y, m } = ymd(dayNum)
  return `${y}-${String(m + 1).padStart(2, "0")}`
}

// стан «що вже зроблено» цього місяця
function stateFor(chat, dayNum) {
  const ym = monthKey(dayNum)
  if (!chat.monthly) chat.monthly = { on: false }
  if (chat.monthly.done?.ym !== ym) {
    chat.monthly.done = { ym, meters: false, internet: false }
  }
  return chat.monthly.done
}

export function reminderText(done, header = "📆 Кінець місяця: час подати показники й оплатити інтернет") {
  const lines = TASKS.map((t) => (done[t.id] ? `✅ ${t.done}` : `⬜ ${t.todo}`))
  const left = TASKS.filter((t) => !done[t.id]).length
  return `${header}\n\n${lines.join("\n")}` + (left ? "" : "\n\n🎉 Усе зроблено на цей місяць!")
}

export function reminderKeyboard(done) {
  const kb = new InlineKeyboard()
  for (const t of TASKS) if (!done[t.id]) kb.text(t.btn, `mo:${t.id}`).row()
  return kb
}

async function sendReminder(api, chatId, chat, dayNum, header) {
  const done = stateFor(chat, dayNum)
  const left = TASKS.some((t) => !done[t.id])
  return safeSend(api, chatId, reminderText(done, header), {
    extra: left ? { reply_markup: reminderKeyboard(done) } : {},
  })
}

// Перевірка раз на хвилину: now можна підставити для тесту
export async function monthlyTick(api, now = kyivNow()) {
  const { dayNum, minutes } = now
  if (!isTargetDay(dayNum)) return

  const t1 = parseTime(process.env.MONTHLY_TIME, 540) // 09:00
  const t2 = parseTime(process.env.MONTHLY_TIME2, 1140) // 19:00

  // Viber (основний канал): одне повідомлення о MONTHLY_TIME, без кнопок. Вимкнути: MONTHLY_VIBER=off
  if (viberEnabled() && (process.env.MONTHLY_VIBER || "").trim().toLowerCase() !== "off") {
    const vChat = ensureChat("viber")
    const key = `${dayNum * DAY}:mo-v`

    if (minutes >= t1 && minutes < t1 + 120 && !vChat.sent[key]) {
      vChat.sent[key] = 1
      save()
      await postViberText(
        process.env.MONTHLY_VIBER_TEXT ||
          "📆 Кінець місяця!\n\nНе забудьте:\n• подати показники лічильників\n• оплатити інтернет"
      ).catch((e) => console.error("[monthly] viber error:", e?.message || e))
    }
  }

  for (const [chatId, chat] of allChats()) {
    if (isViberKey(chatId) || !chat.monthly?.on) continue

    const done = stateFor(chat, dayNum)
    if (TASKS.every((t) => done[t.id])) continue

    for (const [n, start] of [[1, t1], [2, t2]]) {
      if (minutes < start || minutes >= start + 120) continue

      const key = `${dayNum * DAY}:mo${n}`
      if (chat.sent[key]) continue
      chat.sent[key] = 1
      save()

      await sendReminder(
        api, chatId, chat, dayNum,
        n === 1
          ? "📆 Кінець місяця: час подати показники й оплатити інтернет"
          : "🔔 Нагадую ще раз: ще не все зроблено"
      )
    }
  }
}

export function registerMonthly(bot) {
  // /monthly — увімкнути/вимкнути; /monthly test — надіслати зараз
  bot.command("monthly", async (ctx) => {
    const { getChat } = await import("./store.js")
    const chat = getChat(ctx.chat.id)
    if (!chat) return ctx.reply("Спершу натисніть /start")

    const arg = (ctx.match || "").trim().toLowerCase()
    const { dayNum } = kyivNow()

    if (arg === "test") {
      return sendReminder(ctx.api, ctx.chat.id, chat, dayNum, "📆 Тест: так виглядатиме нагадування")
    }

    chat.monthly = { ...(chat.monthly || {}), on: !chat.monthly?.on }
    save()

    if (!chat.monthly.on) return ctx.reply("🔕 Щомісячні нагадування вимкнено.")

    return ctx.reply(
      "📆 Щомісячні нагадування увімкнено.\n\n" +
        "Що: подати показники лічильників і оплатити інтернет.\n" +
        "Коли: 30-го числа (у лютому за день до кінця місяця) о 09:00, " +
        "повтор о 19:00, якщо ви не натиснули «Зроблено».\n" +
        `Найближче: ${fmtDate(nextTarget(dayNum))}.\n\n` +
        "Перевірити вигляд: /monthly test. Вимкнути: /monthly ще раз."
    )
  })

  bot.callbackQuery(/^mo:(meters|internet)$/, async (ctx) => {
    const { getChat } = await import("./store.js")
    const chat = getChat(ctx.chat.id)
    if (!chat) return ctx.answerCallbackQuery()

    const done = stateFor(chat, kyivNow().dayNum)
    done[ctx.match[1]] = true
    save()

    await ctx.answerCallbackQuery({ text: "Записано ✅" })
    const left = TASKS.some((t) => !done[t.id])

    await ctx
      .editMessageText(reminderText(done), left ? { reply_markup: reminderKeyboard(done) } : {})
      .catch(() => {}) // «message is not modified» тощо
  })
}
