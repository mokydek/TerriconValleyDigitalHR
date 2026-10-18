import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowLeft, ChevronDown, ChevronUp, Info, Pin, Search, Upload, X } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useChatInfo, useChatMessages, useDeleteMessage, useMarkChatRead, usePinMessage, usePollState, useTyping } from '@/lib/chat'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button, Drawer, Modal, Skeleton } from '@/components/ui'
import type { ChatAttachment, ChatListItem, ChatMessage } from '@/lib/types'
import { Lightbox } from './attachments'
import { ChatInfoPanel } from './ChatInfoPanel'
import { Composer, type ComposerHandle } from './Composer'
import { ForwardModal } from './ForwardModal'
import { MessageBubble, quotePreview, type BubbleActions } from './MessageBubble'
import { ChatAvatar, eventText, useChatPeople, useChatTitle } from './shared'

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function groupByDay(list: ChatMessage[]) {
  const out: { key: string; date: Date; items: ChatMessage[] }[] = []
  for (const m of list) {
    const date = new Date(m.created_at)
    const last = out[out.length - 1]
    if (last && isSameDay(last.date, date)) last.items.push(m)
    else out.push({ key: date.toDateString(), date, items: [m] })
  }
  return out
}

function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

export function Conversation({ chatId, chat, onBack, onLeft }: { chatId: string; chat?: ChatListItem; onBack: () => void; onLeft: () => void }) {
  const { me } = useAuth()
  const { t } = useI18n()
  const titleOf = useChatTitle()
  const messages = useChatMessages(chatId)
  const info = useChatInfo(chatId)
  const { members, nameOf, people } = useChatPeople(chatId)
  const markRead = useMarkChatRead()
  const pin = usePinMessage()
  const del = useDeleteMessage()
  const { typing, notify } = useTyping(chatId)
  const wide = useWide()

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null)
  const [deleting, setDeleting] = useState<ChatMessage | null>(null)
  const [viewer, setViewer] = useState<{ items: ChatAttachment[]; index: number } | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [below, setBelow] = useState(0)
  const [atBottom, setAtBottom] = useState(true)
  const [unreadFrom, setUnreadFrom] = useState<string | null | undefined>(undefined)
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const stick = useRef(true)
  const seen = useRef(0)

  const list = useMemo(() => messages.data ?? [], [messages.data])
  const byMsg = useMemo(() => new Map(list.map((m) => [m.id, m])), [list])
  const days = useMemo(() => groupByDay(list), [list])
  const kind = info.data?.kind ?? chat?.kind ?? 'direct'
  const isGroup = kind === 'group' || kind === 'channel'
  const myRole = (members.data ?? []).find((m) => m.employee_id === me?.id)?.role ?? chat?.my_role ?? 'member'
  const isAdmin = myRole === 'owner' || myRole === 'admin'
  const canPost = kind !== 'channel' || isAdmin
  const canPin = kind === 'direct' || kind === 'saved' || isAdmin
  const pinnedId = info.data?.pinned_message_id ?? null
  const pinned = pinnedId ? byMsg.get(pinnedId) : undefined
  const peer = kind === 'direct' ? (members.data ?? []).find((m) => m.employee_id !== me?.id)?.employee : null
  const title = kind === 'direct' ? (chat?.title ?? (peer ? nameOf(peer.id, false) : '')) : titleOf({ kind, title: info.data?.title ?? chat?.title ?? null })
  const others = useMemo(() => (members.data ?? []).filter((m) => m.employee_id !== me?.id), [members.data, me?.id])
  const mentionPeople = useMemo(() => people.filter((p) => p.id !== me?.id), [people, me?.id])
  const pollIds = useMemo(() => list.filter((m) => m.kind === 'poll').map((m) => m.id), [list])
  const polls = usePollState(pollIds)
  const pollById = useMemo(() => new Map((polls.data ?? []).map((p) => [p.message_id, p])), [polls.data])

  const subtitle = typing.length
    ? kind === 'direct'
      ? t('msg.typing')
      : typing.length === 1
        ? t('msg.typingName', { name: nameOf(typing[0], false).split(' ')[0] })
        : t('msg.typingMany', { n: typing.length })
    : kind === 'direct'
      ? (peer?.position ?? '')
      : kind === 'channel'
        ? t('msg.subscribers', { n: members.data?.length ?? chat?.member_count ?? 0 })
        : kind === 'group'
          ? t('chat.members', { n: members.data?.length ?? chat?.member_count ?? 0 })
          : t('msg.savedHint')

  // разделитель «Новые сообщения»: считаем один раз при открытии
  useEffect(() => {
    if (unreadFrom !== undefined || !members.data || !messages.data) return
    const mine = members.data.find((m) => m.employee_id === me?.id)
    const first = mine ? messages.data.find((m) => m.author_id !== me?.id && m.created_at > mine.last_read_at) : undefined
    setUnreadFrom(first?.id ?? null)
  }, [members.data, messages.data, me?.id, unreadFrom])

  // открытый чат считается прочитанным, в том числе когда приходят новые сообщения
  const lastId = list[list.length - 1]?.id
  const { mutate: markChatRead } = markRead
  useEffect(() => {
    if (document.visibilityState === 'visible') markChatRead(chatId)
  }, [chatId, lastId, markChatRead])

  // при первом открытии прокручиваем к первому непрочитанному, дальше держим ленту внизу
  const firstScroll = useRef(true)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !list.length) return
    if (firstScroll.current && unreadFrom !== undefined) {
      firstScroll.current = false
      const target = unreadFrom ? document.getElementById(`msg-${unreadFrom}`) : null
      if (target) {
        el.scrollTop = target.offsetTop - 80
        stick.current = false
      } else el.scrollTop = el.scrollHeight
      seen.current = list.length
      return
    }
    if (stick.current) {
      el.scrollTop = el.scrollHeight
      seen.current = list.length
      setBelow(0)
    } else if (list.length > seen.current) setBelow(list.length - seen.current)
  }, [lastId, list.length, unreadFrom])

  const toBottom = () => {
    const el = scroller.current
    if (!el) return
    stick.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    seen.current = list.length
    setBelow(0)
  }

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return toast(t('msg.notLoaded'))
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(id)
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600)
  }, [t])

  // поиск по сообщениям чата
  const needle = query.trim().toLowerCase()
  const hits = useMemo(() => (needle.length >= 2 ? list.filter((m) => m.body.toLowerCase().includes(needle)).map((m) => m.id) : []), [list, needle])
  useEffect(() => {
    setHit(hits.length ? hits.length - 1 : 0)
  }, [needle, hits.length])
  useEffect(() => {
    if (hits[hit]) jumpTo(hits[hit])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit, hits.join()])

  const readState = (m: ChatMessage): 'sent' | 'read' | null => {
    if (m.author_id !== me?.id || kind === 'channel' || kind === 'saved') return null
    return others.some((o) => o.last_read_at >= m.created_at) ? 'read' : 'sent'
  }

  const actions: BubbleActions = useMemo(
    () => ({
      onReply: canPost
        ? (m) => {
            setEditing(null)
            setReplyTo(m)
            composer.current?.focus()
          }
        : undefined,
      onForward: (m) => setForwarding(m),
      onEdit: (m) => {
        setReplyTo(null)
        setEditing(m)
      },
      onDelete: (m) => setDeleting(m),
      onPin: canPin ? (m, on) => pin.mutate({ chatId, id: on ? m.id : null }, { onError: (e) => toast.error((e as Error).message) }) : undefined,
      onJump: jumpTo,
      onOpenMedia: (items, index) => setViewer({ items, index }),
    }),
    [canPost, canPin, chatId, jumpTo, pin],
  )

  const namesOf = (ids: string[]) => ids.map((id) => nameOf(id, false)).join(', ')

  const panel = (
    <ChatInfoPanel
      chatId={chatId}
      chat={chat}
      info={info.data}
      members={members.data ?? []}
      messages={list}
      onClose={() => setInfoOpen(false)}
      onOpenMedia={(items, index) => setViewer({ items, index })}
      onLeft={() => {
        setInfoOpen(false)
        onLeft()
      }}
    />
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragEnter={(e) => {
          if (canPost && e.dataTransfer.types.includes('Files')) setDragging(true)
        }}
        onDragOver={(e) => {
          if (canPost && e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (canPost) composer.current?.addFiles([...e.dataTransfer.files])
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-2 py-2.5 sm:px-3">
          <button type="button" onClick={onBack} className="rounded-lg p-2 text-muted hover:bg-canvas lg:hidden" aria-label={t('chat.back')}>
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => setInfoOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-0.5 text-left hover:bg-canvas/60" data-testid="chat-header">
            <ChatAvatar chat={{ kind, title, peer_id: peer?.id ?? chat?.peer_id, avatar: info.data?.avatar ?? chat?.avatar }} size={40} />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink" data-testid="chat-title">
                {title}
              </span>
              <span className={cn('block truncate text-xs', typing.length ? 'font-medium text-brand-600' : 'text-muted')}>{subtitle}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen((v) => !v)
              setQuery('')
            }}
            className={cn('rounded-lg p-2 transition hover:bg-canvas', searchOpen ? 'text-brand-700' : 'text-muted')}
            aria-label={t('msg.searchInChat')}
            title={t('msg.searchInChat')}
            data-testid="chat-search-toggle"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setInfoOpen((v) => !v)}
            className={cn('rounded-lg p-2 transition hover:bg-canvas', infoOpen ? 'text-brand-700' : 'text-muted')}
            aria-label={t('msg.info')}
            title={t('msg.info')}
            data-testid="chat-info-toggle"
          >
            <Info className="h-5 w-5" />
          </button>
        </header>

        {searchOpen && (
          <div className="flex animate-fade-in items-center gap-2 border-b border-line bg-white px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              placeholder={t('msg.searchInChat')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hits.length) setHit((h) => (h - 1 + hits.length) % hits.length)
                if (e.key === 'Escape') setSearchOpen(false)
              }}
              data-testid="chat-search"
            />
            <span className="shrink-0 text-xs text-muted tabular-nums">{needle.length >= 2 ? (hits.length ? t('msg.ofN', { n: hit + 1, total: hits.length }) : t('msg.notFound')) : ''}</span>
            <button type="button" disabled={!hits.length} onClick={() => setHit((h) => (h - 1 + hits.length) % hits.length)} className="rounded p-1 text-muted hover:bg-canvas disabled:opacity-30" aria-label={t('msg.prev')}>
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" disabled={!hits.length} onClick={() => setHit((h) => (h + 1) % hits.length)} className="rounded p-1 text-muted hover:bg-canvas disabled:opacity-30" aria-label={t('msg.next')}>
              <ChevronDown className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setSearchOpen(false)} className="rounded p-1 text-muted hover:bg-canvas" aria-label={t('common.close')}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {pinned && (
          <div className="flex animate-fade-in items-center gap-2 border-b border-line bg-white px-3 py-2" data-testid="chat-pinned-bar">
            <button type="button" onClick={() => jumpTo(pinned.id)} className="flex min-w-0 flex-1 items-center gap-2.5 border-l-2 border-brand-500 pl-2.5 text-left">
              <Pin className="h-4 w-4 shrink-0 text-brand-600" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-brand-700">{t('msg.pinnedMessage')}</span>
                <span className="block truncate text-sm text-ink-soft">{quotePreview(pinned, t)}</span>
              </span>
            </button>
            {canPin && (
              <button
                type="button"
                onClick={() => pin.mutate({ chatId, id: null }, { onError: (e) => toast.error((e as Error).message) })}
                className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink"
                aria-label={t('msg.unpin')}
                title={t('msg.unpin')}
                data-testid="chat-unpin"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <div
          ref={scroller}
          onScroll={() => {
            const el = scroller.current
            if (!el) return
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 100
            stick.current = near
            setAtBottom(near)
            if (near) {
              seen.current = list.length
              setBelow(0)
            }
          }}
          className="chat-wallpaper scrollbar-thin relative min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
          data-testid="chat-messages"
        >
          {messages.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="ml-auto h-12 w-1/2" />
              <Skeleton className="h-24 w-1/2" />
            </div>
          )}
          {!messages.isLoading && list.length === 0 && (
            <div className="grid h-full place-items-center">
              <p className="max-w-xs rounded-2xl bg-white/80 px-4 py-3 text-center text-sm text-muted ring-1 ring-line">
                {kind === 'saved' ? t('msg.savedEmpty') : t('chat.noMessages')}
              </p>
            </div>
          )}
          {days.map((day) => (
            <div key={day.key}>
              <div className="my-3 flex justify-center">
                <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-muted shadow-sm ring-1 ring-line backdrop-blur">
                  {isSameDay(day.date, new Date())
                    ? t('chat.today')
                    : isSameDay(day.date, new Date(Date.now() - 86_400_000))
                      ? t('chat.yesterday')
                      : fmtDate(day.date, day.date.getFullYear() === new Date().getFullYear() ? 'd MMMM' : 'd MMMM yyyy')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {day.items.map((m, i) => {
                  const divider =
                    unreadFrom === m.id ? (
                      <li key={`unread-${m.id}`} className="my-3 flex items-center gap-3 text-xs font-semibold text-brand-700" data-testid="chat-unread-divider">
                        <span className="h-px flex-1 bg-brand-200" />
                        {t('msg.newMessages')}
                        <span className="h-px flex-1 bg-brand-200" />
                      </li>
                    ) : null
                  if (m.kind === 'system') {
                    const text = eventText(t, m.meta, nameOf(m.author_id, false), namesOf, kind)
                    return [
                      divider,
                      <li key={m.id} id={`msg-${m.id}`} className="my-2 flex justify-center" data-testid="chat-system">
                        <button
                          type="button"
                          onClick={() => m.meta?.message && jumpTo(m.meta.message)}
                          className="max-w-[85%] rounded-full bg-white/85 px-3 py-1 text-center text-xs text-ink-soft shadow-sm ring-1 ring-line"
                        >
                          {text}
                        </button>
                      </li>,
                    ]
                  }
                  const mine = m.author_id === me?.id
                  const prev = day.items[i - 1]
                  const next = day.items[i + 1]
                  const firstOfRun = !prev || prev.author_id !== m.author_id || prev.kind === 'system'
                  const lastOfRun = !next || next.author_id !== m.author_id || next.kind === 'system'
                  const groupStyle = kind === 'group' && !mine
                  return [
                    divider,
                    <MessageBubble
                      key={m.id}
                      m={m}
                      mine={mine}
                      showAuthor={(groupStyle || (kind === 'channel' && !mine)) && firstOfRun}
                      showAvatar={groupStyle ? lastOfRun : null}
                      quoted={m.reply_to ? (byMsg.get(m.reply_to) ?? null) : undefined}
                      read={readState(m)}
                      pollState={pollById.get(m.id)}
                      canPin={canPin}
                      pinned={pinnedId === m.id}
                      canDelete={mine || (isGroup && isAdmin)}
                      canClosePoll={mine || isAdmin}
                      canReply={canPost}
                      flash={flash === m.id}
                      highlight={needle.length >= 2 ? query : undefined}
                      nameOf={(id) => nameOf(id)}
                      people={people}
                      actions={actions}
                    />,
                  ]
                })}
              </ul>
            </div>
          ))}
        </div>

        {!atBottom && list.length > 0 && (
          <button
            type="button"
            onClick={toBottom}
            className="absolute right-5 bottom-28 z-20 grid h-11 w-11 animate-pop place-items-center rounded-full bg-white text-brand-700 shadow-[var(--shadow-pop)] ring-1 ring-line hover:bg-brand-50"
            aria-label={t('msg.toBottom')}
            data-testid="chat-to-bottom"
          >
            <ArrowDown className="h-5 w-5" />
            {below > 0 && <span className="absolute -top-1.5 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">{below}</span>}
          </button>
        )}

        <Composer
          key={chatId}
          ref={composer}
          chatId={chatId}
          chatKind={kind}
          canPost={canPost}
          muted={Boolean(chat?.muted)}
          people={mentionPeople}
          nameOf={(id) => nameOf(id)}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSent={() => {
            stick.current = true
            window.setTimeout(toBottom, 50)
          }}
          onTyping={notify}
        />

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-30 grid animate-fade-in place-items-center rounded-2xl border-2 border-dashed border-brand-400 bg-brand-50/90">
            <div className="text-center text-brand-700">
              <Upload className="mx-auto h-8 w-8" />
              <div className="mt-2 font-semibold">{t('msg.dropHere')}</div>
            </div>
          </div>
        )}
      </section>

      {infoOpen && wide && <aside className="w-[340px] shrink-0 animate-slide-in border-l border-line">{panel}</aside>}
      {!wide && (
        <Drawer open={infoOpen} onClose={() => setInfoOpen(false)} title={t('msg.info')} width="max-w-md">
          <div className="-mx-6 -my-5 h-[calc(100dvh-5rem)]">{panel}</div>
        </Drawer>
      )}

      {viewer && <Lightbox items={viewer.items} start={viewer.index} onClose={() => setViewer(null)} />}
      <ForwardModal message={forwarding} onClose={() => setForwarding(null)} />
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('msg.deleteTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={del.isPending}
              onClick={() =>
                deleting &&
                del.mutate(
                  { id: deleting.id, chatId },
                  {
                    onSuccess: () => setDeleting(null),
                    onError: (e) => toast.error((e as Error).message),
                  },
                )
              }
              data-testid="delete-confirm"
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">{deleting && deleting.author_id !== me?.id ? t('msg.deleteOther', { name: nameOf(deleting.author_id, false) }) : t('msg.deleteText')}</p>
        {deleting && <p className="mt-2 line-clamp-3 rounded-xl bg-canvas px-3 py-2 text-sm text-muted">{quotePreview(deleting, t)}</p>}
      </Modal>
    </div>
  )
}
