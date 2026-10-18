import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  BarChart3,
  BellOff,
  Bookmark,
  ContactRound,
  FileText,
  Forward,
  Image as ImageIcon,
  Megaphone,
  MessageCircle,
  Mic,
  Pin,
  PinOff,
  Plus,
  Search,
  Bell,
  Video,
} from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { useChats, useOpenSavedChat, useSetChatPrefs } from '@/lib/chat'
import { fmtDate, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button, Empty, ErrorBox, Skeleton } from '@/components/ui'
import type { ChatListItem } from '@/lib/types'
import { Conversation } from '@/components/chat/Conversation'
import { NewChatModal } from '@/components/chat/NewChatModal'
import { ChatAvatar, FloatingMenu, MenuButton, eventText, useChatTitle } from '@/components/chat/shared'

type Filter = 'all' | 'unread' | 'direct' | 'group' | 'channel'

function isToday(d: Date) {
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

/** Время в списке чатов: сегодня часы, раньше дата */
function listTime(iso: string) {
  const d = new Date(iso)
  return isToday(d) ? fmtTime(iso) : fmtDate(d, 'dd.MM')
}

const ATTACH_ICON = { image: ImageIcon, video: Video, file: FileText, voice: Mic, contact: ContactRound } as const

export default function MessagesPage() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const chatId = params.get('chat')
  const chats = useChats()
  const saved = useOpenSavedChat()
  const title = useChatTitle()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [newOpen, setNewOpen] = useState(false)
  const openChat = (id: string | null) => setParams(id ? { chat: id } : {})
  const needle = query.trim().toLowerCase()
  const all = chats.data ?? []
  const counts: Record<Filter, number> = {
    all: all.length,
    unread: all.filter((c) => c.unread > 0).length,
    direct: all.filter((c) => c.kind === 'direct').length,
    group: all.filter((c) => c.kind === 'group').length,
    channel: all.filter((c) => c.kind === 'channel').length,
  }
  const list = all.filter(
    (c) =>
      (filter === 'all' || (filter === 'unread' ? c.unread > 0 : c.kind === filter)) &&
      (!needle || title(c).toLowerCase().includes(needle) || (c.last_body ?? '').toLowerCase().includes(needle)),
  )
  const active = all.find((c) => c.id === chatId)
  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: t('msg.filter.all') },
    { value: 'unread', label: t('msg.filter.unread') },
    { value: 'direct', label: t('msg.filter.direct') },
    { value: 'group', label: t('msg.filter.group') },
    { value: 'channel', label: t('msg.filter.channel') },
  ]

  return (
    <div className="card flex h-[calc(100dvh-12.5rem)] min-h-[460px] overflow-hidden lg:h-[calc(100dvh-8.5rem)]" data-testid="messages-page">
      <aside className={cn('w-full min-w-0 flex-col lg:flex lg:w-[340px] lg:shrink-0 lg:border-r lg:border-line', chatId ? 'hidden' : 'flex')}>
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
          <h1 className="text-xl font-bold tracking-tight text-ink">{t('nav.messages')}</h1>
          <div className="flex items-center gap-1.5">
            <Button
              size="icon"
              variant="ghost"
              icon={<Bookmark className="h-[18px] w-[18px]" />}
              loading={saved.isPending}
              onClick={() => saved.mutate(undefined, { onSuccess: (id) => openChat(id), onError: (e) => toast.error((e as Error).message) })}
              aria-label={t('msg.saved')}
              title={t('msg.saved')}
              data-testid="chat-saved"
            />
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)} data-testid="chat-new">
              {t('chat.new')}
            </Button>
          </div>
        </div>
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="field pl-9" placeholder={t('chat.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('chat.search')} />
          </div>
        </div>
        <div className="scrollbar-thin flex gap-1.5 overflow-x-auto px-4 pb-2.5" role="tablist">
          {filters.map((f) =>
            f.value !== 'all' && f.value !== 'unread' && counts[f.value] === 0 ? null : (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 transition active:scale-95',
                  filter === f.value ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-soft ring-line hover:ring-brand-300',
                )}
                data-testid={`chat-filter-${f.value}`}
              >
                {f.label}
                {counts[f.value] > 0 && f.value !== 'all' && (
                  <span className={cn('rounded-full px-1.5 text-xs', filter === f.value ? 'bg-white/25' : 'bg-canvas text-muted')}>{counts[f.value]}</span>
                )}
              </button>
            ),
          )}
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-2">
          {chats.isLoading && (
            <div className="space-y-2 px-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          )}
          {chats.error && (
            <div className="px-4">
              <ErrorBox error={chats.error} onRetry={() => void chats.refetch()} />
            </div>
          )}
          {!chats.isLoading && !chats.error && list.length === 0 && (
            <Empty icon={<MessageCircle className="h-6 w-6" />} title={all.length ? t('msg.noMatches') : t('chat.empty')} text={all.length ? undefined : t('chat.emptyText')} />
          )}
          <ul>
            {list.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === chatId} onOpen={() => openChat(c.id)} />
            ))}
          </ul>
        </div>
      </aside>
      <div className={cn('min-w-0 flex-1', chatId ? 'flex' : 'hidden lg:flex')}>
        {chatId ? (
          <Conversation key={chatId} chatId={chatId} chat={active} onBack={() => openChat(null)} onLeft={() => openChat(null)} />
        ) : (
          <div className="chat-wallpaper grid flex-1 place-items-center">
            <div className="rounded-3xl bg-white/85 px-6 py-5 text-center shadow-sm ring-1 ring-line">
              <MessageCircle className="mx-auto h-8 w-8 text-brand-600" />
              <p className="mt-2 font-semibold text-ink">{t('chat.pick')}</p>
              <p className="mt-1 max-w-xs text-sm text-muted">{t('msg.pickHint')}</p>
            </div>
          </div>
        )}
      </div>
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

function ChatRow({ chat, active, onOpen }: { chat: ChatListItem; active: boolean; onOpen: () => void }) {
  const { me } = useAuth()
  const { t } = useI18n()
  const title = useChatTitle()
  const prefs = useSetChatPrefs()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const name = title(chat)
  const firstName = (full: string | null) => (full ?? '').split(' ')[0]

  let preview: string
  let Icon: typeof ImageIcon | null = null
  if (!chat.last_kind) preview = t('chat.noMessages')
  else if (chat.last_kind === 'system')
    preview = eventText(t, chat.last_meta, chat.last_author_name ?? '', () => '…', chat.kind)
  else if (chat.last_kind === 'poll') {
    Icon = BarChart3
    preview = `${t('msg.kind.poll')}: ${chat.last_body ?? ''}`
  } else if (chat.last_attachment) {
    Icon = ATTACH_ICON[chat.last_attachment]
    const label =
      chat.last_attachments > 1 && (chat.last_attachment === 'image' || chat.last_attachment === 'video')
        ? t('msg.kind.album', { n: chat.last_attachments })
        : t(`msg.kind.${chat.last_attachment}` as I18nKey)
    preview = chat.last_body ? chat.last_body : label
  } else preview = chat.last_body ?? ''
  const prefix =
    chat.last_kind && chat.last_kind !== 'system' && chat.kind !== 'channel' && chat.kind !== 'saved'
      ? chat.last_author_id === me?.id
        ? `${t('chat.you')}: `
        : chat.kind === 'group' && chat.last_author_name
          ? `${firstName(chat.last_author_name)}: `
          : ''
      : ''

  return (
    <li
      onContextMenu={(e) => {
        if (chat.kind === 'saved') return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left transition', active ? 'bg-brand-50' : 'hover:bg-canvas')}
        data-testid="chat-row"
      >
        <ChatAvatar chat={chat} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn('flex min-w-0 items-center gap-1 text-[15px] text-ink', chat.unread ? 'font-bold' : 'font-semibold')}>
              {chat.kind === 'channel' && <Megaphone className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
              <span className="truncate">{name}</span>
              {chat.muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-muted" aria-label={t('msg.muted')} />}
            </span>
            <span className={cn('shrink-0 text-xs tabular-nums', chat.unread && !chat.muted ? 'font-semibold text-brand-700' : 'text-muted')}>{listTime(chat.last_at)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className={cn('flex min-w-0 items-center gap-1 text-sm', chat.last_kind === 'system' ? 'text-muted italic' : 'text-muted')}>
              {prefix && <span className="shrink-0 text-ink-soft">{prefix}</span>}
              {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-brand-600" />}
              <span className="truncate">{preview}</span>
            </span>
            {chat.unread > 0 ? (
              <span
                className={cn(
                  'grid h-5 min-w-5 shrink-0 animate-bump place-items-center rounded-full px-1.5 text-[11px] font-bold text-white',
                  chat.muted ? 'bg-slate-400' : 'bg-brand-600',
                )}
              >
                {chat.unread}
              </span>
            ) : (
              chat.pinned && <Pin className="h-3.5 w-3.5 shrink-0 rotate-45 text-muted" aria-label={t('msg.pinnedChat')} />
            )}
          </div>
        </div>
      </button>
      {menu && (
        <FloatingMenu at={menu} onClose={() => setMenu(null)} width={220}>
          <MenuButton icon={chat.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />} onClick={() => (setMenu(null), prefs.mutate({ chatId: chat.id, pinned: !chat.pinned }))}>
            {chat.pinned ? t('msg.unpinChat') : t('msg.pinChat')}
          </MenuButton>
          <MenuButton icon={chat.muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} onClick={() => (setMenu(null), prefs.mutate({ chatId: chat.id, muted: !chat.muted }))}>
            {chat.muted ? t('msg.unmute') : t('msg.mute')}
          </MenuButton>
          <MenuButton icon={<Forward className="h-4 w-4 -scale-x-100" />} onClick={() => (setMenu(null), onOpen())}>
            {t('msg.openChat')}
          </MenuButton>
        </FloatingMenu>
      )}
    </li>
  )
}
