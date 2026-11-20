import sharp from "sharp"

// Геометрія виміряна на картинці 1750×2250. Інші розміри масштабуються.
const REF_W = 1750
const REF_H = 2250
const COL_X0 = 175 // початок першої колонки (00:00)
const COL_W = 64.9 // ширина півгодинної колонки
const ROW_H = 60 // висота рядка (підчерги)
const TABLE_TOPS = [420, 1311] // верх 1-го рядка: 00–12 та 12–24
const DARK_LIMIT = 150 // яскравість < 150 => світла немає

const pad = (n) => String(n).padStart(2, "0")
const fmt = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`

// Повертає 48 слотів по 30 хв: true = відключення
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

// Зливає сусідні слоти в інтервали [початок, кінець] у хвилинах
export function slotsToIntervals(slots) {
  const result = []
  let start = null

  slots.forEach((off, i) => {
    if (off && start === null) start = i * 30
    if (!off && start !== null) {
      result.push([start, i * 30])
      start = null
    }
  })

  if (start !== null) result.push([start, 48 * 30])
  return result
}

export async function getOutages(imageUrl, queue) {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`Image error: ${response.status}`)

  const buffer = Buffer.from(await response.arrayBuffer())
  const slots = await getSlots(buffer, queue)
  const intervals = slotsToIntervals(slots)
  const totalMin = intervals.reduce((sum, [a, b]) => sum + (b - a), 0)

  return { intervals, totalHours: totalMin / 60 }
}

export function formatOutages({ intervals, totalHours }) {
  if (!intervals.length) return "✅ Відключень не заплановано"

  const lines = intervals.map(
    ([a, b]) => `🔴 ${fmt(a)} – ${b === 1440 ? "24:00" : fmt(b)}`
  )

  return lines.join("\n") + `\n\nРазом без світла: ${totalHours} год`
}
