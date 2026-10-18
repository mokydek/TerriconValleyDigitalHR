/**
 * Подготовка вложений чата в браузере: фото ужимаются, у фото и видео делается превью,
 * у голосового считается «волна». Файлы уходят в базу data URL, поэтому держим их компактными.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadImage, readAsDataUrl } from './files'
import type { OutgoingAttachment } from './chat'

export const MAX_CHAT_FILE = 5 * 1024 * 1024
export const MAX_ATTACHMENTS = 10
export const MAX_VOICE_SECONDS = 300

const bytesOf = (dataUrl: string) => Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)

function drawToJpeg(source: CanvasImageSource, w: number, h: number, maxSide: number, quality: number) {
  const k = Math.min(1, maxSide / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * k))
  canvas.height = Math.max(1, Math.round(h * k))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

/** Квадратная аватарка группы 256×256 */
export async function squareAvatar(file: File): Promise<string> {
  const img = await loadImage(await readAsDataUrl(file))
  const side = Math.min(img.width, img.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256)
  return canvas.toDataURL('image/jpeg', 0.85)
}

function videoFrame(src: string): Promise<{ thumb: string | null; width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    v.playsInline = true
    const done = (thumb: string | null) => resolve({ thumb, width: v.videoWidth || 0, height: v.videoHeight || 0, duration: Number.isFinite(v.duration) ? v.duration : 0 })
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 3)
    }
    v.onseeked = () => {
      try {
        done(drawToJpeg(v, v.videoWidth, v.videoHeight, 480, 0.7))
      } catch {
        done(null)
      }
    }
    v.onerror = () => done(null)
    window.setTimeout(() => done(null), 6000)
    v.src = src
  })
}

/** Файл из выбора, вставки или перетаскивания → вложение для send_message */
export async function prepareChatFile(file: File): Promise<OutgoingAttachment> {
  const type = file.type || ''
  if (type.startsWith('image/') && type !== 'image/svg+xml' && type !== 'image/gif') {
    const src = await readAsDataUrl(file)
    const img = await loadImage(src)
    const data = drawToJpeg(img, img.width, img.height, 1600, 0.85)
    const k = Math.min(1, 1600 / Math.max(img.width, img.height))
    return {
      kind: 'image',
      name: file.name.replace(/\.(png|webp|heic|heif|bmp|jpe?g)$/i, '') + '.jpg',
      mime: 'image/jpeg',
      size: bytesOf(data),
      data,
      thumb: drawToJpeg(img, img.width, img.height, 420, 0.7),
      width: Math.round(img.width * k),
      height: Math.round(img.height * k),
    }
  }
  if (file.size > MAX_CHAT_FILE) throw new Error('too-big')
  const data = await readAsDataUrl(file)
  if (type === 'image/gif') {
    const img = await loadImage(data)
    return { kind: 'image', name: file.name, mime: type, size: file.size, data, thumb: drawToJpeg(img, img.width, img.height, 420, 0.7), width: img.width, height: img.height }
  }
  if (type.startsWith('video/')) {
    const meta = await videoFrame(data)
    return { kind: 'video', name: file.name, mime: type, size: file.size, data, thumb: meta.thumb, width: meta.width, height: meta.height, duration: Math.round(meta.duration) }
  }
  return { kind: 'file', name: file.name, mime: type || 'application/octet-stream', size: file.size, data }
}

/** «Волна» голосового: 40 столбиков громкости от 0 до 1 */
export async function computeWaveform(blob: Blob, bars = 40): Promise<number[]> {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
    const data = audio.getChannelData(0)
    const step = Math.max(1, Math.floor(data.length / bars))
    const out: number[] = []
    for (let i = 0; i < bars; i++) {
      let sum = 0
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) sum += Math.abs(data[j])
      out.push(sum / step)
    }
    void ctx.close()
    const max = Math.max(...out, 0.0001)
    return out.map((v) => Math.round((0.12 + (0.88 * v) / max) * 100) / 100)
  } catch {
    return Array.from({ length: bars }, (_, i) => Math.round((0.35 + 0.4 * Math.abs(Math.sin(i * 1.7))) * 100) / 100)
  }
}

export function fmtDuration(seconds: number | null | undefined) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export type RecorderState = 'idle' | 'recording' | 'denied' | 'unsupported'

/** Запись голосового: старт, живой уровень громкости для анимации, стоп с готовым вложением или отмена */
export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>(() =>
    typeof window !== 'undefined' && 'MediaRecorder' in window && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'idle' : 'unsupported',
  )
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; timer: number; raf: number; ctx: AudioContext | null } | null>(null)

  const cleanup = useCallback(() => {
    const r = rec.current
    if (!r) return
    window.clearInterval(r.timer)
    cancelAnimationFrame(r.raf)
    r.stream.getTracks().forEach((t) => t.stop())
    void r.ctx?.close()
    rec.current = null
    setLevel(0)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    if (rec.current) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setState('denied')
      return
    }
    const mimeType = AUDIO_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? ''
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.start(250)
    let ctx: AudioContext | null = null
    let raf = 0
    try {
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
        setLevel(Math.min(1, peak / 64))
        raf = requestAnimationFrame(tick)
        if (rec.current) rec.current.raf = raf
      }
      raf = requestAnimationFrame(tick)
    } catch {
      ctx = null
    }
    const started = Date.now()
    setSeconds(0)
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250)
    rec.current = { recorder, stream, chunks, started, timer, raf, ctx }
    setState('recording')
  }, [])

  /** Остановить и получить вложение (null, если запись короче полсекунды) */
  const stop = useCallback(async (): Promise<OutgoingAttachment | null> => {
    const r = rec.current
    if (!r) return null
    const duration = (Date.now() - r.started) / 1000
    const done = new Promise<void>((resolve) => {
      r.recorder.onstop = () => resolve()
    })
    if (r.recorder.state !== 'inactive') r.recorder.stop()
    await done
    const mime = (r.recorder.mimeType || r.chunks[0]?.type || 'audio/webm').split(';')[0]
    const blob = new Blob(r.chunks, { type: mime })
    cleanup()
    setState('idle')
    if (duration < 0.5 || blob.size === 0) return null
    const data = await readAsDataUrl(blob)
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'
    return {
      kind: 'voice',
      name: `voice-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`,
      mime,
      size: blob.size,
      data,
      duration: Math.round(duration * 10) / 10,
      waveform: await computeWaveform(blob),
    }
  }, [cleanup])

  const cancel = useCallback(() => {
    const r = rec.current
    if (r && r.recorder.state !== 'inactive') r.recorder.stop()
    cleanup()
    setState((s) => (s === 'recording' ? 'idle' : s))
  }, [cleanup])

  // длинную запись останавливаем автоматически
  useEffect(() => {
    if (state === 'recording' && seconds >= MAX_VOICE_SECONDS) cancel()
  }, [seconds, state, cancel])

  return { state, seconds, level, start, stop, cancel }
}

/* ---------- Текст: ссылки и упоминания ---------- */

const URL_RX = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi

export function extractLinks(text: string): string[] {
  return [...text.matchAll(URL_RX)].map((m) => m[1])
}

export type TextToken = { type: 'text'; value: string } | { type: 'link'; value: string; href: string } | { type: 'mention'; value: string; id: string }

/** Разбить текст на обычные куски, ссылки и упоминания «@Имя Фамилия» участников */
export function tokenize(text: string, people: { id: string; name: string }[]): TextToken[] {
  const names = people.filter((p) => p.name.trim()).sort((a, b) => b.name.length - a.name.length)
  const out: TextToken[] = []
  let rest = text
  const mentionAt = (s: string) => {
    let best: { index: number; person: { id: string; name: string } } | null = null
    for (const p of names) {
      const i = s.indexOf('@' + p.name)
      if (i >= 0 && (!best || i < best.index)) best = { index: i, person: p }
    }
    return best
  }
  while (rest) {
    URL_RX.lastIndex = 0
    const link = URL_RX.exec(rest)
    const mention = mentionAt(rest)
    const linkAt = link ? link.index : Infinity
    const mentionIdx = mention ? mention.index : Infinity
    if (linkAt === Infinity && mentionIdx === Infinity) {
      out.push({ type: 'text', value: rest })
      break
    }
    if (mentionIdx < linkAt && mention) {
      if (mention.index) out.push({ type: 'text', value: rest.slice(0, mention.index) })
      out.push({ type: 'mention', value: '@' + mention.person.name, id: mention.person.id })
      rest = rest.slice(mention.index + mention.person.name.length + 1)
    } else if (link) {
      if (link.index) out.push({ type: 'text', value: rest.slice(0, link.index) })
      const href = link[1].startsWith('www.') ? `https://${link[1]}` : link[1]
      out.push({ type: 'link', value: link[1], href })
      rest = rest.slice(link.index + link[1].length)
    }
  }
  return out
}

/** Кого упомянули в тексте (для уведомлений) */
export function mentionedIds(text: string, people: { id: string; name: string }[]): string[] {
  return [...new Set(tokenize(text, people).flatMap((t) => (t.type === 'mention' ? [t.id] : [])))]
}

/** Цвет и подпись значка файла по расширению */
export function fileBadge(name: string, mime: string): { label: string; tone: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (mime === 'application/pdf' || ext === 'pdf') return { label: 'PDF', tone: 'bg-rose-500' }
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return { label: 'DOC', tone: 'bg-sky-600' }
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return { label: 'XLS', tone: 'bg-emerald-600' }
  if (['ppt', 'pptx', 'odp'].includes(ext)) return { label: 'PPT', tone: 'bg-orange-500' }
  if (['zip', 'rar', '7z', 'gz'].includes(ext)) return { label: 'ZIP', tone: 'bg-violet-600' }
  if (mime.startsWith('audio/')) return { label: 'AUDIO', tone: 'bg-fuchsia-600' }
  if (mime.startsWith('image/')) return { label: 'IMG', tone: 'bg-teal-600' }
  return { label: (ext || 'FILE').slice(0, 4).toUpperCase(), tone: 'bg-slate-500' }
}
