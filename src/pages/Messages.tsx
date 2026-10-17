import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, CornerUpLeft, MessageCircle, Plus, Search, SendHorizontal, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useEmployeesLite } from '@/lib/api'
import { useChatMembers, useChatMessages, useChats, useCreateGroupChat, useMarkChatRead, useOpenDirectChat, useSendMessage } from '@/lib/chat'
import { fmtDate, fmtTime, fullName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar, Button, Empty, ErrorBox, Field, Modal, Skeleton } from '@/components/ui'
import type { ChatListItem, ChatMessage } from '@/lib/types'

/* ---------- Время ---------- */

// названия месяцев и порядок даты берутся из словаря языка: данные локалей есть не во всех браузерах
const clock = (iso: string) => fmtTime(iso)

function dayName(d: Date) {
  return fmtDate(d, d.getFullYear() === new Date().getFullYear() ? 'd MMMM' : 'd MMMM yyyy')
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Время в списке чатов: сегодня часы, раньше дата */
function listTime(iso: string) {
  const d = new Date(iso)
  return isSameDay(d, new Date()) ? clock(iso) : fmtDate(d, 'dd.MM')
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

/* ---------- Страница ---------- */

export default function MessagesPage() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const chatId = params.get('chat')
  const chats = useChats()
  const [query, setQuery] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const openChat = (id: string | null) => setParams(id ? { chat: id } : {})
  const needle = query.trim().toLowerCase()
  const list = (chats.data ?? []).filter((c) => !needle || (c.title ?? '').toLowerCase().includes(needle))
  const active = chats.data?.find((c) => c.id === chatId)

  return (
    <div className="card flex h-[calc(100dvh-12.5rem)] min-h-[440px] overflow-hidden lg:h-[calc(100dvh-8.5rem)]" data-testid="messages-page">
      <aside className={cn('w-full min-w-0 flex-col lg:flex lg:w-[340px] lg:shrink-0 lg:border-r lg:border-line', chatId ? 'hidden' : 'flex')}>
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
          <h1 className="text-xl font-bold tracking-tight text-ink">{t('nav.messages')}</h1>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)} data-testid="chat-new">
            {t('chat.new')}
          </Button>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="field pl-9" placeholder={t('chat.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('chat.search')} />
          </div>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-2">
          {chats.isLoading && (
            <div className="space-y-2 px-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          )}
          {chats.error && (
            <div className="px-4">
              <ErrorBox error={chats.error} onRetry={() => void chats.refetch()} />
            </div>
          )}
          {!chats.isLoading && !chats.error && list.length === 0 && <Empty icon={<MessageCircle className="h-6 w-6" />} title={t('chat.empty')} text={t('chat.emptyText')} />}
          <ul>
            {list.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === chatId} onOpen={() => openChat(c.id)} />
            ))}
          </ul>
        </div>
      </aside>
      <section className={cn('min-w-0 flex-1 flex-col', chatId ? 'flex' : 'hidden lg:flex')}>
        {chatId ? (
          <Conversation key={chatId} chatId={chatId} chat={active} onBack={() => openChat(null)} />
        ) : (
          <div className="grid flex-1 place-items-center bg-canvas/50">
            <Empty icon={<MessageCircle className="h-6 w-6" />} title={t('chat.pick')} />
          </div>
        )}
      </section>
      <NewChatModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onOpened={(id) => {
          setNewOpen(false)
          openChat(id)
        }}
      />
    </div>
  )
}

function GroupIcon({ size }: { size: number }) {
  return (
    <div className="grid shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700" style={{ width: size, height: size }} aria-hidden>
      <Users style={{ width: size * 0.45, height: size * 0.45 }} />
    </div>
  )
}

function ChatRow({ chat, active, onOpen }: { chat: ChatListItem; active: boolean; onOpen: () => void }) {
  const { me } = useAuth()
  const { t } = useI18n()
  const prefix = !chat.last_body
    ? ''
    : chat.last_author_id === me?.id
      ? `${t('chat.you')}: `
      : chat.kind === 'group' && chat.last_author_name
        ? `${chat.last_author_name.split(' ')[0]}: `
        : ''
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition', active ? 'bg-brand-50' : 'hover:bg-canvas')}
        data-testid="chat-row"
      >
        {chat.kind === 'group' ? <GroupIcon size={44} /> : <Avatar id={chat.peer_id} name={chat.title ?? ''} size={44} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-[15px] text-ink', chat.unread ? 'font-bold' : 'font-semibold')}>{chat.title}</span>
            <span className={cn('shrink-0 text-xs tabular-nums', chat.unread ? 'font-semibold text-brand-700' : 'text-muted')}>{listTime(chat.last_at)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-sm text-muted">
              {prefix}
              {chat.last_body ?? t('chat.noMessages')}
            </span>
            {chat.unread > 0 && (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">{chat.unread}</span>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

function ReplyButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-1 shrink-0 rounded-full p-1.5 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-white hover:text-brand-700 focus:opacity-100 [@media(hover:none)]:opacity-70"
      aria-label={label}
      title={label}
      data-testid="chat-reply"
    >
      <CornerUpLeft className="h-4 w-4" />
    </button>
  )
}

/* ---------- Переписка ---------- */

function Conversation({ chatId, chat, onBack }: { chatId: string; chat?: ChatListItem; onBack: () => void }) {
  const { me } = useAuth()
  const { t } = useI18n()
  const messages = useChatMessages(chatId)
  const members = useChatMembers(chatId)
  const send = useSendMessage()
  const markRead = useMarkChatRead()
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)

  const list = useMemo(() => messages.data ?? [], [messages.data])
  const people = useMemo(() => new Map((members.data ?? []).map((m) => [m.employee_id, m.employee])), [members.data])
  const byId = useMemo(() => new Map(list.map((m) => [m.id, m])), [list])
  const days = useMemo(() => groupByDay(list), [list])
  const isGroup = chat ? chat.kind === 'group' : (members.data?.length ?? 0) > 2
  const peer = isGroup ? null : (members.data ?? []).find((m) => m.employee_id !== me?.id)?.employee ?? null
  const title = chat?.title ?? (peer ? fullName(peer) : '')
  const subtitle = isGroup
    ? t('chat.members', { n: members.data?.length ?? chat?.member_count ?? 0 })
    : (peer?.position ?? '')
  const nameOf = (id: string) => (id === me?.id ? t('chat.you') : fullName(people.get(id) ?? undefined))

  // открытый чат считается прочитанным, в том числе когда приходят новые сообщения
  const lastId = list[list.length - 1]?.id
  const { mutate: markChatRead } = markRead
  useEffect(() => {
    markChatRead(chatId)
  }, [chatId, lastId, markChatRead])

  // держим ленту внизу, если пользователь не прокрутил её вверх
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lastId, list.length])

  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])

  const submit = () => {
    const body = text.trim()
    if (!body || send.isPending) return
    const reply = replyTo
    setText('')
    setReplyTo(null)
    stick.current = true
    send.mutate(
      { chatId, body, replyTo: reply?.id },
      {
        onError: (e) => {
          setText(body)
          setReplyTo(reply)
          toast.error((e as Error).message)
        },
      },
    )
  }

  const jumpTo = (id: string) => {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(id)
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600)
  }

  const startReply = (m: ChatMessage) => {
    setReplyTo(m)
    textarea.current?.focus()
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-4">
        <button type="button" onClick={onBack} className="rounded-lg p-2 text-muted hover:bg-canvas lg:hidden" aria-label={t('chat.back')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        {isGroup ? <GroupIcon size={40} /> : <Avatar id={peer?.id} name={title} size={40} />}
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink" data-testid="chat-title">
            {title}
          </div>
          {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current
          if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-canvas/60 px-3 py-4 sm:px-5"
        data-testid="chat-messages"
      >
        {messages.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-1/2" />
          </div>
        )}
        {!messages.isLoading && list.length === 0 && <p className="py-10 text-center text-sm text-muted">{t('chat.noMessages')}</p>}
        {days.map((day) => (
          <div key={day.key}>
            <div className="my-3 flex justify-center">
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-muted ring-1 ring-line">
                {isSameDay(day.date, new Date())
                  ? t('chat.today')
                  : isSameDay(day.date, new Date(Date.now() - 86_400_000))
                    ? t('chat.yesterday')
                    : dayName(day.date)}
              </span>
            </div>
            <ul className="space-y-1.5">
              {day.items.map((m, i) => {
                const mine = m.author_id === me?.id
                const prev = day.items[i - 1]
                const firstOfRun = !prev || prev.author_id !== m.author_id
                const showAuthor = isGroup && !mine && firstOfRun
                const quoted = m.reply_to ? byId.get(m.reply_to) : undefined
                return (
                  <li key={m.id} id={`msg-${m.id}`} className={cn('group flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
                    {isGroup && !mine && (showAuthor ? <Avatar id={m.author_id} name={nameOf(m.author_id)} size={28} /> : <span className="w-7 shrink-0" />)}
                    {mine && <ReplyButton onClick={() => startReply(m)} label={t('chat.reply')} />}
                    <div
                      className={cn(
                        'max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug shadow-sm transition sm:max-w-[70%]',
                        mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-white text-ink ring-1 ring-line',
                        flash === m.id && 'ring-4 ring-amber-300',
                      )}
                      data-testid={mine ? 'chat-bubble-mine' : 'chat-bubble'}
                    >
                      {showAuthor && <div className="mb-0.5 text-xs font-semibold text-brand-700">{nameOf(m.author_id)}</div>}
                      {m.reply_to && (
                        <button
                          type="button"
                          onClick={() => m.reply_to && jumpTo(m.reply_to)}
                          className={cn(
                            'mb-1 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs',
                            mine ? 'border-white/70 bg-white/15 text-white/90' : 'border-brand-500 bg-brand-50 text-ink-soft',
                          )}
                        >
                          <span className="block font-semibold">{quoted ? nameOf(quoted.author_id) : '…'}</span>
                          <span className="line-clamp-2 block">{quoted?.body ?? ''}</span>
                        </button>
                      )}
                      <p className="break-words whitespace-pre-wrap">{m.body}</p>
                      <div className={cn('mt-0.5 text-right text-[11px] tabular-nums', mine ? 'text-white/70' : 'text-muted')}>{clock(m.created_at)}</div>
                    </div>
                    {!mine && <ReplyButton onClick={() => startReply(m)} label={t('chat.reply')} />}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <footer className="border-t border-line bg-white px-3 py-3 sm:px-4">
        {replyTo && (
          <div className="mb-2 flex items-start gap-2 rounded-xl bg-canvas px-3 py-2" data-testid="chat-reply-preview">
            <CornerUpLeft className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold text-brand-700">
                {t('chat.replying')} · {nameOf(replyTo.author_id)}
              </div>
              <div className="truncate text-muted">{replyTo.body}</div>
            </div>
            <button type="button" onClick={() => setReplyTo(null)} className="rounded-lg p-1 text-muted hover:bg-white hover:text-ink" aria-label={t('chat.cancelReply')}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={textarea}
            rows={1}
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            className="field max-h-[140px] min-h-[44px] flex-1 resize-none"
            data-testid="chat-input"
          />
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11"
            icon={<SendHorizontal className="h-5 w-5" />}
            loading={send.isPending}
            disabled={!text.trim()}
            aria-label={t('chat.send')}
            title={t('chat.send')}
            data-testid="chat-send"
          />
        </form>
        <p className="mt-1.5 hidden text-[11px] text-muted sm:block">{t('chat.sendHint')}</p>
      </footer>
    </>
  )
}

/* ---------- Новый чат ---------- */

function NewChatModal({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (chatId: string) => void }) {
  const { me } = useAuth()
  const { t } = useI18n()
  const people = useEmployeesLite()
  const openDirect = useOpenDirectChat()
  const createGroup = useCreateGroupChat()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState('')

  useEffect(() => {
    if (!open) return
    setQ('')
    setPicked([])
    setTitle('')
  }, [open])

  const all = (people.data ?? []).filter((p) => p.id !== me?.id)
  const byId = new Map(all.map((p) => [p.id, p]))
  const needle = q.trim().toLowerCase()
  const shown = needle ? all.filter((p) => `${p.last_name} ${p.first_name} ${p.position}`.toLowerCase().includes(needle)) : all
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const defaultTitle =
    picked
      .slice(0, 3)
      .map((id) => byId.get(id)?.first_name)
      .filter(Boolean)
      .join(', ') + (picked.length > 3 ? '…' : '')
  const busy = openDirect.isPending || createGroup.isPending
  const onError = (e: unknown) => toast.error((e as Error).message)

  const start = () => {
    if (picked.length === 1) openDirect.mutate(picked[0], { onSuccess: onOpened, onError })
    else if (picked.length > 1) createGroup.mutate({ title: title.trim() || defaultTitle, members: picked }, { onSuccess: onOpened, onError })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('chat.new')}
      subtitle={t('chat.newHint')}
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">{picked.length > 0 && t('chat.selected', { n: picked.length })}</span>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!picked.length} loading={busy} onClick={start} data-testid="chat-start">
            {picked.length > 1 ? t('chat.createGroup') : t('chat.write')}
          </Button>
        </>
      }
    >
      {picked.length > 1 && (
        <Field label={t('chat.groupName')} className="mb-3">
          <input className="field" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle} data-testid="chat-group-title" />
        </Field>
      )}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        <input className="field pl-9" placeholder={t('chat.findPeople')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('chat.findPeople')} data-testid="chat-people-search" />
      </div>
      {people.isLoading && <Skeleton className="h-40" />}
      <ul className="-mx-2 max-h-[46dvh] overflow-y-auto">
        {shown.map((p) => {
          const on = picked.includes(p.id)
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition', on ? 'bg-brand-50' : 'hover:bg-canvas')}
                aria-pressed={on}
                data-testid="chat-person"
              >
                <Avatar id={p.id} name={fullName(p)} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{fullName(p, true)}</span>
                  <span className="block truncate text-xs text-muted">{p.position}</span>
                </span>
                <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-md border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line')}>
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
              </button>
            </li>
          )
        })}
        {!people.isLoading && shown.length === 0 && <li className="py-6 text-center text-sm text-muted">{t('chat.noPeople')}</li>}
      </ul>
    </Modal>
  )
}
