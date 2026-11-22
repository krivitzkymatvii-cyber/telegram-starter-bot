import { InlineKeyboard } from "grammy"
import { villages, villageIds } from "./villages.js"
import { getSchedule } from "./outages.js"
import { getWeatherText } from "./weather.js"
import {
  buildDayMessage, buildNowMessage, buildStatsMessage, settingsText,
} from "./messages.js"
import {
  ensureChat, getChat, subscribe, unsubscribe, save, recordStats, getStats,
  addReminder, listReminders, removeReminder, getAlarm,
} from "./store.js"
import { parseRemind, fmtReminder, remindHelp } from "./remind.js"
import { getRatesText } from "./rates.js"
import { randomFun, sendFun } from "./fun.js"
import { startExtras } from "./extras.js"
import { registerMore } from "./more.js"
import { historyFor } from "./dates.js"
import { getNews, newsConfigured } from "./news.js"
import { kyivNow, fmtTime, fmtDur } from "./schedule.js"
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

  return kb.text("💵 Курс", "rates").text("⚙️ Налаштування", "st:open")
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
    .text("🧩 Додаткові функції", "st2:open").row()
    .text("⬅️ Назад", "back")
}

const FUNTIMES = [720, 900, 1080, 1200]

function settingsMenu2(chat) {
  return new InlineKeyboard()
    .text(`${chat.alarm ? "🚨" : "🔕"} Повітряні тривоги: ${onOff(chat.alarm)}`, "st2:alarm").row()
    .text(`🌦️ Погодні поради: ${onOff(chat.wtips)}`, "st2:wtips").row()
    .text(`💵 Курс у ранковому повідомленні: ${onOff(chat.rates)}`, "st2:rates").row()
    .text(`🎭 Щоденна родзинка: ${onOff(chat.fun)}`, "st2:fun").row()
    .text(`🕕 Час родзинки: ${fmtTime(chat.funTime)}`, "st2:ftime").row()
    .text(`🎊 Привітання зі святами: ${onOff(chat.greet)}`, "st2:greet").row()
    .text(`📜 Цього дня в історії: ${onOff(chat.history)}`, "st2:history").row()
    .text("⬅️ Налаштування", "st:open")
}

const settingsMessage2 = () =>
  "🧩 ДОДАТКОВІ ФУНКЦІЇ\n\n" +
  "🚨 Тривоги: Волинська область" +
  (process.env.ALERTS_TOKEN ? "" : " (ще не підключені: потрібен токен)") +
  "\n🌦️ Поради: заморозки, вітер, гроза, ожеледиця тощо\n" +
  "🎭 Родзинка: факт, жарт, вікторина, загадка чи прислів'я щодня\n\n" +
  "⚠️ Бот не замінює офіційні сповіщення й сирени."

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

  bot.command("start", (ctx) => {
    ensureChat(ctx.chat.id) // щоб доходили тривоги й поради
    save()
    return ctx.reply("⚡ ГРАФІК ВІДКЛЮЧЕНЬ СВІТЛА\n\nОберіть населений пункт:", {
      reply_markup: mainMenu(ctx.chat.id),
    })
  })

  bot.command("help", (ctx) =>
    ctx.reply(
      "⚡ Бот показує графіки відключень Волиньобленерго.\n\n" +
        "/start — вибір населеного пункту\n" +
        "/today — графік на сьогодні\n" +
        "/tomorrow — графік на завтра\n" +
        "/now — що зараз і що далі\n" +
        "/stats — статистика за 7 днів\n" +
        "/month — статистика за 30 днів\n" +
        "/calendar — відключення в календар телефона\n" +
        "/share — поділитися ботом\n" +
        "/settings — налаштування сповіщень\n" +
        "/remind — нагадування (приклади: /remind)\n" +
        "/reminders — мої нагадування\n" +
        "/rates — курс валют НБУ\n" +
        "/alarm — стан повітряної тривоги\n" +
        "/fact, /joke, /quiz, /riddle, /proverb — родзинка\n" +
        "/history — цього дня в історії\n" +
        "/news — останні новини\n" +
        "/ping — перевірка роботи\n\n" +
        "Натисніть «🔔 Підписатися» в меню населеного пункту, і бот сам писатиме " +
        "перед відключенням, зранку й коли графік зміниться.\n\n" +
        "⚠️ Повітряні тривоги в боті допоміжні й не замінюють офіційні сповіщення та сирени."
    )
  )

  bot.command("ping", (ctx) => ctx.reply("Бот працює ✅"))
  registerMore(bot)
  bot.command("today", (ctx) => forSubscribed(ctx, (c, id) => showDay(c, id, "today")))
  bot.command("tomorrow", (ctx) => forSubscribed(ctx, (c, id) => showDay(c, id, "tomorrow")))
  bot.command("now", (ctx) => forSubscribed(ctx, showNow))
  bot.command("stats", (ctx) => forSubscribed(ctx, showStats))

  bot.command("settings", (ctx) => {
    const chat = ensureChat(ctx.chat.id)
    return ctx.reply(settingsMessage(chat), { reply_markup: settingsMenu(chat) })
  })


  // ---- нагадування ----
  bot.command("remind", async (ctx) => {
    const text = (ctx.match || "").trim()
    if (!text) return ctx.reply(remindHelp)

    const res = parseRemind(text, kyivNow())
    if (!res.ok) return ctx.reply(`⚠️ ${res.error}\n\n${remindHelp}`)

    if (listReminders(ctx.chat.id).length >= 30) {
      return ctx.reply("⚠️ Забагато нагадувань (максимум 30). Видаліть зайві: /reminders")
    }

    const id = addReminder({
      chatId: ctx.chat.id, kind: res.kind, due: res.due, time: res.time,
      text: res.text, by: ctx.from?.first_name || "",
    })

    await ctx.reply(`✅ Нагадування #${id}\n${res.whenLabel}\n${res.text}`)
  })

  async function showReminders(ctx) {
    const list = listReminders(ctx.chat.id)
    if (!list.length) return ctx.reply("Нагадувань немає. Створіть: /remind")

    const kb = new InlineKeyboard()
    list.forEach((r) => kb.text(`🗑 #${r.id}`, `rm:${r.id}`))

    return ctx.reply(list.map(fmtReminder).join("\n\n"), { reply_markup: kb })
  }

  bot.command("reminders", showReminders)

  bot.command("unremind", async (ctx) => {
    const id = parseInt(ctx.match, 10)
    if (!id) return ctx.reply("Вкажіть номер: /unremind 3")
    await ctx.reply(removeReminder(id, ctx.chat.id) ? `🗑 Видалено #${id}` : "Не знайшов таке нагадування.")
  })

  bot.callbackQuery(/^rm:(\d+)$/, async (ctx) => {
    const id = +ctx.match[1]
    const ok = removeReminder(id, ctx.chat.id)
    await ctx.answerCallbackQuery({ text: ok ? `Видалено #${id}` : "Уже видалено" })
    if (ok) await showReminders(ctx)
  })

  // ---- курс, тривога, родзинка ----
  const sendRates = async (ctx) => {
    try {
      await ctx.reply(await getRatesText())
    } catch (error) {
      console.error("[rates] error:", error)
      await ctx.reply("⚠️ Не вдалося отримати курс НБУ. Спробуйте пізніше.")
    }
  }

  bot.command("rates", sendRates)
  bot.callbackQuery("rates", async (ctx) => {
    await ctx.answerCallbackQuery()
    await sendRates(ctx)
  })

  bot.command("alarm", async (ctx) => {
    if (!process.env.ALERTS_TOKEN) {
      return ctx.reply("🚨 Тривоги ще не підключені (немає токена alerts.in.ua).")
    }

    const a = getAlarm()
    await ctx.reply(
      (a.active
        ? `🚨 Зараз тривога (${a.level === "oblast" ? "уся область" : a.places.join(", ")}), триває ${fmtDur(Math.max(1, Math.round((Date.now() - a.since) / 60000)))}.`
        : "✅ Зараз тривоги у Волинській області немає.") +
        "\n\n⚠️ Не замінює офіційні сповіщення та сирени."
    )
  })

  bot.command("fact", (ctx) => sendFun(ctx.api, ctx.chat.id, randomFun("fact")))
  bot.command("joke", (ctx) => sendFun(ctx.api, ctx.chat.id, randomFun("joke")))
  bot.command("news", async (ctx) => {
    if (!newsConfigured()) {
      return ctx.reply("Новини ще не підключені: у змінній NEWS_RSS_URL потрібна адреса RSS-стрічки.")
    }
    try {
      const items = await getNews(5)
      if (!items.length) return ctx.reply("Новин зараз не вдалося отримати. Спробуйте пізніше.")
      await ctx.reply(
        "📰 Останні новини\n\n" + items.map((n, i) => `${i + 1}. ${n.title}\n${n.link}`).join("\n\n"),
        { link_preview_options: { is_disabled: true } }
      )
    } catch (e) {
      console.error("[news] error:", e?.message || e)
      await ctx.reply("⚠️ Не вдалося отримати новини.")
    }
  })

  bot.command("history", (ctx) =>
    ctx.reply(historyFor(kyivNow().dayNum) || "На сьогодні запису немає. Спробуйте завтра 🙂")
  )
  bot.command("quiz", (ctx) => sendFun(ctx.api, ctx.chat.id, randomFun("quiz")))
  bot.command("riddle", (ctx) => sendFun(ctx.api, ctx.chat.id, randomFun("riddle")))
  bot.command("proverb", (ctx) => sendFun(ctx.api, ctx.chat.id, randomFun("proverb")))

  bot.callbackQuery(/^st2:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const chat = ensureChat(ctx.chat.id)

    switch (ctx.match[1]) {
      case "alarm": chat.alarm = !chat.alarm; break
      case "wtips": chat.wtips = !chat.wtips; break
      case "rates": chat.rates = !chat.rates; break
      case "fun": chat.fun = !chat.fun; break
      case "greet": chat.greet = !chat.greet; break
      case "history": chat.history = !chat.history; break
      case "ftime":
        chat.funTime = FUNTIMES[(FUNTIMES.indexOf(chat.funTime) + 1) % FUNTIMES.length]
        break
    }
    save()

    const opts = { reply_markup: settingsMenu2(chat) }
    await ctx.editMessageText(settingsMessage2(), opts).catch(async () => {
      await ctx.reply(settingsMessage2(), opts).catch(() => {})
    })
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
      { command: "month", description: "Статистика за 30 днів" },
      { command: "calendar", description: "Відключення в календар" },
      { command: "share", description: "Поділитися ботом" },
      { command: "remind", description: "Створити нагадування" },
      { command: "reminders", description: "Мої нагадування" },
      { command: "rates", description: "Курс валют НБУ" },
      { command: "alarm", description: "Стан повітряної тривоги" },
      { command: "fact", description: "Цікавий факт" },
      { command: "joke", description: "Жарт" },
      { command: "quiz", description: "Вікторина" },
      { command: "riddle", description: "Загадка" },
      { command: "proverb", description: "Прислів'я" },
      { command: "history", description: "Цього дня в історії" },
      { command: "news", description: "Останні новини" },
      { command: "settings", description: "Налаштування сповіщень" },
      { command: "help", description: "Допомога" },
    ])
    .catch(() => {})

  startScheduler(bot.api)
  startExtras(bot.api)
}
