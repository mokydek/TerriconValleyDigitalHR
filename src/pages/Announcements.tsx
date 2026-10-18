import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ChevronDown, Clock, ExternalLink, ImagePlus, LayoutGrid, Megaphone, Pin, Play, PlayCircle, Plus, X } from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { useAnnouncements, useCreateAnnouncement, useDepartments, useMarkAnnouncementRead } from '@/lib/api'
import { ANNOUNCEMENT_CATEGORIES } from '@/lib/constants'
import { fmtDateTime, fullName, timeAgo } from '@/lib/format'
import { prepareFile } from '@/lib/files'
import type { Announcement } from '@/lib/types'
import { cn } from '@/lib/utils'
import { isYouTubeThumb, parseYouTubeId, youTubeEmbed, youTubeThumb, youTubeWatch } from '@/lib/youtube'
import { Avatar, Badge, Button, Card, Empty, Field, Modal, PageHeader, Skeleton } from '@/components/ui'
import { AnnouncementCover, COVERS } from '@/components/announcements/AnnouncementCover'

type Item = Announcement & { read?: boolean }

/** Минуты чтения: ~180 слов в минуту */
export function readingMinutes(text: string) {
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 180))
}

/** Анонс: свой или первый абзац текста без разметки */
export function teaser(a: Pick<Announcement, 'summary' | 'body'>) {
  if (a.summary) return a.summary
  const first = a.body.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith('#')) ?? a.body
  return first
    .replace(/^[#>\-*\s]+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .trim()
}

export default function AnnouncementsPage() {
  const { role } = useAuth()
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const { data, isLoading } = useAnnouncements(50)
  const markRead = useMarkAnnouncementRead()
  const [filter, setFilter] = useState<string>('all')
  const [creating, setCreating] = useState(() => params.get('new') === '1' && role !== 'employee')
  const openId = params.get('open')
  const list = (data ?? []).filter((a) => filter === 'all' || a.category === filter) as Item[]
  const [hero, ...rest] = list

  const toggle = (a: Item) => {
    const next = new URLSearchParams(params)
    if (openId === a.id) next.delete('open')
    else {
      next.set('open', a.id)
      if (!a.read) markRead.mutate(a.id)
    }
    setParams(next, { replace: true })
  }

  // Открыть объявление по ссылке из уведомления
  useEffect(() => {
    if (!openId) return
    const a = (data ?? []).find((x) => x.id === openId) as Item | undefined
    if (a && !a.read) markRead.mutate(a.id)
    window.setTimeout(() => document.getElementById(`ann-${openId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
  }, [openId, data?.length])

  const unread = (data ?? []).filter((a) => !(a as Item).read).length

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t('nav.announcements')}
        subtitle={unread > 0 ? t('a2.unread', { n: unread }) : t('a2.allRead')}
        actions={
          role !== 'employee' && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} data-testid="new-announcement">
              {t('ann.publish')}
            </Button>
          )
        }
      />
      <div className="scrollbar-thin mb-5 flex gap-2 overflow-x-auto pb-1">
        {[['all', { label: t('common.all'), icon: LayoutGrid, style: '' }] as const, ...Object.entries(ANNOUNCEMENT_CATEGORIES)].map(([k, v]) => {
          const count = k === 'all' ? (data ?? []).length : (data ?? []).filter((a) => a.category === k).length
          if (k !== 'all' && count === 0) return null
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition active:scale-95',
                filter === k ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-soft ring-line hover:ring-brand-300',
              )}
            >
              <v.icon className="h-4 w-4" /> {v.label}
              <span className={cn('rounded-full px-1.5 text-xs', filter === k ? 'bg-white/25' : 'bg-canvas text-muted')}>{count}</span>
            </button>
          )
        })}
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-72" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      )}
      {!isLoading && list.length === 0 && (
        <Card>
          <Empty icon={<Megaphone className="h-6 w-6" />} title={t('ann.empty')} />
        </Card>
      )}

      {hero && <AnnouncementCard a={hero} big open={openId === hero.id} onToggle={() => toggle(hero)} />}
      <div className="stagger mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {rest.map((a, i) => (
          <div key={a.id} style={{ ['--i' as string]: i }} className={cn('min-w-0', openId === a.id && 'sm:col-span-2')}>
            <AnnouncementCard a={a} open={openId === a.id} onToggle={() => toggle(a)} />
          </div>
        ))}
      </div>
      <NewAnnouncement
        open={creating}
        onClose={() => {
          setCreating(false)
          if (params.get('new')) {
            const next = new URLSearchParams(params)
            next.delete('new')
            setParams(next, { replace: true })
          }
        }}
      />
    </div>
  )
}

function AnnouncementCard({ a, big, open, onToggle }: { a: Item; big?: boolean; open: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  const cat = ANNOUNCEMENT_CATEGORIES[a.category] ?? ANNOUNCEMENT_CATEGORIES.news
  const wide = big || open
  return (
    <article
      id={`ann-${a.id}`}
      className={cn(
        'group card scroll-mt-20 overflow-hidden transition-shadow duration-300',
        a.category === 'urgent' && 'border-rose-200',
        open ? 'shadow-[var(--shadow-pop)]' : 'lift',
        wide && 'sm:grid sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]',
        open && 'sm:grid-cols-1',
      )}
      data-testid="announcement"
    >
      <button onClick={onToggle} className="relative block w-full text-left" aria-expanded={open}>
        <AnnouncementCover cover={a.cover} image={a.image} alt={a.title} className={cn(open ? 'h-56 sm:h-72' : wide ? 'h-52 sm:h-full sm:min-h-[260px]' : 'h-40')} />
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {a.pinned && (
            <Badge className="bg-white/95 text-brand-700 ring-white shadow-sm">
              <Pin className="h-3 w-3" /> {t('ann.pinned')}
            </Badge>
          )}
          <Badge className={cn(cat.style, 'shadow-sm')}>
            <cat.icon className="h-3 w-3" /> {cat.label}
          </Badge>
          {a.video && (
            <Badge className="bg-ink/80 text-white ring-transparent shadow-sm backdrop-blur-sm" data-testid="announcement-video-badge">
              <PlayCircle className="h-3 w-3" /> {t('a2.videoBadge')}
            </Badge>
          )}
        </div>
        {/* Ролик приложен: кнопка «играть» поверх обложки, по клику объявление раскрывается с плеером */}
        {a.video && !open && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/95 text-brand-700 shadow-[var(--shadow-pop)] ring-8 ring-white/30 transition duration-300 group-hover:scale-110">
              <Play className="ml-0.5 h-6 w-6 fill-current" />
            </span>
          </span>
        )}
        {!a.read && <span className="absolute top-3 right-3 h-3 w-3 animate-pulse rounded-full bg-brand-500 ring-4 ring-white" title={t('home.unread')} />}
      </button>

      <div className="flex flex-col p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{timeAgo(a.created_at)}</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {t('a2.readMin', { n: readingMinutes(a.body) })}
          </span>
          {a.department && <span>{t('ann.for', { name: a.department.name })}</span>}
        </div>
        <h2 className={cn('mt-2 font-bold text-ink', big || open ? 'text-xl sm:text-2xl' : 'text-lg leading-snug')}>{a.title}</h2>
        {!open && <p className={cn('mt-2 text-[15px] leading-relaxed text-ink-soft', big ? 'line-clamp-4' : 'line-clamp-3')}>{teaser(a)}</p>}

        {/* Подробный текст раскрывается плавно */}
        <div className={cn('grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className="overflow-hidden">
            {open && (
              <div className="prose-jana mt-3 max-w-2xl animate-fade-in" data-testid="announcement-body">
                {a.summary && <p className="text-[17px] font-medium text-ink">{a.summary}</p>}
                {a.video && <AnnouncementVideo id={a.video} title={a.title} />}
                <ReactMarkdown>{a.body}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
            <Avatar id={a.author_id} name={fullName(a.author)} size={28} />
            <span className="min-w-0 truncate">
              <span className="font-medium text-ink">{fullName(a.author)}</span>
              {open && (
                <>
                  {' '}
                  · {a.author?.position} · {fmtDateTime(a.created_at)}
                </>
              )}
            </span>
          </div>
          <Button variant={open ? 'ghost' : 'soft'} size="sm" onClick={onToggle} data-testid="announcement-toggle">
            {open ? t('a2.collapse') : t('a2.readFull')}
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', open && 'rotate-180')} />
          </Button>
        </div>
      </div>
    </article>
  )
}

/** Ролик к объявлению: плеер YouTube без cookie до запуска и ссылка, если видео хочется открыть отдельно */
function AnnouncementVideo({ id, title }: { id: string; title: string }) {
  const { t } = useI18n()
  return (
    <figure className="not-prose my-5" data-testid="announcement-video">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink shadow-[var(--shadow-pop)]">
        <iframe
          className="absolute inset-0 h-full w-full"
          src={youTubeEmbed(id)}
          title={title}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <PlayCircle className="h-4 w-4 text-brand-600" /> {t('a2.videoCaption')}
        </span>
        <a href={youTubeWatch(id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
          {t('c2.openYoutube')} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </figcaption>
    </figure>
  )
}

function NewAnnouncement({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role, me } = useAuth()
  const { t } = useI18n()
  const create = useCreateAnnouncement()
  const departments = useDepartments()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('news')
  const [cover, setCover] = useState<string>('news')
  const [image, setImage] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [pinned, setPinned] = useState(false)
  const [audience, setAudience] = useState<string>(role === 'manager' ? me?.department_id ?? '' : '')
  const file = useRef<HTMLInputElement>(null)
  const video = parseYouTubeId(videoUrl)
  const videoBad = videoUrl.trim() !== '' && !video

  // Приложили ролик и своей картинки нет: обложкой становится его превью (можно сменить на иллюстрацию)
  useEffect(() => {
    if (video && (!image || isYouTubeThumb(image))) setImage(youTubeThumb(video))
    if (!video && isYouTubeThumb(image)) setImage(null)
  }, [video])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={t('ann.new')}
      subtitle={role === 'manager' ? t('ann.managerHint') : t('ann.notifyHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={create.isPending}
            disabled={!title.trim() || !body.trim() || videoBad}
            onClick={async () => {
              try {
                await create.mutateAsync({
                  title: title.trim(),
                  summary: summary.trim() || null,
                  body: body.trim(),
                  category,
                  cover,
                  image,
                  video,
                  pinned,
                  audience_department_id: audience || null,
                })
                toast.success(t('ann.published'))
                setTitle('')
                setSummary('')
                setBody('')
                setImage(null)
                setVideoUrl('')
                onClose()
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
            data-testid="announcement-submit"
          >
            {t('ann.publish')}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Field label={t('ann.titleLabel')}>
            <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="ann-title" />
          </Field>
          <Field label={t('a2.summary')} hint={t('a2.summaryHint')}>
            <input className="field" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <Field label={t('ann.body')} hint={t('a2.bodyHint')}>
            <textarea className="field min-h-[180px] font-mono text-[13.5px]" value={body} onChange={(e) => setBody(e.target.value)} data-testid="ann-body" />
          </Field>
          <Field label={t('a2.video')} hint={t('a2.videoHint')} error={videoBad ? t('a2.videoBad') : null}>
            <div className="relative">
              <PlayCircle className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                className={cn('field pl-9', videoBad && 'border-rose-300 focus:border-rose-400')}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://youtu.be/…"
                inputMode="url"
                data-testid="ann-video"
              />
            </div>
            {video && (
              <div className="mt-2 flex animate-fade-in items-center gap-3 rounded-xl bg-brand-50/60 p-2 ring-1 ring-brand-100" data-testid="ann-video-preview">
                <span className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-ink">
                  <img src={youTubeThumb(video)} alt="" className="h-full w-full object-cover" />
                  <Play className="absolute inset-0 m-auto h-4 w-4 fill-white text-white" />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium text-ink">{t('a2.videoAttached')}</span>
                  <a href={youTubeWatch(video)} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">
                    {t('c2.openYoutube')}
                  </a>
                </span>
                <button type="button" onClick={() => setVideoUrl('')} className="rounded-full p-1 text-muted hover:bg-white hover:text-ink" aria-label={t('common.delete')}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('ann.category')}>
              <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(ANNOUNCEMENT_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('ann.audience')}>
              <select className="field" value={audience} onChange={(e) => setAudience(e.target.value)} disabled={role === 'manager'}>
                <option value="">{t('ann.wholeCompany')}</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            {t('ann.pinNotify')}
          </label>
        </div>

        {/* Обложка: своя иллюстрация или загруженная картинка */}
        <div>
          <span className="label">{t('a2.cover')}</span>
          <div className="group relative mb-3 overflow-hidden rounded-2xl ring-1 ring-line">
            <AnnouncementCover cover={cover} image={image} className="h-36" />
            {image && (
              <button onClick={() => setImage(null)} className="absolute top-2 right-2 rounded-full bg-white/90 p-1 shadow" aria-label={t('common.delete')}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {COVERS.map((c) => (
              <button
                key={c}
                type="button"
                title={t(`a2.cover.${c}` as I18nKey)}
                onClick={() => {
                  setCover(c)
                  setImage(null)
                }}
                className={cn('overflow-hidden rounded-lg ring-2 transition active:scale-95', cover === c && !image ? 'ring-brand-500' : 'ring-transparent hover:ring-brand-200')}
              >
                <AnnouncementCover cover={c} className="h-10" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="grid h-10 place-items-center rounded-lg border-2 border-dashed border-line text-muted transition hover:border-brand-300 hover:text-brand-700"
              title={t('a2.upload')}
            >
              <ImagePlus className="h-4 w-4" />
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                setImage((await prepareFile(f, 1400)).data)
              } catch {
                toast.error(t('t2.fileTooBig'))
              }
            }}
          />
          <p className="mt-2 text-xs text-muted">{t('a2.coverHint')}</p>
        </div>
      </div>
    </Modal>
  )
}
