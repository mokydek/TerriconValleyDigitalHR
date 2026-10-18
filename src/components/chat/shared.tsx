import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, CheckCircle2, Flame, Heart, Laugh, Megaphone, PartyPopper, ThumbsUp, Users } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { useChatMembers } from '@/lib/chat'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui'
import type { ChatEvent, ChatKind, ReactionKey } from '@/lib/types'

/* ---------- Аватар чата ---------- */

export function ChatAvatar({
  chat,
  size = 44,
  className,
}: {
  chat: { kind: ChatKind; title: string | null; peer_id?: string | null; avatar?: string | null }
  size?: number
  className?: string
}) {
  const { t } = useI18n()
  if (chat.kind === 'direct') return <Avatar id={chat.peer_id} name={chat.title ?? ''} size={size} className={className} />
  if (chat.kind === 'saved')
    return (
      <div
        className={cn('grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white', className)}
        style={{ width: size, height: size }}
        aria-label={t('msg.saved')}
      >
        <Bookmark style={{ width: size * 0.42, height: size * 0.42 }} />
      </div>
    )
  if (chat.avatar)
    return <img src={chat.avatar} alt="" aria-hidden className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
  const Icon = chat.kind === 'channel' ? Megaphone : Users
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center rounded-full',
        chat.kind === 'channel' ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon style={{ width: size * 0.45, height: size * 0.45 }} />
    </div>
  )
}

/** Название чата для показа: «Избранное» переводится, у остальных своё имя */
export function useChatTitle() {
  const { t } = useI18n()
  return (chat: { kind: ChatKind; title: string | null } | undefined | null) => (chat?.kind === 'saved' ? t('msg.saved') : (chat?.title ?? ''))
}

/* ---------- Реакции: свой набор значков вместо эмодзи ---------- */

export const REACTIONS: { key: ReactionKey; Icon: typeof Heart; tone: string; bg: string; fill?: boolean }[] = [
  { key: 'like', Icon: ThumbsUp, tone: 'text-sky-600', bg: 'bg-sky-50' },
  { key: 'heart', Icon: Heart, tone: 'text-rose-500', bg: 'bg-rose-50', fill: true },
  { key: 'fire', Icon: Flame, tone: 'text-orange-500', bg: 'bg-orange-50', fill: true },
  { key: 'party', Icon: PartyPopper, tone: 'text-violet-600', bg: 'bg-violet-50' },
  { key: 'laugh', Icon: Laugh, tone: 'text-amber-500', bg: 'bg-amber-50' },
  { key: 'ok', Icon: CheckCircle2, tone: 'text-emerald-600', bg: 'bg-emerald-50' },
]
export const reactionOf = (key: ReactionKey) => REACTIONS.find((r) => r.key === key) ?? REACTIONS[0]

export function ReactionIcon({ reaction, className }: { reaction: ReactionKey; className?: string }) {
  const r = reactionOf(reaction)
  return <r.Icon className={cn(r.tone, r.fill && 'fill-current', className)} />
}

/* ---------- Люди чата ---------- */

/** Участники чата и имена: «Вы» для себя, имя и фамилия для остальных */
export function useChatPeople(chatId: string | null | undefined) {
  const { me } = useAuth()
  const { t } = useI18n()
  const members = useChatMembers(chatId)
  return useMemo(() => {
    const byId = new Map((members.data ?? []).map((m) => [m.employee_id, m]))
    const nameOf = (id: string | null | undefined, self = true) =>
      !id ? '–' : self && id === me?.id ? t('chat.you') : fullName(byId.get(id)?.employee ?? undefined) || '–'
    const people = (members.data ?? []).filter((m) => m.employee).map((m) => ({ id: m.employee_id, name: fullName(m.employee) }))
    return { members, byId, nameOf, people }
  }, [members, me?.id, t])
}

/* ---------- Служебные события ---------- */

export function eventText(
  t: (k: I18nKey, v?: Record<string, string | number>) => string,
  e: ChatEvent | null,
  actor: string,
  names: (ids: string[]) => string,
  kind: ChatKind,
) {
  if (!e) return ''
  switch (e.event) {
    case 'created':
      return t(kind === 'channel' ? 'msg.ev.createdChannel' : 'msg.ev.createdGroup', { name: actor, title: e.title ?? '' })
    case 'renamed':
      return t('msg.ev.renamed', { name: actor, title: e.title ?? '' })
    case 'photo':
      return t('msg.ev.photo', { name: actor })
    case 'photo_removed':
      return t('msg.ev.photoRemoved', { name: actor })
    case 'added':
      return t('msg.ev.added', { name: actor, who: names(e.targets ?? []) })
    case 'removed':
      return t('msg.ev.removed', { name: actor, who: names(e.targets ?? []) })
    case 'left':
      return t('msg.ev.left', { name: actor })
    case 'pinned':
      return t('msg.ev.pinned', { name: actor })
    case 'admin':
      return t('msg.ev.admin', { name: actor, who: names(e.targets ?? []) })
    default:
      return ''
  }
}

/* ---------- Всплывающее меню у курсора ---------- */

/** Меню, которое не вылезает за край экрана: ставится у точки клика, закрывается по Esc и клику мимо */
export function FloatingMenu({ at, onClose, children, width = 240 }: { at: { x: number; y: number }; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: at.x, top: at.y, ready: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight
    const left = Math.max(8, Math.min(at.x, window.innerWidth - width - 8))
    const top = at.y + h + 8 > window.innerHeight ? Math.max(8, at.y - h) : at.y
    setPos({ left, top, ready: true })
  }, [at.x, at.y, width])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div
        ref={ref}
        role="menu"
        className={cn(
          'fixed z-[61] overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-[var(--shadow-pop)]',
          pos.ready ? 'animate-pop' : 'opacity-0',
        )}
        style={{ left: pos.left, top: pos.top, width }}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

export function MenuButton({ icon, children, onClick, danger, testId }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14.5px] font-medium transition',
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-ink-soft hover:bg-canvas hover:text-ink',
      )}
      data-testid={testId}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center">{icon}</span>
      {children}
    </button>
  )
}
