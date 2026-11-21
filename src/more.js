// Додаткові команди: /calendar, /month, /share
import { InlineKeyboard, InputFile } from "grammy"
import { villages } from "./villages.js"
import { getSchedule } from "./outages.js"
import { getChat, getStats } from "./store.js"
import { kyivNow } from "./schedule.js"
import { buildIcs, monthSummary, monthText } from "./calendar.js"

const subscribed = (chatId) =>
  (getChat(chatId)?.villages || []).filter((id) => villages[id])

const needSub = (ctx) =>
  ctx.reply("Спершу оберіть населений пункт і підпишіться: /start")

export function registerMore(bot) {
  // Файл календаря з відключеннями на сьогодні й завтра
  bot.command("calendar", async (ctx) => {
    const ids = subscribed(ctx.chat.id)
    if (!ids.length) return needSub(ctx)

    try {
      const { dayNum } = kyivNow()
      const items = []

      for (const id of ids) {
        const v = villages[id]
        for (const [off, day] of [[0, "today"], [1, "tomorrow"]]) {
          const s = await getSchedule(day, v.queue)
          if (s?.intervals?.length) {
            items.push({ village: v, dayNum: dayNum + off, intervals: s.intervals })
          }
        }
      }

      const lead = getChat(ctx.chat.id)?.lead || 30
      const { text, count } = buildIcs(items, { lead })

      if (!count) {
        return ctx.reply("На сьогодні й завтра відключень за графіком немає (або графік ще не опублікований).")
      }

      await ctx.replyWithDocument(
        new InputFile(Buffer.from(text, "utf8"), "vidkliuchennia.ics"),
        {
          caption:
            `📆 Відключень у календарі: ${count}.\n` +
            "Відкрийте файл на телефоні й додайте в календар: перед кожним буде нагадування.",
        }
      )
    } catch (error) {
      console.error("[calendar] error:", error?.message || error)
      await ctx.reply("⚠️ Не вдалося створити календар. Спробуйте пізніше.")
    }
  })

  // Статистика за 30 днів
  bot.command("month", async (ctx) => {
    const ids = subscribed(ctx.chat.id)
    if (!ids.length) return needSub(ctx)

    const { dayNum } = kyivNow()
    for (const id of ids) {
      const v = villages[id]
      await ctx.reply(monthText(v, monthSummary(getStats(v.queue), dayNum, 30), 30))
    }
  })

  // Поділитися ботом з сусідами
  bot.command("share", async (ctx) => {
    const link = `https://t.me/${ctx.me.username}`
    const text = "Бот із графіком відключень світла, попередженнями й погодою"
    const kb = new InlineKeyboard().url(
      "📤 Поділитися ботом",
      `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`
    )
    await ctx.reply(`Надішліть бота сусідам і родині:\n${link}`, { reply_markup: kb })
  })
}
