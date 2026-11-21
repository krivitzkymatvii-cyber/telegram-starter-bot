import sharp from "sharp"
import crypto from "node:crypto"
import { slotsToIntervals, kyivNow, createStaleState, fixStaleDays } from "./schedule.js"

const API_BASE = "https://api-voe-poweron.inneti.net"

// Геометрія виміряна на картинці 1750×2250. Інші розміри масштабуються.
const REF_W = 1750
const REF_H = 2250
const COL_X0 = 175 // початок першої колонки (00:00)
const COL_W = 64.9 // ширина півгодинної колонки
const ROW_H = 60 // висота рядка (підчерги)
const TABLE_TOPS = [420, 1311] // верх 1-го рядка: 00–12 та 12–24
const DARK_LIMIT = 150 // яскравість < 150 => світла немає

// 48 слотів по 30 хв: true = відключення
export async function getSlots(imageBuffer, queue) {
  const [q, s] = queue.split(".").map(Number)
  const rowIndex = (q - 1) * 2 + (s - 1)

  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const sx = info.width / REF_W
  const sy = info.height / REF_H
  const slots = []

  for (const top of TABLE_TOPS) {
    const y = Math.round((top + ROW_H * rowIndex + ROW_H / 2 - 2) * sy)

    for (let k = 0; k < 24; k++) {
      const x = Math.round((COL_X0 + COL_W * (k + 0.5)) * sx)
      const i = (y * info.width + x) * info.channels
      const brightness =
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      slots.push(brightness < DARK_LIMIT)
    }
  }

  return slots
}

// ---- завантаження графіків з кешем ----

let cache = { at: 0, days: null }
let inflight = null
const staleState = createStaleState()

async function refresh() {
  const url = new URL("/api/options", API_BASE)
  url.searchParams.append("option_key[]", "pw_gpv_image_today")
  url.searchParams.append("option_key[]", "pw_gpv_image_tomorrow")

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`API error: ${res.status}`)

  const data = await res.json()
  const options = data["hydra:member"] || []
  const days = {}

  for (const [day, key] of [
    ["today", "pw_gpv_image_today"],
    ["tomorrow", "pw_gpv_image_tomorrow"],
  ]) {
    const item = options.find((o) => o.option_key === key)
    if (!item?.value) {
      days[day] = null
      continue
    }

    const imgUrl = new URL(item.value, API_BASE).toString()
    const r = await fetch(imgUrl, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error(`Image error: ${r.status}`)

    const buffer = Buffer.from(await r.arrayBuffer())
    days[day] = {
      url: imgUrl,
      buffer,
      hash: crypto.createHash("sha1").update(buffer).digest("hex"),
    }
  }

  cache = { at: Date.now(), days: fixStaleDays(days, kyivNow().dayNum, staleState) }
}

async function loadDay(day, ttl) {
  if (!cache.days || Date.now() - cache.at >= ttl) {
    if (!inflight) inflight = refresh().finally(() => (inflight = null))
    await inflight
  }
  return cache.days[day]
}

const memo = new Map()

// { slots, intervals, totalHours, url } або null, якщо графік не опублікований
export async function getSchedule(day, queue, ttl = 60_000) {
  const img = await loadDay(day, ttl)
  if (!img) return null

  const key = img.hash + queue
  let r = memo.get(key)

  if (!r) {
    const slots = await getSlots(img.buffer, queue)
    const intervals = slotsToIntervals(slots)
    const minutes = intervals.reduce((sum, [a, b]) => sum + (b - a), 0)
    r = { slots, intervals, totalHours: minutes / 60 }
    if (memo.size > 40) memo.clear()
    memo.set(key, r)
  }

  return { ...r, url: img.url }
}
