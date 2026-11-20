import { InlineKeyboard } from "grammy"
import { villages, villageIds } from "./villages.js"
import { getSchedule } from "./outages.js"
import { getWeatherText } from "./weather.js"
import {
  buildDayMessage, buildNowMessage, buildStatsMessage, settingsText,
} from "./messages.js"
import {
  ensureChat, getChat, subscribe, unsubscribe, save, recordStats, getStats,
} from "./store.js"
import { kyivNow, fmtTime } from "./schedule.js"
import { safeSend } from "./send.js"
import { startScheduler } from "./scheduler.js"

const officialUrl =
  "https://energy.volyn.ua/spozhyvacham/perervy-u-elektropostachanni/hrafik-vidkliuchen/pagephp.php"

const LEADS = [15, 30, 60]
const MORNINGS = [360, 420, 480, 540]

const subscribedIds = (chatId) => getChat(chatId)?.villages || []
const onOff = (v) => (v ? "так" : "ні")

function mainMenu(chatId) {
  const subs = subscribedIds(chatId)
  const kb = new InlineKeyboard()

  for (const id of villageIds) {
    kb.text(`${subs.includes(id) ? "🔔" : "🏡"} ${villages[id].short}`, `v:${id}`).row()
  }

  return kb.text("⚙️ Налаштування", "st:open")
}

function villageMenu(id, subscribed) {
  return new InlineKeyboard()
    .text("📅 Сьогодні", `d:${id}:today`)
    .text("📅 Завтра", `d:${id}:tomorrow`)
    .row()
    .text("⚡ Що зараз?", `n:${id}`)
    .text("📊 Статистика", `s:${id}`)
    .row()
    .text(
      subscribed ? "🔕 Відписатися від сповіщень" : "🔔 Підписатися на сповіщення",
      `sub:${id}`
    )
    .row()
    .text("⬅️ Назад", "back")
}

function settingsMenu(chat) {
  return new InlineKeyboard()
    .text(`${chat.notify ? "🔔" : "🔕"} Попередження про відключення: ${onOff(chat.notify)}`, "st:notify").row()
    .text(`⏱ Попереджати за: ${chat.lead} хв`, "st:lead").row()
    .text(`${chat.morning ? "🌅" : "🚫"} Ранковий дайджест: ${onOff(chat.morning)}`, "st:morning").row()
    .text(`🕖 Час дайджесту: ${fmtTime(chat.morningTime)}`, "st:mtime").row()
    .text(`📣 Новий/змінений графік: ${onOff(chat.alerts)}`, "st:alerts").row()
    .text(`🌙 Тиха ніч (без звуку 23:00–07:00): ${onOff(chat.quiet)}`, "st:quiet").row()
    .text("⬅️ Назад", "back")
}

const settingsMessage = (chat) =>
  settingsText(chat, chat.villages.map((id) => villages[id].short))

function retryMenu(data) {
  return new InlineKeyboard()
    .url("🌐 Сайт Волиньобленерго", officialUrl)
    .row()
    .text("🔄 Спробувати ще раз", data)
    .row()
    .text("⬅️ Назад", "back")
}

async function showDay(ctx, id, day) {
  const v = villages[id]
  const subscribed = subscribedIds(ctx.chat.id).includes(id)

  try {
    const sched = await getSchedule(day, v.queue)

    if (!sched) {
      await ctx.reply(
        `📍 ${v.name}\n🔢 Черга: ${v.queue}\n\nℹ️ Графік ${day === "today" ? "на сьогодні" : "на завтра"} ще не опублікований.`,
        { reply_markup: villageMenu(id, subscribed) }
      )
      return
    }

    if (day === "today") recordStats(v.queue, kyivNow().dayNum, sched.totalHours)

    const weather = await getWeatherText(v.lat, v.lon)
    await safeSend(ctx.api, ctx.chat.id, buildDayMessage({ village: v, day, sched, weather }), {
      photoUrl: sched.url,
      extra: { reply_markup: villageMenu(id, subscribed) },
    })
  } catch (error) {
    console.error("[day] error:", error)
    await ctx.reply("⚠️ Не вдалося завантажити графік.", {
      reply_markup: retryMenu(`d:${id}:${day}`),
    })
  }
}

async function showNow(ctx, id) {
  const v = villages[id]

  try {
    const today = await getSchedule("today", v.queue)
    if (!today) {
      await ctx.reply("ℹ️ Графік на сьогодні ще не опублікований.")
      return
    }
    const tomorrow = await getSchedule("tomorrow", v.queue)
    await ctx.reply(buildNowMessage({ village: v, today, tomorrow }), {
      reply_markup: villageMenu(id, subscribedIds(ctx.chat.id).includes(id)),
    })
  } catch (error) {
    console.error("[now] error:", error)
    await ctx.reply("⚠️ Не вдалося отримати дані.", { reply_markup: retryMenu(`n:${id}`) })
  }
}

async function showStats(ctx, id) {
  const v = villages[id]

  try {
    const today = await getSchedule("today", v.queue)
    if (today) recordStats(v.queue, kyivNow().dayNum, today.totalHours)
  } catch (error) {
    console.error("[stats] error:", error)
  }

  await ctx.reply(buildStatsMessage({ village: v, stats: getStats(v.queue) }), {
    reply_markup: villageMenu(id, subscribedIds(ctx.chat.id).includes(id)),
  })
}

// для команд /today, /tomorrow, /now, /stats: працюють по підписаних селах
async function forSubscribed(ctx, fn) {
  const ids = subscribedIds(ctx.chat.id)

  if (!ids.length) {
    await ctx.reply("Спершу оберіть населений пункт і підпишіться:", {
      reply_markup: mainMenu(ctx.chat.id),
    })
    return
  }

  for (const id of ids) await fn(ctx, id)
}

export function registerCommands(bot) {
  // Застарілі кнопки (після перезапуску бота) не мають ламати обробку
  bot.use(async (ctx, next) => {
    if (ctx.callbackQuery) {
      const orig = ctx.answerCallbackQuery.bind(ctx)
      ctx.answerCallbackQuery = (...args) =>
        orig(...args).catch((e) => {
          if (!/query is too old|query ID is invalid/i.test(e?.description || "")) throw e
          return true
        })
    }
    await next()
  })

  bot.command("start", (ctx) =>
    ctx.reply("⚡ ГРАФІК ВІДКЛЮЧЕНЬ СВІТЛА\n\nОберіть населений пункт:", {
      reply_markup: mainMenu(ctx.chat.id),
    })
  )

  bot.command("help", (ctx) =>
    ctx.reply(
      "⚡ Бот показує графіки відключень Волиньобленерго.\n\n" +
        "/start — вибір населеного пункту\n" +
        "/today — графік на сьогодні\n" +
        "/tomorrow — графік на завтра\n" +
        "/now — що зараз і що далі\n" +
        "/stats — статистика за 7 днів\n" +
        "/settings — налаштування сповіщень\n" +
        "/ping — перевірка роботи\n\n" +
        "Натисніть «🔔 Підписатися» в меню населеного пункту, і бот сам писатиме " +
        "перед відключенням, зранку й коли графік зміниться."
    )
  )

  bot.command("ping", (ctx) => ctx.reply("Бот працює ✅"))
  bot.command("today", (ctx) => forSubscribed(ctx, (c, id) => showDay(c, id, "today")))
  bot.command("tomorrow", (ctx) => forSubscribed(ctx, (c, id) => showDay(c, id, "tomorrow")))
  bot.command("now", (ctx) => forSubscribed(ctx, showNow))
  bot.command("stats", (ctx) => forSubscribed(ctx, showStats))

  bot.command("settings", (ctx) => {
    const chat = ensureChat(ctx.chat.id)
    return ctx.reply(settingsMessage(chat), { reply_markup: settingsMenu(chat) })
  })

  const known = (id) => !!villages[id]

  bot.callbackQuery(/^v:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const id = ctx.match[1]
    if (!known(id)) return
    const v = villages[id]

    await ctx.reply(`📍 ${v.name}\n🔢 Ваша черга: ${v.queue}\n\nОберіть, що показати:`, {
      reply_markup: villageMenu(id, subscribedIds(ctx.chat.id).includes(id)),
    })
  })

  bot.callbackQuery(/^d:(\w+):(today|tomorrow)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (known(ctx.match[1])) await showDay(ctx, ctx.match[1], ctx.match[2])
  })

  bot.callbackQuery(/^n:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (known(ctx.match[1])) await showNow(ctx, ctx.match[1])
  })

  bot.callbackQuery(/^s:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (known(ctx.match[1])) await showStats(ctx, ctx.match[1])
  })

  bot.callbackQuery(/^sub:(\w+)$/, async (ctx) => {
    const id = ctx.match[1]
    if (!known(id)) return ctx.answerCallbackQuery()

    const chat = ensureChat(ctx.chat.id)
    const wasOn = chat.villages.includes(id)

    if (wasOn) unsubscribe(chat, id)
    else subscribe(chat, id)
    save()

    await ctx.answerCallbackQuery({ text: wasOn ? "Сповіщення вимкнено 🔕" : "Підписано 🔔" })
    await ctx
      .editMessageReplyMarkup({ reply_markup: villageMenu(id, !wasOn) })
      .catch(() => {})

    if (!wasOn) {
      await ctx.reply(
        `🔔 Підписано: «${villages[id].name}».\n\n` +
          "Тепер я писатиму:\n" +
          `• за ${chat.lead} хв до відключення і коли світло має повернутися;\n` +
          `• зранку (${fmtTime(chat.morningTime)}) з графіком і погодою;\n` +
          "• коли з'явиться графік на завтра або він зміниться.\n\n" +
          "Змінити це можна в /settings."
      )
    }
  })

  bot.callbackQuery(/^st:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const chat = ensureChat(ctx.chat.id)

    switch (ctx.match[1]) {
      case "notify": chat.notify = !chat.notify; break
      case "morning": chat.morning = !chat.morning; break
      case "alerts": chat.alerts = !chat.alerts; break
      case "quiet": chat.quiet = !chat.quiet; break
      case "lead":
        chat.lead = LEADS[(LEADS.indexOf(chat.lead) + 1) % LEADS.length]
        break
      case "mtime":
        chat.morningTime = MORNINGS[(MORNINGS.indexOf(chat.morningTime) + 1) % MORNINGS.length]
        break
    }
    save()

    const opts = { reply_markup: settingsMenu(chat) }
    await ctx.editMessageText(settingsMessage(chat), opts).catch(async () => {
      await ctx.reply(settingsMessage(chat), opts).catch(() => {})
    })
  })

  bot.callbackQuery("back", async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply("🏡 Оберіть населений пункт:", { reply_markup: mainMenu(ctx.chat.id) })
  })

  bot.on("message:text", async (ctx) => {
    if (!ctx.message.text.startsWith("/")) {
      await ctx.reply("Щоб переглянути графік, натисніть /start")
    }
  })

  bot.api
    .setMyCommands([
      { command: "start", description: "Вибір населеного пункту" },
      { command: "today", description: "Графік на сьогодні" },
      { command: "tomorrow", description: "Графік на завтра" },
      { command: "now", description: "Що зараз і що далі" },
      { command: "stats", description: "Статистика за 7 днів" },
      { command: "settings", description: "Налаштування сповіщень" },
      { command: "help", description: "Допомога" },
    ])
    .catch(() => {})

  startScheduler(bot.api)
}
