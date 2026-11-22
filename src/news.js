// Новини з будь-якої RSS/Atom-стрічки: змінна NEWS_RSS_URL (можна кілька через кому)
const TTL = 5 * 60_000
let cache = { at: 0, key: "", items: [] }

const unescapeXml = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&")

const strip = (s) => unescapeXml(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()

// Розбір RSS (<item>) та Atom (<entry>): повертає [{ title, link }]
export function parseFeed(xml) {
  const items = []
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || []

  for (const b of blocks) {
    const title = strip((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
    let link = (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]
    if (!link || !link.trim()) link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1]
    link = link ? strip(link) : ""
    if (title && /^https?:\/\//i.test(link)) items.push({ title, link })
  }
  return items
}

export const newsConfigured = () => Boolean((process.env.NEWS_RSS_URL || "").trim())

export async function getNews(limit = 5) {
  const urls = (process.env.NEWS_RSS_URL || "").split(",").map((u) => u.trim()).filter(Boolean)
  const key = urls.join("|")

  if (cache.key !== key || Date.now() - cache.at > TTL) {
    const all = []
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; svitlo-bot)" },
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        all.push(...parseFeed(await res.text()))
      } catch (e) {
        console.error("[news] feed error:", url, e?.message || e)
      }
    }
    cache = { at: Date.now(), key, items: all }
  }

  return cache.items.slice(0, limit)
}
