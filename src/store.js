import fs from "node:fs"
import path from "node:path"

// Дані зберігаються у файлі. На FadeHost вкажіть постійну папку у DATA_DIR,
// інакше підписки можуть зникати після перезапуску.
const DIR = process.env.DATA_DIR || "./data"
const FILE = path.join(DIR, "bot-data.json")

let db = { chats: {}, stats: {} }

try {
  db = { ...db, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }
} catch {
  // файлу ще немає
}

export function save() {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    const tmp = FILE + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(db))
    fs.renameSync(tmp, FILE)
  } catch (error) {
    console.error("[store] save error:", error)
  }
}

export const defaults = {
  notify: true, // попередження перед відключенням + «світло має бути»
  lead: 30, // за скільки хвилин попереджати
  morning: true, // ранковий дайджест
  morningTime: 420, // 07:00
  alerts: true, // новий/змінений графік
  quiet: false, // вночі надсилати без звуку
}

export const getChat = (id) => db.chats[id]
export const allChats = () => Object.entries(db.chats)

export function ensureChat(id) {
  if (!db.chats[id]) {
    db.chats[id] = { ...defaults, villages: [], subs: {}, sent: {} }
  }
  return db.chats[id]
}

export function removeChat(id) {
  delete db.chats[id]
  save()
}

export function subscribe(chat, villageId) {
  if (!chat.villages.includes(villageId)) chat.villages.push(villageId)
  chat.subs[villageId] = { seen: {}, primed: false }
}

export function unsubscribe(chat, villageId) {
  chat.villages = chat.villages.filter((v) => v !== villageId)
  delete chat.subs[villageId]
}

export function recordStats(queue, dayNum, hours) {
  const q = (db.stats[queue] ||= {})
  if (q[dayNum] === hours) return
  q[dayNum] = hours
  for (const k of Object.keys(q)) if (+k < dayNum - 60) delete q[k]
  save()
}

export const getStats = (queue) => db.stats[queue] || {}
