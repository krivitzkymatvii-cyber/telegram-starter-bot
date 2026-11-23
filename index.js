
import http from "node:http"
import { Bot, webhookCallback } from "grammy"
import { registerCommands } from "./src/commands.js"
import {
  viberChannels, testViberConnection, postViberText, setViberWebhook, startViberCallbackServer,
} from "./viber.js"

const token = process.env.TELEGRAM_BOT_TOKEN

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing")
  process.exit(1)
}

const mode = (process.env.TELEGRAM_MODE || "polling").trim().toLowerCase()
const bot = new Bot(token)

registerCommands(bot)

bot.catch((err) => {
  console.error("[bot] error:", err.error ?? err)
})

function explain(err) {
  const code = err?.error_code ?? err?.response?.error_code

  if (code === 401) {
    console.error("Telegram token rejected (401)")
  } else if (code === 404) {
    console.error("Telegram token invalid (404)")
  } else {
    console.error("[bot] Telegram error:", err?.message ?? err)
  }
}

async function main() {
  // Viber: для кожного каналу реєструємо webhook, перевіряємо з'єднання й (за потреби) шлемо тест
  const channels = viberChannels()
  const hooks = [...new Set(channels.map((c) => c.webhook).filter(Boolean))]

  if (hooks.length && process.env.VIBER_SERVE === "1" && mode !== "webhook") {
    startViberCallbackServer(http)
    await new Promise((r) => setTimeout(r, 500))
  }

  for (const ch of channels) {
    const tag = `[viber#${ch.n}]`

    if (ch.webhook) {
      try {
        await setViberWebhook(ch.webhook, ch)
        console.log(tag, "webhook set:", ch.webhook)
      } catch (error) {
        console.error(tag, "webhook error:", error.message)
      }
    }

    try {
      const info = await testViberConnection(ch)
      console.log(tag, "connected:", info.channel, "| admin ID:", info.adminId)
      if (!ch.adminId) {
        console.log(tag, `Додайте VIBER_SUPERADMIN_ID${ch.n === 1 ? "" : "_" + ch.n} = ${info.adminId}`)
      }
    } catch (error) {
      console.error(tag, "connection error:", error.message)
    }

    // Пробне повідомлення: VIBER_TEST=1, перезапустіть, потім приберіть змінну
    if (process.env.VIBER_TEST === "1" && ch.adminId) {
      try {
        await postViberText(`✅ Тест: бот підключений до Viber-каналу #${ch.n}`, ch)
        console.log(tag, "test message sent")
      } catch (error) {
        console.error(tag, "test send error:", error.message)
      }
    }
  }

  let me

  try {
    me = await bot.api.getMe()
  } catch (err) {
    explain(err)
    process.exit(1)
  }

  console.log(`[bot] logged in as @${me.username} (${mode} mode)`)

  if (mode === "webhook") {
    const url = (process.env.WEBHOOK_URL || "").trim().replace(/\/$/, "")

    if (!url.startsWith("https://")) {
      console.error("WEBHOOK_URL is missing or invalid")
      process.exit(1)
    }

    const secret = (process.env.WEBHOOK_SECRET || "").trim() || undefined
    const port = Number(process.env.PORT || 3000)
    const handle = webhookCallback(bot, "http", { secretToken: secret })

    http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/telegram") {
        return handle(req, res)
      }

      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "content-type": "text/plain" })
        return res.end(`@${me.username} is running`)
      }

      res.writeHead(404)
      res.end()
    }).listen(port, () => {
      console.log(`[bot] webhook server listening on port ${port}`)
    })

    await bot.api.setWebhook(`${url}/telegram`, {
      secret_token: secret,
    })

    console.log(`[bot] webhook set to ${url}/telegram`)
    return
  }

  await bot.api.deleteWebhook().catch(() => {})

  let wait = 20
  let waitingForOther = false

  for (;;) {
    const began = Date.now()
    let settled

    try {
      await bot.start({
        onStart: () => {
          if (!waitingForOther) {
            console.log("[bot] polling for updates")
            return
          }

          settled = setTimeout(() => {
            waitingForOther = false
            wait = 20
            console.log("[bot] receiving updates now")
          }, 45000)
        },
      })

      return
    } catch (err) {
      clearTimeout(settled)

      const code = err?.error_code ?? err?.response?.error_code

      if (code === 401 || code === 404) {
        explain(err)
        process.exit(1)
      }

      if (Date.now() - began > 120000) {
        wait = 20
        waitingForOther = false
      }

      if (code === 409) {
        if (!waitingForOther) {
          console.error("[bot] another copy is running")
          waitingForOther = true
        }
      } else {
        console.error("[bot] polling stopped:", err?.message ?? err)
      }

      console.error(`[bot] retrying in ${wait} seconds`)

      await new Promise((resolve) => setTimeout(resolve, wait * 1000))
      wait = Math.min(wait * 2, 300)
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    console.log(`[bot] ${signal}, stopping`)
    bot.stop().finally(() => process.exit(0))
  })
}

main()
