/** Файлы, которые пользователь прикладывает в интерфейсе: читаем в data URL, большие фото ужимаем в браузере */

export const MAX_FILE_BYTES = 3 * 1024 * 1024

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** Фото уменьшаем до maxSide по длинной стороне и сохраняем в JPEG: снимок с телефона 6 МБ → ~300 КБ */
export async function prepareFile(file: File, maxSide = 1600): Promise<{ name: string; mime: string; size: number; data: string }> {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml' && file.type !== 'image/gif') {
    const src = await readAsDataUrl(file)
    const img = await loadImage(src)
    const k = Math.min(1, maxSide / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * k)
    canvas.height = Math.round(img.height * k)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', 0.82)
    const size = Math.round((data.length - data.indexOf(',') - 1) * 0.75)
    return { name: file.name.replace(/\.(png|webp|heic|jpe?g)$/i, '') + '.jpg', mime: 'image/jpeg', size, data }
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('too-big')
  return { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data: await readAsDataUrl(file) }
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Открыть data URL как файл: картинку — в новой вкладке, остальное — скачать */
export function openDataUrl(data: string, name: string) {
  const a = document.createElement('a')
  a.href = data
  a.download = name
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
