// Додаткові функції зі своїми таймерами, незалежно від перевірки графіків:
// нагадування, повітряні тривоги, погодні поради, щоденна «родзинка».
import {
  allChats, allReminders, dropReminders, save, getAlarm, setAlarm,
} from "./store.js"
import { kyivNow, dayLabel, DAY } from "./schedule.js"
import { villages } from "./villages.js"
import { safeSend } from "./send.js"
import { dueReminders } from "./remind.js"
import { fetchAlerts, evaluateAlarm } from "./alarm.js"
import { getDailyForecast, tipsFromDaily } from "./weatherTips.js"
import { funForDay, sendFun } from "./fun.js"
import { viberEnabled, postViberText } from "../viber.js"
import { holidaysFor, historyFor, personalFor, isWeekday } from "./dates.js"
import { ensureChat } from "./store.js"

const TASK_TIMEOUT = 90_000

function guarded(name, fn) {
  let running = false
  let startedAt = 0

  return async () => {
    if (running && Date.now() - startedAt < TASK_TIMEOUT) return
    running = true
    startedAt = Date.now()

    try {
      await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TASK_TIMEOUT)),
      ])
    } catch (error) {
      console.error(`[${name}] error:`, error?.message || error)
    } finally {
      running = false
    }
  }
}

// ---- нагадування ----
async function remindersTick(api) {
  const now = kyivNow()
  const due = dueReminders(allReminders(), now)
  if (!due.length) return

  const doneOnce = []

  for (const { r, late } of due) {
    const text =
      `⏰ Нагадування${r.by ? ` (від ${r.by})` : ""}\n\n${r.text}` +
      (late ? "\n\n(Запізнилось: бот був недоступний)" : "")

    if (r.tg !== false) await safeSend(api, r.chatId, text)

    if (r.viber && viberEnabled()) {
      await postViberText(`⏰ Нагадування\n\n${r.text}`).catch((e) =>
        console.error("[viber] reminder error:", e?.message || e)
      )
    }

    if (r.kind === "once") doneOnce.push(r.id)
    else r.last = now.dayNum
  }

  if (doneOnce.length) dropReminders(doneOnce)
  else save()
}

// ---- повітряні тривоги ----
async function alarmTick(api) {
  const token = process.env.ALERTS_TOKEN
  if (!token) return

  const prev = getAlarm()
  const alerts = await fetchAlerts(token)
  const { state, events } = evaluateAlarm(prev, alerts)

  if (JSON.stringify(state) !== JSON.stringify(prev)) setAlarm(state)

  for (const ev of events) {
    console.log("[alarm]", ev.type)

    for (const [chatId, chat] of allChats()) {
      if (chat.alarm === false || chatId === "viber") continue
      await safeSend(api, chatId, ev.text) // тривога завжди зі звуком
    }

    if (viberEnabled() && process.env.VIBER_ALARMS === "on") {
      await postViberText(ev.text).catch((e) =>
        console.error("[viber] alarm error:", e?.message || e)
      )
    }
  }
}

// ---- погодні поради й щоденна «родзинка» ----
async function dailyTick(api) {
  const { dayNum, minutes } = kyivNow()
  const month = new Date(dayNum * 86400000).getUTCMonth() + 1

  const inWindow = (start) => minutes >= start && minutes < start + 60
  const wantToday = minutes >= 450 && minutes < 540 // 07:30–09:00
  const wantTomorrow = inWindow(1200) // 20:00–21:00

  for (const [chatId, chat] of allChats()) {
    if (chatId === "viber") continue

    for (const k of Object.keys(chat.sent)) {
      if (parseInt(k, 10) < (dayNum - 2) * DAY) delete chat.sent[k]
    }

    // погодні поради
    if (chat.wtips !== false && (wantToday || wantTomorrow)) {
      const kind = wantToday ? 0 : 1
      const groups = new Map()

      for (const id of chat.villages || []) {
        const v = villages[id]
        if (!v) continue
        const k = `${v.lat},${v.lon}`
        if (!groups.has(k)) groups.set(k, { v, names: [] })
        groups.get(k).names.push(v.short)
      }

      for (const [k, { v, names }] of groups) {
        const key = `${dayNum * DAY}:wt${kind}:${k}`
        if (chat.sent[key]) continue

        try {
          const daily = await getDailyForecast(v.lat, v.lon)
          const tips = tipsFromDaily(daily, kind, month)
          chat.sent[key] = 1
          if (!tips.length) continue

          await safeSend(
            api, chatId,
            `🌦️ Погодні поради на ${kind === 0 ? "сьогодні" : "завтра"}, ${dayLabel(dayNum + kind)}\n` +
              `📍 ${names.join(", ")}\n\n${tips.join("\n\n")}`
          )
        } catch (error) {
          console.error("[wtips] error:", error?.message || error)
        }
      }
    }

    // привітання зі святами, особисті дати й «цього дня в історії» (08:00–09:00)
    if (inWindow(480)) {
      if (chat.greet !== false) {
        const key = `${dayNum * DAY}:greet`
        if (!chat.sent[key]) {
          chat.sent[key] = 1
          for (const text of [...holidaysFor(dayNum), ...personalFor(dayNum)]) {
            await safeSend(api, chatId, text)
          }
        }
      }

      if (chat.history !== false) {
        const key = `${dayNum * DAY}:hist`
        if (!chat.sent[key]) {
          chat.sent[key] = 1
          const text = historyFor(dayNum)
          if (text) await safeSend(api, chatId, text)
        }
      }
    }

    // щоденна родзинка
    if (chat.fun && inWindow(chat.funTime)) {
      const key = `${dayNum * DAY}:fun`
      if (!chat.sent[key]) {
        chat.sent[key] = 1
        await sendFun(api, chatId, funForDay(dayNum))
      }
    }
  }

  save()
}

// ---- нагадування про сміття (лише Viber, Дмитрівка) ----
// TRASH_DAY: 0=нд ... 3=середа (за замовчуванням), TRASH_TIME: "07:00"
async function trashTick() {
  if (!viberEnabled()) return

  const wd = Number(process.env.TRASH_DAY ?? 3)
  const [h, m] = (process.env.TRASH_TIME || "07:00").split(":").map(Number)
  const start = h * 60 + (m || 0)
  const { dayNum, minutes } = kyivNow()

  if (!isWeekday(dayNum, wd) || minutes < start || minutes >= start + 180) return

  const vChat = ensureChat("viber") // тут зберігаємо, що вже надіслано
  const key = `${dayNum * DAY}:trash`
  if (vChat.sent[key]) return
  vChat.sent[key] = 1
  save()

  await postViberText(
    process.env.TRASH_TEXT ||
      "🗑️ Дмитрівка: сьогодні вивозять сміття!\nНе забудьте виставити баки чи пакети зранку."
  ).catch((e) => console.error("[trash] viber error:", e?.message || e))
}

export function startExtras(api) {
  const rem = guarded("reminders", () => remindersTick(api))
  const alm = guarded("alarm", () => alarmTick(api))
  const day = guarded("daily", () => dailyTick(api))
  const trash = guarded("trash", () => trashTick())

  setTimeout(rem, 5_000)
  setInterval(rem, 30_000)
  setInterval(alm, 60_000)
  setTimeout(alm, 8_000)
  setInterval(day, 60_000)
  setTimeout(day, 12_000)
  setInterval(trash, 60_000)
  setTimeout(trash, 15_000)

  console.log(
    "[extras] started" +
      (process.env.ALERTS_TOKEN ? "" : " (тривоги вимкнені: немає ALERTS_TOKEN)")
  )
}
