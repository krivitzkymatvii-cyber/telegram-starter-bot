// Погодні поради за прогнозом Open-Meteo (без ключа)
const cache = new Map()
const r = (n) => Math.round(n)

export async function getDailyForecast(lat, lon) {
  const key = `${lat},${lon}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.daily

  const url = new URL("https://api.open-meteo.com/v1/forecast")
  url.searchParams.set("latitude", lat)
  url.searchParams.set("longitude", lon)
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,wind_gusts_10m_max,precipitation_sum,snowfall_sum"
  )
  url.searchParams.set("timezone", "Europe/Kyiv")
  url.searchParams.set("forecast_days", "2")

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`weather: ${res.status}`)

  const { daily } = await res.json()
  cache.set(key, { at: Date.now(), daily })
  return daily
}

// i: 0 = сьогодні, 1 = завтра; month: 1..12
export function tipsFromDaily(d, i, month) {
  const tips = []
  const tmin = d.temperature_2m_min[i]
  const tmax = d.temperature_2m_max[i]
  const gust = d.wind_gusts_10m_max[i]
  const rain = d.precipitation_sum[i]
  const snow = d.snowfall_sum[i]
  const code = d.weather_code[i]
  const growing = month >= 4 && month <= 10

  if (tmin <= -15) {
    tips.push(`🥶 Сильний мороз до ${r(tmin)}°C: перевірте опалення, утепліть труби, не залишайте воду в неопалюваних кімнатах.`)
  } else if (growing && tmin <= 0) {
    tips.push(`🥶 Заморозок до ${r(tmin)}°C: накрийте розсаду й теплолюбні рослини, злийте воду зі шлангів.`)
  }

  if ([56, 57, 66, 67].includes(code)) {
    tips.push("🧊 Ожеледиця: посипте ґанок і доріжки, на дорозі будьте обережні.")
  }
  if (snow >= 5) {
    tips.push(`❄️ Сильний сніг (~${r(snow)} см): приготуйте лопату, на дорозі їдьте повільно.`)
  }
  if (rain >= 15 || [65, 82].includes(code)) {
    tips.push(`🌧️ Сильний дощ (~${r(rain)} мм): перевірте ринви, підготуйте взуття й парасольку.`)
  }
  if (gust >= 90) {
    tips.push(`🌪️ Шквальний вітер до ${r(gust)} км/год: приберіть усе легке з двору, тримайтеся подалі від дерев.`)
  } else if (gust >= 60) {
    tips.push(`💨 Пориви до ${r(gust)} км/год: закріпіть легкі речі на подвір'ї, обережно під деревами.`)
  }
  if ([95, 96, 99].includes(code)) {
    tips.push("⛈️ Гроза: вимкніть з розеток цінну техніку, закрийте вікна, не стійте під деревами.")
  }
  if ([96, 99].includes(code)) {
    tips.push("🧊 Можливий град: накрийте або заховайте автівку.")
  }
  if (tmax >= 30) {
    tips.push(`🥵 Спека до ${r(tmax)}°C: більше води, уникайте сонця в обід, не залишайте дітей і тварин у машині.`)
  }
  if ([45, 48].includes(code)) {
    tips.push("🌫️ Туман: на дорозі погана видимість, вмикайте фари.")
  }

  return tips
}
