
import { InlineKeyboard } from "grammy"
import sharp from "sharp"

const villages = {
  dmytrivka: { name: "Дмитрівка", queue: "5.2" },
  pozharky: { name: "Пожарки", queue: "1.1" },
  rozhyshche: {
    name: "Рожище, вул. Промислова, 89",
    queue: "5.2",
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

// Діагностика кольорів у зменшеному графіку
async function diagnoseGraph(day = "today") {
  const imageUrl = await getGraphImage(day)

  if (!imageUrl) {
    return "Графік ще не опублікований."
  }

  const response = await fetch(imageUrl)

  if (!response.ok) {
    throw new Error("Не вдалося завантажити графік")
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const metadata = await sharp(buffer).metadata()

  const { data, info } = await sharp(buffer)
    .resize(80, 32, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let result = ""

  for (let y = 0; y < info.height; y++) {
    let line = ""

    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3

      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      if (b > r * 1.15 && b > g * 0.95) {
        const brightness =
          0.2126 * r + 0.7152 * g + 0.0722 * b

        line += brightness < 135 ? "D" : "L"
      } else {
        line += "."
      }
    }

    result += line + "\n"
  }

  return (
    `Розмір оригіналу: ${metadata.width} × ${metadata.height}\n` +
    "D — темно-синій\n" +
    "L — світло-блакитний\n" +
    ". — інші кольори\n\n" +
    result
  )
}

// Сканування горизонтальних відрізків за координатами X
async function scanGraph(day = "today") {
  const imageUrl = await getGraphImage(day)

  if (!imageUrl) {
    return "Графік ще не опублікований."
  }

  const response = await fetch(imageUrl)

  if (!response.ok) {
    throw new Error("Не вдалося завантажити графік")
  }

  const buffer = Buffer.from(await response.arrayBuffer())

  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const width = info.width
  const height = info.height
  const channels = info.channels

  const rows = [
  1650, 1700, 1750, 1800, 1850,
  1900, 1950, 2000, 2050, 2100
]

  let result = `Розмір: ${width} × ${height}\n`

  for (const y of rows) {
    if (y >= height) continue

    const runs = []
    let current = null
    let start = 0

    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * channels

      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      let color = "."

      if (b > r * 1.15 && b > g * 0.95) {
        const brightness =
          0.2126 * r + 0.7152 * g + 0.0722 * b

        color = brightness < 135 ? "D" : "L"
      }

      if (color !== current) {
        if (
          current &&
          current !== "." &&
          x - start >= 8
        ) {
          runs.push(`${current}:${start}-${x}`)
        }

        current = color
        start = x
      }
    }

    if (
      current &&
      current !== "." &&
      width - start >= 8
    ) {
      runs.push(`${current}:${start}-${width}`)
    }

    result += `\nY=${y}\n`
    result += runs.join(" | ") || "Кольори не знайдені"
    result += "\n"
  }

  return result
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
      "/ping — перевірка роботи\n" +
      "/diag — діагностика кольорів\n" +
      "/scan — сканування графіка"
    )
  })

  bot.command("ping", (ctx) =>
    ctx.reply("Бот працює ✅")
  )

  bot.command("diag", async (ctx) => {
    await ctx.reply("🔍 Аналізую графік...")

    try {
      const result = await diagnoseGraph("today")
      await ctx.reply("```text\n" + result + "\n```")
    } catch (error) {
      console.error("[diag] error:", error)

      await ctx.reply(
        "⚠️ Помилка аналізу графіка. Перевірте Logs FadeHost."
      )
    }
  })

  bot.command("scan", async (ctx) => {
    await ctx.reply("🔍 Сканую горизонтальні відрізки графіка...")

    try {
      const result = await scanGraph("today")

      for (let i = 0; i < result.length; i += 3500) {
        await ctx.reply(result.slice(i, i + 3500))
      }
    } catch (error) {
      console.error("[scan] error:", error)

      await ctx.reply(
        "⚠️ Помилка сканування. Перевірте Logs FadeHost."
      )
    }
  })

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

        await ctx.reply(
          "ℹ️ Точні години відключень поки не розпізнані автоматично. Перегляньте офіційний графік."
        )

        await ctx.replyWithPhoto(imageUrl, {
          caption:
            `⚡ ГРАФІК ВІДКЛЮЧЕНЬ — ${dayName}\n\n` +
            `📍 ${village.name}\n` +
            `🔢 Ваша черга: ${village.queue}\n\n` +
            "D — відключення, L — світло є.\n" +
            "Фактичний час перемикання може відрізнятися.",
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
