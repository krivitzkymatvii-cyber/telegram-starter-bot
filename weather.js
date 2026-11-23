// Погода через Open-Meteo (безкоштовно, без ключа)

const codes = [
  [[0], "☀️ ясно"],
  [[1, 2], "🌤️ мінлива хмарність"],
  [[3], "☁️ хмарно"],
  [[45, 48], "🌫️ туман"],
  [[51, 53, 55, 56, 57], "🌦️ мряка"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "🌧️ дощ"],
  [[71, 73, 75, 77, 85, 86], "❄️ сніг"],
  [[95, 96, 99], "⛈️ гроза"],
]

function describe(code) {
  const found = codes.find(([list]) => list.includes(code))
  return found ? found[1] : "🌡️ без опису"
}

const sign = (n) => (n > 0 ? `+${n}` : `${n}`)

function line(label, d, i) {
  const max = Math.round(d.temperature_2m_max[i])
  const min = Math.round(d.temperature_2m_min[i])
  const rain = d.precipitation_probability_max[i]
  const wind = Math.round(d.wind_speed_10m_max[i])

  return (
    `${label}: ${describe(d.weather_code[i])}, ` +
    `${sign(min)}…${sign(max)}°C, ` +
    `опади ${rain}%, вітер до ${wind} км/год`
  )
}

// Повертає текст погоди на сьогодні й завтра, або "" якщо сервіс недоступний
const cache = new Map()

export async function getWeatherText(lat, lon) {
  const key = `${lat},${lon}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.text

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast")
    url.searchParams.set("latitude", lat)
    url.searchParams.set("longitude", lon)
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min," +
        "precipitation_probability_max,wind_speed_10m_max"
    )
    url.searchParams.set("timezone", "Europe/Kyiv")
    url.searchParams.set("forecast_days", "2")

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) return ""

    const { daily } = await response.json()

    const text =
      "🌍 Погода\n" +
      line("Сьогодні", daily, 0) +
      "\n" +
      line("Завтра", daily, 1)

    cache.set(key, { at: Date.now(), text })
    return text
  } catch (error) {
    console.error("[weather] error:", error)
    return ""
  }
}
