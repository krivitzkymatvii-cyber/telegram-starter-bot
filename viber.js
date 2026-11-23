
const VIBER_API = "https://chatapi.viber.com/pa"

async function viberRequest(method, payload = {}) {
  const token = process.env.VIBER_AUTH_TOKEN

  if (!token) {
    throw new Error("VIBER_AUTH_TOKEN не заданий")
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

export async function getViberChannelInfo() {
  const data = await viberRequest("get_account_info")

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

export async function postViberText(message) {
  const adminId = process.env.VIBER_SUPERADMIN_ID

  if (!adminId) {
    throw new Error("VIBER_SUPERADMIN_ID не заданий")
  }

  if (!message?.trim()) {
    throw new Error("Порожнє повідомлення")
  }

  return viberRequest("post", {
    from: adminId,
    type: "text",
    text: message.trim().slice(0, 7000),
  })
}

export async function testViberConnection() {
  const info = await getViberChannelInfo()

  return {
    connected: true,
    channel: info.name,
    channelId: info.channelId,
    adminId: info.adminId,
  }
}

export const viberEnabled = () =>
  Boolean(process.env.VIBER_AUTH_TOKEN && process.env.VIBER_SUPERADMIN_ID)

export async function postViberPicture(url) {
  const adminId = process.env.VIBER_SUPERADMIN_ID

  if (!adminId) {
    throw new Error("VIBER_SUPERADMIN_ID не заданий")
  }

  return viberRequest("post", {
    from: adminId,
    type: "picture",
    media: url,
  })
}

// Viber не дає постити, поки не зареєстровано webhook (публічний https-URL).
export async function setViberWebhook(url) {
  return viberRequest("set_webhook", {
    url,
    event_types: ["failed"],
    send_name: false,
    send_photo: false,
  })
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
