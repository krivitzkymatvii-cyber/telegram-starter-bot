const VIBER_API = "https://chatapi.viber.com/pa"

// ---- канали ----
// Канал 1: VIBER_AUTH_TOKEN, VIBER_SUPERADMIN_ID, VIBER_VILLAGES (за замовчуванням dmytrivka)
// Канал 2: VIBER_AUTH_TOKEN_2, VIBER_SUPERADMIN_ID_2, VIBER_VILLAGES_2 (за замовчуванням rozhyshche)
// Webhook: VIBER_WEBHOOK_URL (спільний) або VIBER_WEBHOOK_URL_2 для другого каналу.
const list = (v) => (v || "").split(",").map((x) => x.trim()).filter(Boolean)

export function viberChannels() {
  const out = []

  for (const n of [1, 2]) {
    const sfx = n === 1 ? "" : `_${n}`
    const token = (process.env[`VIBER_AUTH_TOKEN${sfx}`] || "").trim()
    if (!token) continue

    out.push({
      n,
      key: n === 1 ? "viber" : `viber${n}`, // ключ «службового чату» у сховищі
      token,
      adminId: (process.env[`VIBER_SUPERADMIN_ID${sfx}`] || "").trim(),
      villages: list(process.env[`VIBER_VILLAGES${sfx}`] || (n === 1 ? "dmytrivka" : "rozhyshche")),
      webhook: (process.env[`VIBER_WEBHOOK_URL${sfx}`] || process.env.VIBER_WEBHOOK_URL || "").trim(),
    })
  }

  return out
}

export const isViberKey = (id) => /^viber\d*$/.test(String(id))

const primary = () => viberChannels().find((c) => c.n === 1) || {}

async function viberRequest(method, payload = {}, ch = primary()) {
  const token = ch.token

  if (!token) {
    throw new Error("Токен Viber-каналу не заданий")
  }

  const response = await fetch(`${VIBER_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      auth_token: token,
    }),
    signal: AbortSignal.timeout(15000), // без цього запит міг висіти вічно
  })

  let data
  try {
    data = await response.json()
  } catch {
    throw new Error(`Viber API: відповідь не JSON (http ${response.status})`)
  }

  if (!response.ok || data.status !== 0) {
    throw new Error(
      `Viber API error: ${data.status_message || response.statusText} ` +
        `(status ${data.status}, http ${response.status}) ${JSON.stringify(data)}`
    )
  }

  return data
}

export async function getViberChannelInfo(ch = primary()) {
  const data = await viberRequest("get_account_info", {}, ch)

  const admin = (data.members || []).find(
    (member) => member.role === "superadmin"
  )

  if (!admin?.id) {
    throw new Error("Не вдалося отримати ID адміністратора")
  }

  return {
    name: data.chat_hostname,
    channelId: data.Id,
    adminId: admin.id,
  }
}

export async function postViberText(message, ch = primary()) {
  const adminId = ch.adminId

  if (!adminId) {
    throw new Error("ID адміністратора Viber-каналу не заданий")
  }

  if (!message?.trim()) {
    throw new Error("Порожнє повідомлення")
  }

  return viberRequest("post", {
    from: adminId,
    type: "text",
    text: message.trim().slice(0, 7000),
  }, ch)
}

export async function testViberConnection(ch = primary()) {
  const info = await getViberChannelInfo(ch)

  return {
    connected: true,
    channel: info.name,
    channelId: info.channelId,
    adminId: info.adminId,
  }
}

// Основний канал налаштований (для нагадувань, тривог, сміття)
export const viberEnabled = () => {
  const ch = primary()
  return Boolean(ch.token && ch.adminId)
}

// Viber не дає постити, поки не зареєстровано webhook (публічний https-URL).
export async function setViberWebhook(url, ch = primary()) {
  return viberRequest("set_webhook", {
    url,
    event_types: ["failed"],
    send_name: false,
    send_photo: false,
  }, ch)
}

// Мінімальний сервер, який відповідає 200 на запити Viber (потрібен для перевірки webhook)
export function startViberCallbackServer(http) {
  const port = Number(process.env.PORT || 3000)
  http
    .createServer((req, res) => {
      req.resume()
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("ok")
    })
    .listen(port, () => console.log(`[viber] callback server on port ${port}`))
}
