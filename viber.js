
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

  const members = data.members || []

  const admin = members.find(
    (member) => member.role === "superadmin"
  )

  if (!admin?.id) {
    throw new Error("Не знайдено ID супер адміністратора")
  }

  return {
    name: data.chat_hostname || data.name || "Viber Channel",
    channelId: data.Id || data.id || "ID не повернуто",
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
