
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
  })

  const data = await response.json()

  if (!response.ok || data.status !== 0) {
    throw new Error(
      `Viber API error: ${data.status_message || response.statusText}`
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
