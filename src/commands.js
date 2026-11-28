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
import { registerMonthly } from "./monthly.js"
import { registerMeter } from "./meter.js"
import { registerTales } from "./tales.js"
import { captureCommands, registerUI, startHub, showHome } from "./ui.js"
import { PLACE, health } from "./alarm.js"
import { historyFor } from "./dates.js"
import { getNews, newsConfigured } from "./news.js"
import { viberEnabled } from "../viber.js"
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

  kb.text("💵 Курс", "rates").text("⚙️ Налаштування", "st:open")
  if (viberEnabled()) kb.row().text("📣 Нагадування у Viber", "vr")
  return kb
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
  "🚨 Тривоги: " + PLACE +
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
  const registry = captureCommands(bot) // потрібно кнопкам меню
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

  bot.command("start", (ctx) => startHub(ctx))

  bot.command("help", (ctx) =>
    ctx.reply(
      "⚡ Бот показує графіки відключень Волиньобленерго.\n\n" +
        "/start, /menu — головне меню з кнопками\n" +
        "/today — графік на сьогодні\n" +
        "/tomorrow — графік на завтра\n" +
        "/now — що зараз і що далі\n" +
        "/stats — статистика за 7 днів\n" +
        "/month — статистика за 30 днів\n" +
        "/calendar — відключення в календар телефона\n" +
        "/share — поділитися ботом\n" +
        "/monthly — нагадування про показники й інтернет\n" +
        "/meter — облік електрики (/meter 12345), /tariff — тариф\n" +
        "/kazka — казка на ніч\n" +
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
  registerMonthly(bot)
  registerMeter(bot)
  registerTales(bot)
  bot.command("today", (ctx) => forSubscribed(ctx, (c, id) => showDay(c, id, "today")))
  bot.command("tomorrow", (ctx) => forSubscribed(ctx, (c, id) => showDay(c, id, "tomorrow")))
  bot.command("now", (ctx) => forSubscribed(ctx, showNow))
  bot.command("stats", (ctx) => forSubscribed(ctx, showStats))

  bot.command("settings", (ctx) => {
    const chat = ensureChat(ctx.chat.id)
    return ctx.reply(settingsMessage(chat), { reply_markup: settingsMenu(chat) })
  })


  // ---- нагадування ----
  bot.command("myid", (ctx) => ctx.reply(`Ваш Telegram ID: ${ctx.from?.id}`))

  // Хто може слати нагадування у Viber-канал: VIBER_REMIND_USERS=123456,789012 (Telegram ID)
  const viberRemindAllowed = (userId) =>
    (process.env.VIBER_REMIND_USERS || "")
      .split(",").map((x) => x.trim()).filter(Boolean)
      .includes(String(userId))

  // Режим «напишіть текст — і він піде у Viber»: чекаємо наступне повідомлення від цієї людини
  const pendingViber = new Map() // `${chatId}:${userId}` -> час, до якого чекаємо
  const pendKey = (ctx) => `${ctx.chat.id}:${ctx.from?.id}`
  const PEND_TTL = 10 * 60_000

  async function startViberReminder(ctx) {
    if (!viberEnabled()) return ctx.reply("Viber ще не підключений до бота.")
    if (!viberRemindAllowed(ctx.from?.id)) {
      return ctx.reply(
        "⛔ Нагадування у Viber доступні лише дозволеним користувачам.\n" +
          `Ваш Telegram ID: ${ctx.from?.id}. Адміністратор має додати його у VIBER_REMIND_USERS.`
      )
    }
    pendingViber.set(pendKey(ctx), Date.now() + PEND_TTL)
    return ctx.reply(
      "📣 Напишіть одним повідомленням, коли й що нагадати у Viber. Наприклад:\n\n" +
        "завтра о 8:00 сміття\n" +
        "через 30 хв збори в школі\n" +
        "щодня 21:00 вимкнути воду\n\n" +
        "Скасувати: /cancel"
    )
  }

  bot.command("vr", startViberReminder)
  bot.callbackQuery("vr", async (ctx) => {
    await ctx.answerCallbackQuery()
    await startViberReminder(ctx)
  })
  bot.command("cancel", (ctx) => {
    const had = pendingViber.delete(pendKey(ctx))
    return ctx.reply(had ? "Скасовано." : "Нічого скасовувати.")
  })

  bot.command("remind", async (ctx) => {
    let text = (ctx.match || "").trim()
    if (!text) return ctx.reply(remindHelp)

    // «/remind viber завтра о 8:00 текст» — ще й у Viber-канал
    let toViber = false
    const vm = text.match(/^(viber|вайбер)\s+(.+)$/i)
    if (vm) {
      if (!viberEnabled()) return ctx.reply("Viber ще не підключений до бота.")
      if (!viberRemindAllowed(ctx.from?.id)) {
        return ctx.reply(
          "⛔ Нагадування у Viber доступні лише дозволеним користувачам.\n" +
            `Ваш Telegram ID: ${ctx.from?.id}. Адміністратор бота має додати його у змінну VIBER_REMIND_USERS.`
        )
      }
      toViber = true
      text = vm[2]
    }

    const res = parseRemind(text, kyivNow())
    if (!res.ok) return ctx.reply(`⚠️ ${res.error}\n\n${remindHelp}`)

    if (listReminders(ctx.chat.id).length >= 30) {
      return ctx.reply("⚠️ Забагато нагадувань (максимум 30). Видаліть зайві: /reminders")
    }

    const id = addReminder({
      chatId: ctx.chat.id, kind: res.kind, due: res.due, time: res.time,
      text: res.text, by: ctx.from?.first_name || "", viber: toViber,
    })

    await ctx.reply(`✅ Нагадування #${id}${toViber ? " (+ Viber)" : ""}\n${res.whenLabel}\n${res.text}`)
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
    const a = getAlarm()
    const ago = health.at ? Math.round((Date.now() - health.at) / 60000) : null

    await ctx.reply(
      (a.active
        ? `🚨 Зараз тривога (${PLACE}): ${a.scope}, триває ${fmtDur(Math.max(1, Math.round((Date.now() - a.since) / 60000)))}.`
        : `✅ Зараз тривоги немає (${PLACE}).`) +
        "\n\n" +
        (ago === null
          ? "ℹ️ Перевірка ще не виконувалась."
          : `ℹ️ Джерело: ${health.source}, перевірено ${ago === 0 ? "щойно" : `${ago} хв тому`}.` +
            (health.error ? `\n⚠️ ${health.error}` : "")) +
        "\n⚠️ Не замінює офіційні сповіщення та сирени."
    )
  })

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
  bot.command("fact", (ctx) => sendFun(ctx.api, ctx.chat.id, randomFun("fact")))
  bot.command("joke", (ctx) => sendFun(ctx.api, ctx.chat.id, randomFun("joke")))
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
    await showHome(ctx, true)
  })

  registerUI(bot, { registry, showDay, showNow })

  bot.on("message:text", async (ctx) => {
    const k = pendKey(ctx)
    const until = pendingViber.get(k)

    if (until && !ctx.message.text.startsWith("/")) {
      if (Date.now() > until || !viberRemindAllowed(ctx.from?.id)) {
        pendingViber.delete(k)
      } else {
        const res = parseRemind(ctx.message.text, kyivNow())
        if (!res.ok) {
          return ctx.reply(`⚠️ ${res.error}\n\nСпробуйте ще раз або /cancel.\n\n${remindHelp}`)
        }
        if (listReminders(ctx.chat.id).length >= 30) {
          pendingViber.delete(k)
          return ctx.reply("⚠️ Забагато нагадувань (максимум 30). Видаліть зайві: /reminders")
        }

        pendingViber.delete(k)
        const id = addReminder({
          chatId: ctx.chat.id, kind: res.kind, due: res.due, time: res.time,
          text: res.text, by: ctx.from?.first_name || "", viber: true, tg: false,
        })
        return ctx.reply(`✅ Нагадування у Viber #${id}\n${res.whenLabel}\n${res.text}`)
      }
    }

    // Без команди: «viber завтра о 8:00 сміття» (для дозволених користувачів, у приватному чаті чи групі)
    const direct = ctx.message.text.match(/^(?:viber|вайбер)[\s,:]+(.+)$/is)
    if (direct && viberEnabled() && viberRemindAllowed(ctx.from?.id)) {
      const res = parseRemind(direct[1], kyivNow())
      if (!res.ok) return ctx.reply(`⚠️ ${res.error}\n\n${remindHelp}`)
      if (listReminders(ctx.chat.id).length >= 30) {
        return ctx.reply("⚠️ Забагато нагадувань (максимум 30). Видаліть зайві: /reminders")
      }
      const id = addReminder({
        chatId: ctx.chat.id, kind: res.kind, due: res.due, time: res.time,
        text: res.text, by: ctx.from?.first_name || "", viber: true, tg: false,
      })
      return ctx.reply(`✅ Нагадування у Viber #${id}\n${res.whenLabel}\n${res.text}`)
    }

    // у групах мовчимо, щоб не засмічувати чат (відповідаємо лише в приватному)
    if (ctx.chat.type === "private" && !ctx.message.text.startsWith("/")) {
      await ctx.reply("Щоб переглянути графік, натисніть /start")
    }
  })

  bot.api
    .setMyCommands([
      { command: "start", description: "Початок і головне меню" },
      { command: "menu", description: "Головне меню з кнопками" },
      { command: "today", description: "Графік на сьогодні" },
      { command: "tomorrow", description: "Графік на завтра" },
      { command: "now", description: "Що зараз і що далі" },
      { command: "stats", description: "Статистика за 7 днів" },
      { command: "month", description: "Статистика за 30 днів" },
      { command: "calendar", description: "Відключення в календар" },
      { command: "share", description: "Поділитися ботом" },
      { command: "monthly", description: "Показники й оплата інтернету" },
      { command: "meter", description: "Облік електрики: показники, прогноз" },
      { command: "tariff", description: "Тариф на електрику" },
      { command: "kazka", description: "Казка на ніч" },
      { command: "remind", description: "Створити нагадування" },
      { command: "vr", description: "Нагадування у Viber" },
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
