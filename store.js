import fs from "node:fs"
import path from "node:path"

// Дані зберігаються у файлі. На FadeHost вкажіть постійну папку у DATA_DIR,
// інакше підписки можуть зникати після перезапуску.
const DIR = process.env.DATA_DIR || "./data"
const FILE = path.join(DIR, "bot-data.json")

let db = { chats: {}, stats: {}, reminders: [], nextId: 1, alarm: null, goverla: null }

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
  alarm: true, // повітряні тривоги
  wtips: true, // погодні поради
  rates: false, // курс валют у ранковому повідомленні
  fun: false, // щоденна родзинка (факт/жарт/вікторина)
  funTime: 1080, // 18:00
  greet: true, // привітання зі святами та особисті дати
  history: true, // «цього дня в історії»
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

// старі чати отримують значення нових налаштувань
for (const chat of Object.values(db.chats)) {
  for (const [k, v] of Object.entries(defaults)) {
    if (chat[k] === undefined) chat[k] = v
  }
}

// ---- нагадування ----
export const allReminders = () => db.reminders
export const listReminders = (chatId) =>
  db.reminders.filter((r) => String(r.chatId) === String(chatId))

export function addReminder(r) {
  const id = db.nextId++
  db.reminders.push({ id, last: 0, ...r })
  save()
  return id
}

export function removeReminder(id, chatId) {
  const before = db.reminders.length
  db.reminders = db.reminders.filter(
    (r) => !(r.id === id && String(r.chatId) === String(chatId))
  )
  if (db.reminders.length !== before) save()
  return db.reminders.length !== before
}

export function dropReminders(ids) {
  db.reminders = db.reminders.filter((r) => !ids.includes(r.id))
  save()
}

// ---- стан повітряної тривоги ----
export const getAlarm = () =>
  db.alarm || { active: false, level: 0, color: null, since: null, scope: "", clear: 0 }

export function setAlarm(a) {
  db.alarm = a
  save()
}

// ---- останній і попередній курс «Говерла» (для стрілок ▲▼) ----
export const getRatesState = () => db.goverla || { cur: null, prev: null }

export function setRatesState(state) {
  db.goverla = state
  save()
}
