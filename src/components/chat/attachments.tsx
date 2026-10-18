import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Download, Loader2, MessageCircle, Pause, Play, X } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useEmployeesLite } from '@/lib/api'
import { fetchAttachmentData, useAttachmentData, useOpenDirectChat } from '@/lib/chat'
import { fileBadge, fmtDuration } from '@/lib/chatMedia'
import { fileSize, openDataUrl } from '@/lib/files'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui'
import type { ChatAttachment } from '@/lib/types'

/* ---------- Фото: альбом как в Telegram ---------- */

const ROWS: Record<number, number[]> = { 1: [1], 2: [2], 3: [1, 2], 4: [2, 2], 5: [2, 3], 6: [3, 3], 7: [2, 2, 3], 8: [2, 3, 3], 9: [3, 3, 3], 10: [2, 2, 3, 3] }

export function MediaAlbum({ items, onOpen, className }: { items: ChatAttachment[]; onOpen: (index: number) => void; className?: string }) {
  const { t } = useI18n()
  const rows = ROWS[Math.min(items.length, 10)] ?? [items.length]
  const single = items.length === 1 ? items[0] : null
  // одиночное фото сохраняет пропорции, но не бывает слишком узким или высоким
  const ratio = single?.width && single?.height ? Math.min(1.9, Math.max(0.62, single.width / single.height)) : 4 / 3
  let index = 0
  return (
    <div className={cn('flex w-full flex-col gap-0.5 overflow-hidden', className)}>
      {rows.map((n, r) => {
        const row = items.slice(index, index + n)
        const start = index
        index += n
        return (
          <div key={r} className="flex gap-0.5" style={single ? { aspectRatio: String(ratio) } : { height: n === 1 ? 220 : n === 2 ? 170 : 124 }}>
            {row.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpen(start + i)}
                className="group/media relative min-w-0 flex-1 overflow-hidden bg-ink/10"
                aria-label={a.kind === 'video' ? t('msg.playVideo') : t('msg.openPhoto')}
                data-testid="chat-media"
              >
                {a.thumb ? (
                  <img src={a.thumb} alt={a.name} className="h-full w-full object-cover transition duration-300 group-hover/media:scale-[1.03]" draggable={false} />
                ) : (
                  <span className="grid h-full w-full place-items-center text-xs text-white/80">{a.name}</span>
                )}
                {a.kind === 'video' && (
                  <>
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-ink/55 text-white backdrop-blur-sm transition group-hover/media:scale-110">
                        <Play className="ml-0.5 h-5 w-5 fill-current" />
                      </span>
                    </span>
                    {Boolean(a.duration) && (
                      <span className="absolute top-1.5 left-1.5 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
                        {fmtDuration(a.duration)}
                      </span>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/* ---------- Просмотр фото и видео на весь экран ---------- */

export function Lightbox({ items, start, onClose }: { items: ChatAttachment[]; start: number; onClose: () => void }) {
  const { t } = useI18n()
  const [i, setI] = useState(start)
  const item = items[i]
  const data = useAttachmentData(item?.id)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items.length, onClose])
  if (!item) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink/92 text-white animate-fade-in" role="dialog" aria-modal data-testid="chat-lightbox">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm text-white/80">
          {item.name}
          {items.length > 1 && <span className="ml-2 text-white/50">{t('msg.ofN', { n: i + 1, total: items.length })}</span>}
        </span>
        <button
          type="button"
          className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40"
          disabled={!data.data}
          onClick={() => data.data && openDataUrl(data.data, item.name)}
          aria-label={t('msg.download')}
          title={t('msg.download')}
        >
          <Download className="h-5 w-5" />
        </button>
        <button type="button" className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label={t('common.close')}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-6" onClick={onClose}>
        {i > 0 && (
          <button
            type="button"
            onClick={(e) => (e.stopPropagation(), setI(i - 1))}
            className="absolute left-3 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20"
            aria-label={t('msg.prev')}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <div key={item.id} className="flex max-h-full max-w-full animate-pop items-center justify-center" onClick={(e) => e.stopPropagation()}>
          {!data.data ? (
            <div className="relative">
              {item.thumb && <img src={item.thumb} alt="" className="max-h-[80dvh] max-w-[92vw] scale-100 object-contain opacity-60 blur-[2px]" />}
              <Loader2 className="absolute inset-0 m-auto h-8 w-8 animate-spin" />
            </div>
          ) : item.kind === 'video' ? (
            <video src={data.data} controls autoPlay playsInline className="max-h-[82dvh] max-w-[92vw] rounded-lg" />
          ) : (
            <img src={data.data} alt={item.name} className="max-h-[82dvh] max-w-[92vw] rounded-lg object-contain" />
          )}
        </div>
        {i < items.length - 1 && (
          <button
            type="button"
            onClick={(e) => (e.stopPropagation(), setI(i + 1))}
            className="absolute right-3 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20"
            aria-label={t('msg.next')}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ---------- Файл ---------- */

export function FileCard({ a, mine }: { a: ChatAttachment; mine?: boolean }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const badge = fileBadge(a.name, a.mime)
  const download = async () => {
    setBusy(true)
    try {
      const data = await fetchAttachmentData(qc, a.id)
      if (data) openDataUrl(data, a.name)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void download()}
      className={cn('flex w-full min-w-[220px] items-center gap-3 rounded-xl p-1.5 text-left transition', mine ? 'hover:bg-white/10' : 'hover:bg-canvas')}
      title={t('msg.download')}
      data-testid="chat-file"
    >
      <span className={cn('relative grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[10px] font-bold tracking-wide text-white', badge.tone)}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : badge.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{a.name}</span>
        <span className={cn('flex items-center gap-1 text-xs', mine ? 'text-white/75' : 'text-muted')}>
          <Download className="h-3 w-3" /> {fileSize(a.size)}
        </span>
      </span>
    </button>
  )
}

/* ---------- Голосовое: волна, перемотка, скорость ---------- */

const SPEEDS = [1, 1.5, 2]

export function VoicePlayer({ a, mine }: { a: ChatAttachment; mine?: boolean }) {
  const { t } = useI18n()
  const [want, setWant] = useState(false)
  const data = useAttachmentData(a.id, want)
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState(1)
  const bars = a.waveform?.length ? a.waveform : Array.from({ length: 40 }, (_, i) => 0.3 + 0.35 * Math.abs(Math.sin(i * 1.3)))
  const duration = Number(a.duration) || 0

  useEffect(() => {
    if (!data.data || !want) return
    const el = new Audio(data.data)
    el.playbackRate = speed
    el.ontimeupdate = () => setProgress(el.duration && Number.isFinite(el.duration) ? el.currentTime / el.duration : el.currentTime / (duration || 1))
    el.onended = () => {
      setPlaying(false)
      setProgress(0)
    }
    audio.current = el
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    return () => {
      el.pause()
      audio.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data, want])

  const toggle = () => {
    if (!want) return setWant(true)
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play().then(() => setPlaying(true))
    else {
      el.pause()
      setPlaying(false)
    }
  }
  const seek = (x: number) => {
    const el = audio.current
    if (!el) return
    const total = Number.isFinite(el.duration) && el.duration ? el.duration : duration
    el.currentTime = x * total
    setProgress(x)
  }
  const loading = want && !data.data

  return (
    <div className="flex min-w-[230px] items-center gap-2.5 py-0.5" data-testid="chat-voice">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-95',
          mine ? 'bg-white text-brand-700' : 'bg-brand-600 text-white',
        )}
        aria-label={playing ? t('msg.pause') : t('msg.play')}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className="flex h-7 cursor-pointer items-center gap-[2px]"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            seek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
          }}
          role="slider"
          aria-label={t('msg.voice')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className={cn(
                'w-[3px] flex-1 rounded-full transition-colors',
                i / bars.length < progress ? (mine ? 'bg-white' : 'bg-brand-600') : mine ? 'bg-white/45' : 'bg-brand-200',
              )}
              style={{ height: `${Math.max(14, v * 100)}%` }}
            />
          ))}
        </div>
        <div className={cn('mt-0.5 flex items-center gap-2 text-[11px] tabular-nums', mine ? 'text-white/80' : 'text-muted')}>
          <span>{playing || progress ? fmtDuration(progress * duration) : fmtDuration(duration)}</span>
          {want && (
            <button
              type="button"
              onClick={() => {
                const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
                setSpeed(next)
                if (audio.current) audio.current.playbackRate = next
              }}
              className={cn('rounded px-1 font-semibold', mine ? 'bg-white/20' : 'bg-brand-50 text-brand-700')}
              aria-label={t('msg.speed')}
            >
              {speed}×
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Контакт коллеги ---------- */

export function ContactCard({ a, mine }: { a: ChatAttachment; mine?: boolean }) {
  const { t } = useI18n()
  const { me } = useAuth()
  const navigate = useNavigate()
  const people = useEmployeesLite()
  const open = useOpenDirectChat()
  const person = (people.data ?? []).find((p) => p.id === a.contact_id)
  return (
    <div className={cn('flex min-w-[230px] items-center gap-3 rounded-xl p-1.5', mine ? 'bg-white/10' : 'bg-canvas/70')} data-testid="chat-contact">
      <Avatar id={a.contact_id} name={person ? fullName(person) : a.name} size={42} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{person ? fullName(person) : a.name}</div>
        <div className={cn('truncate text-xs', mine ? 'text-white/75' : 'text-muted')}>{person?.position ?? t('msg.contact')}</div>
      </div>
      {a.contact_id && a.contact_id !== me?.id && (
        <button
          type="button"
          onClick={() =>
            open.mutate(a.contact_id!, {
              onSuccess: (id) => navigate(`/messages?chat=${id}`),
              onError: (e) => toast.error((e as Error).message),
            })
          }
          className={cn('rounded-lg p-2 transition', mine ? 'text-white hover:bg-white/15' : 'text-brand-700 hover:bg-white')}
          aria-label={t('chat.write')}
          title={t('chat.write')}
        >
          {open.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
        </button>
      )}
    </div>
  )
}
