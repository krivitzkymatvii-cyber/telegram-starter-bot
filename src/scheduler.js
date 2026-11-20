import { allChats, save, recordStats, ensureChat, subscribe, unsubscribe } from "./store.js"
import { villages } from "./villages.js"
import { kyivNow, DAY, slotsToIntervals, dueEvents } from "./schedule.js"
import {
  buildDayMessage, buildBefore, buildBack, buildChanged, buildPublished,
} from "./messages.js"
import { getWeatherText } from "./weather.js"
import { safeSend } from "./send.js"
import { viberEnabled, postViberText, postViberPicture } from "../viber.js"

const TTL = 5 * 60_000

// Службовий «чат» для Viber: свої незалежні налаштування, не залежить від Telegram-чатів.
const VIBER_KEY = "viber"

// Які населені пункти дублювати у Viber (через кому). За замовчуванням лише Дмитрівка.
const viberVillages = (process.env.VIBER_VILLAGES || "dmytrivka")
  .split(",").map((v) => v.trim()).filter(Boolean)

const sigOf = (s) =>
  s.intervals.map(([a, b]) => `${a}-${b}`).join(",") || "none"

// Чиста логіка: повертає повідомлення, які треба надіслати зараз, і оновлює стан чату.
export async function processVillage({
  chat, villageId, village, today, tomorrow, now, getWeather,
}) {
  const msgs = []
  const sub = chat.subs[villageId]
  const { dayNum, minutes } = now
  const silent = chat.quiet && (minutes < 420 || minutes >= 1380)

  // чистимо старе
  for (const k of Object.keys(chat.sent)) {
    if (parseInt(k, 10) < (dayNum - 2) * DAY) delete chat.sent[k]
  }
  for (const k of Object.keys(sub.seen)) {
    if (+k < dayNum - 1) delete sub.seen[k]
  }

  const targets = [[0, today], [1, tomorrow]]

  // перший прохід після підписки: запам'ятовуємо графік без сповіщень
  if (!sub.primed) {
    for (const [off, s] of targets) if (s) sub.seen[dayNum + off] = sigOf(s)
    sub.primed = true
    return msgs
  }

  // нові та змінені графіки
  for (const [off, s] of targets) {
    if (!s) continue
    const key = dayNum + off
    const sig = sigOf(s)
    const prev = sub.seen[key]
    sub.seen[key] = sig

    if (!chat.alerts) continue

    if (prev === undefined) {
      if (off === 1) {
        msgs.push({ text: buildPublished({ village, sched: s }), photoUrl: s.url })
      }
    } else if (prev !== sig) {
      msgs.push({
        text: buildChanged({ village, off, oldSig: prev, newSig: sig }),
        photoUrl: s.url,
      })
    }
  }

  // попередження перед відключенням і «світло має бути»
  if (chat.notify && today) {
    const slots = tomorrow ? [...today.slots, ...tomorrow.slots] : today.slots
    const intervals = slotsToIntervals(slots)
    const events = dueEvents(intervals, minutes, chat.lead, slots.length * 30)

    for (const ev of events) {
      const at = ev.type === "before" ? ev.s : ev.e
      const key = `${dayNum * DAY + at}:${ev.type}:${villageId}`
      if (chat.sent[key]) continue
      chat.sent[key] = 1

      if (ev.type === "before") {
        msgs.push({ text: buildBefore({ village, ev, nowMin: minutes }), silent })
      } else {
        const next = intervals.find(([a]) => a >= ev.e) || null
        msgs.push({ text: buildBack({ village, ev, next }), silent })
      }
    }
  }

  // ранковий дайджест
  if (
    chat.morning && today &&
    minutes >= chat.morningTime && minutes < chat.morningTime + 90
  ) {
    const key = `${dayNum * DAY}:m:${villageId}`
    if (!chat.sent[key]) {
      chat.sent[key] = 1
      const weather = await getWeather(village)
      msgs.push({
        text: buildDayMessage({ village, day: "today", sched: today, weather, morning: true }),
        photoUrl: today.url,
      })
    }
  }

  return msgs
}

// Підписки службового Viber-чату = VIBER_VILLAGES
export function syncViberSubs(vChat, ids) {
  for (const id of ids) {
    if (!vChat.villages.includes(id)) subscribe(vChat, id)
  }
  for (const id of [...vChat.villages]) {
    if (!ids.includes(id)) unsubscribe(vChat, id)
  }
}

// Обробляє одне село для одного отримувача; deliver(m) відправляє повідомлення
export async function runVillage({ chat, villageId, now, sched, deliver }) {
  const village = villages[villageId]
  if (!village || !chat.subs?.[villageId]) return

  const today = await sched("today", village.queue)
  const tomorrow = await sched("tomorrow", village.queue)
  if (today) recordStats(village.queue, now.dayNum, today.totalHours)

  const msgs = await processVillage({
    chat, villageId, village, today, tomorrow, now,
    getWeather: (v) => getWeatherText(v.lat, v.lon),
  })

  for (const m of msgs) await deliver(m)
}

export function startScheduler(api) {
  let running = false

  async function tick() {
    if (running) return
    running = true

    try {
      const hasViber = viberEnabled() && viberVillages.length > 0
      const telegramChats = allChats().filter(([id]) => id !== VIBER_KEY)
      if (!telegramChats.length && !hasViber) return

      const { getSchedule } = await import("./outages.js")
      const now = kyivNow()
      const cache = new Map()

      const sched = async (day, queue) => {
        const k = `${day}:${queue}`
        if (!cache.has(k)) {
          cache.set(
            k,
            await getSchedule(day, queue, TTL).catch((e) => {
              console.error("[sched] error:", e?.message || e)
              return null
            })
          )
        }
        return cache.get(k)
      }

      // Telegram
      for (const [chatId, chat] of telegramChats) {
        for (const villageId of chat.villages || []) {
          await runVillage({
            chat, villageId, now, sched,
            deliver: (m) =>
              safeSend(api, chatId, m.text, { photoUrl: m.photoUrl, silent: m.silent }),
          })
        }
      }

      // Viber: окремий «чат», одне повідомлення на подію незалежно від кількості Telegram-чатів
      if (hasViber) {
        const vChat = ensureChat(VIBER_KEY)
        syncViberSubs(vChat, viberVillages.filter((id) => villages[id]))

        for (const villageId of vChat.villages) {
          await runVillage({
            chat: vChat, villageId, now, sched,
            deliver: async (m) => {
              try {
                await postViberText(m.text)
                if (m.photoUrl) await postViberPicture(m.photoUrl)
              } catch (e) {
                console.error("[viber] send error:", e?.message || e)
              }
            },
          })
        }
      }

      save()
    } catch (error) {
      console.error("[scheduler] error:", error)
    } finally {
      running = false
    }
  }

  setTimeout(tick, 10_000)
  setInterval(tick, 60_000)
  console.log("[scheduler] started")
}
