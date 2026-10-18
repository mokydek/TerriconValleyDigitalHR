/**
 * Ролики YouTube в объявлениях и курсах: разбор ссылки, адрес плеера и превью.
 * Храним только идентификатор (11 символов), плеер встраиваем через youtube-nocookie.com.
 */
const ID = /^[A-Za-z0-9_-]{11}$/

/** Идентификатор ролика из ссылки любого вида (watch, youtu.be, shorts, embed, live) или из самого id */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (ID.test(s)) return s
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v')
    if (!id) {
      const [, kind, value] = url.pathname.split('/')
      if (['shorts', 'embed', 'live', 'v'].includes(kind)) id = value ?? null
    }
  }
  return id && ID.test(id) ? id : null
}

export const youTubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`
export const youTubeWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`
/** Превью ролика 480×360: подходит обложкой карточки, поля обрезает object-cover */
export const youTubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
export const isYouTubeThumb = (url: string | null | undefined) => Boolean(url?.startsWith('https://i.ytimg.com/vi/'))
