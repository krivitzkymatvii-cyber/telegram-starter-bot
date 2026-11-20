import { InlineKeyboard } from "grammy"
import { getOutages, formatOutages } from "./outages.js"
import { getWeatherText } from "./weather.js"

const villages = {
  dmytrivka: { name: "Дмитрівка", queue: "5.2", lat: 50.91, lon: 25.27 },
  pozharky: { name: "Пожарки", queue: "1.1", lat: 50.91, lon: 25.27 },
  rozhyshche: {
    name: "Рожище, вул. Промислова, 89",
    queue: "5.2",
    lat: 50.91,
    lon: 25.27,
  },
}

const API_BASE = "https://api-voe-poweron.inneti.net"

const officialUrl =
  "https://energy.volyn.ua/spozhyvacham/perervy-u-elektropostachanni/hrafik-vidkliuchen/pagephp.php"

function mainMenu() {
  return new InlineKeyboard()
    .text("🏡 Дмитрівка", "village:dmytrivka")
    .row()
    .text("🏡 Пожарки", "village:pozharky")
    .row()
    .text("🏠 Рожище", "village:rozhyshche")
}

function dateMenu(id) {
  return new InlineKeyboard()
    .text("📅 Сьогодні", `graph:${id}:today`)
    .text("📅 Завтра", `graph:${id}:tomorrow`)
    .row()
    .text("⬅️ Інший населений пункт", "back")
}

async function getGraphImage(day) {
  const key =
    day === "today"
      ? "pw_gpv_image_today"
      : "pw_gpv_image_tomorrow"

  const url = new URL("/api/options", API_BASE)

  url.searchParams.append("option_key[]", "pw_gpv_image_today")
  url.searchParams.append("option_key[]", "pw_gpv_image_tomorrow")

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  const data = await response.json()
  const options = data["hydra:member"] || []

  const item = options.find(
    (option) => option.option_key === key
  )

  if (!item?.value) return null

  return new URL(item.value, API_BASE).toString()
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

const jokes = {
  none: [
    "Світло сьогодні без вихідних. Можна смажити, прати і пилососити одночасно 😎",
    "Енергетики сьогодні в доброму гуморі. Користуйтеся, поки дають!",
  ],
  light: [
    "Відключення невеликі, тож це не криза, а коротка медитація без розетки 🧘",
    "Трохи посидимо при свічках, романтика ж. Головне, щоб Wi-Fi не образився 🕯️",
  ],
  medium: [
    "Світло сьогодні як гість: приходить і йде, коли захоче. Тож заряджайте все, що заряджається 🔋",
    "Пральну машину запускаємо, поки є світло. Потім вона теж піде в тінь 🧺",
  ],
  heavy: [
    "Сьогодні світла небагато, зате буде що розповісти онукам 📖",
    "Дістаємо павербанки, ліхтарики й настільні ігри. Вечір обіцяє бути живим 🎲",
  ],
}

function buildMessage(village, dayName, outages, weather) {
  const when = dayName === "СЬОГОДНІ" ? "сьогодні" : "завтра"
  const h = outages.totalHours

  const joke =
    h === 0 ? pick(jokes.none)
    : h <= 4 ? pick(jokes.light)
    : h <= 7 ? pick(jokes.medium)
    : pick(jokes.heavy)

  return (
    `👋 Любі гості, дорога родино!\n\n` +
    `Графік на ${when} для «${village.name}» (черга ${village.queue}) такий:\n\n` +
    `${formatOutages(outages)}\n\n` +
    `${joke}\n\n` +
    (weather ? `${weather}\n\n` : "") +
    "ℹ️ Фактичний час перемикання може відрізнятися."
  )
}

export function registerCommands(bot) {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "⚡ ГРАФІК ВІДКЛЮЧЕНЬ СВІТЛА\n\nОберіть населений пункт:",
      { reply_markup: mainMenu() }
    )
  })

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "⚡ Бот показує графіки відключень Волиньобленерго.\n\n" +
      "/start — головне меню\n" +
      "/ping — перевірка роботи"
    )
  })

  bot.command("ping", (ctx) =>
    ctx.reply("Бот працює ✅")
  )

  bot.callbackQuery(
    /^village:(dmytrivka|pozharky|rozhyshche)$/,
    async (ctx) => {
      await ctx.answerCallbackQuery()

      const id = ctx.match[1]
      const village = villages[id]

      await ctx.reply(
        `📍 ${village.name}\n` +
        `🔢 Ваша черга: ${village.queue}\n\n` +
        "Оберіть день:",
        { reply_markup: dateMenu(id) }
      )
    }
  )

  bot.callbackQuery(
    /^graph:(dmytrivka|pozharky|rozhyshche):(today|tomorrow)$/,
    async (ctx) => {
      await ctx.answerCallbackQuery()

      const id = ctx.match[1]
      const day = ctx.match[2]
      const village = villages[id]

      const dayName =
        day === "today" ? "СЬОГОДНІ" : "ЗАВТРА"

      try {
        const imageUrl = await getGraphImage(day)

        if (!imageUrl) {
          await ctx.reply(
            `📍 ${village.name}\n` +
            `🔢 Черга: ${village.queue}\n\n` +
            "ℹ️ Графік ще не опублікований.",
            { reply_markup: dateMenu(id) }
          )
          return
        }

        const outages = await getOutages(imageUrl, village.queue)
        const weather = await getWeatherText(village.lat, village.lon)

        await ctx.replyWithPhoto(imageUrl, {
          caption: buildMessage(village, dayName, outages, weather),
          reply_markup: dateMenu(id),
        })
      } catch (error) {
        console.error("[graph] error:", error)

        await ctx.reply(
          "⚠️ Не вдалося завантажити графік.",
          {
            reply_markup: new InlineKeyboard()
              .url("🌐 Сайт Волиньобленерго", officialUrl)
              .row()
              .text("🔄 Спробувати ще раз", `graph:${id}:${day}`)
              .row()
              .text("⬅️ Назад", "back"),
          }
        )
      }
    }
  )

  bot.callbackQuery("back", async (ctx) => {
    await ctx.answerCallbackQuery()

    await ctx.reply(
      "🏡 Оберіть населений пункт:",
      { reply_markup: mainMenu() }
    )
  })

  bot.on("message:text", async (ctx) => {
    if (!ctx.message.text.startsWith("/")) {
      await ctx.reply(
        "Щоб переглянути графік, натисніть /start"
      )
    }
  })
}
