import { removeChat } from "./store.js"

const isGone = (e) =>
  e?.error_code === 403 ||
  (e?.error_code === 400 && /chat not found/i.test(e?.description || ""))

// Надсилає фото з підписом (або текст). Видаляє чати, де бота заблокували.
export async function safeSend(api, chatId, text, opts = {}) {
  const { photoUrl, silent, extra = {} } = opts
  const o = { ...extra }
  if (silent) o.disable_notification = true

  try {
    if (photoUrl) {
      try {
        if (text.length <= 1000) {
          await api.sendPhoto(chatId, photoUrl, { ...o, caption: text })
          return true
        }
        await api.sendPhoto(chatId, photoUrl, {
          disable_notification: o.disable_notification,
        })
      } catch (error) {
        if (isGone(error)) throw error
        console.error("[send] photo failed:", error?.description || error)
      }
    }

    await api.sendMessage(chatId, text, o)
    return true
  } catch (error) {
    if (isGone(error)) {
      removeChat(chatId)
    } else {
      console.error("[send] error:", error?.description || error)
    }
    return false
  }
}
