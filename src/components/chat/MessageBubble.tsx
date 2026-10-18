import { memo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, CheckCheck, Copy, CornerUpLeft, Forward, MoreVertical, Pencil, Pin, PinOff, Trash2 } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { useToggleReaction } from '@/lib/chat'
import { tokenize } from '@/lib/chatMedia'
import { fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui'
import type { ChatAttachment, ChatMessage, PollState, ReactionKey } from '@/lib/types'
import { ContactCard, FileCard, MediaAlbum, VoicePlayer } from './attachments'
import { PollCard } from './PollCard'
import { FloatingMenu, MenuButton, REACTIONS, ReactionIcon } from './shared'

export interface BubbleActions {
  onReply?: (m: ChatMessage) => void
  onForward: (m: ChatMessage) => void
  onEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
  onPin?: (m: ChatMessage, pin: boolean) => void
  onJump: (id: string) => void
  onOpenMedia: (items: ChatAttachment[], index: number) => void
}

/** Текст сообщения: ссылки кликабельны, упоминания подсвечены, совпадения поиска выделены */
function RichText({ text, people, mine, highlight }: { text: string; people: { id: string; name: string }[]; mine: boolean; highlight?: string }) {
  const { me } = useAuth()
  const mark = (s: string, key: string): ReactNode => {
    const q = highlight?.trim()
    if (!q) return s
    const parts = s.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'))
    return parts.map((p, i) =>
      i % 2 ? (
        <mark key={`${key}-${i}`} className="rounded bg-amber-200 px-0.5 text-ink">
          {p}
        </mark>
      ) : (
        p
      ),
    )
  }
  return (
    <p className="break-words whitespace-pre-wrap">
      {tokenize(text, people).map((tk, i) =>
        tk.type === 'link' ? (
          <a key={i} href={tk.href} target="_blank" rel="noopener noreferrer" className={cn('underline underline-offset-2', mine ? 'text-white' : 'text-brand-700')}>
            {tk.value}
          </a>
        ) : tk.type === 'mention' ? (
          <span
            key={i}
            className={cn(
              'rounded font-semibold',
              tk.id === me?.id ? (mine ? 'bg-white/25 px-0.5' : 'bg-amber-100 px-0.5 text-amber-800') : mine ? 'text-white underline decoration-white/50' : 'text-brand-700',
            )}
          >
            {tk.value}
          </span>
        ) : (
          <span key={i}>{mark(tk.value, String(i))}</span>
        ),
      )}
    </p>
  )
}

function ReactionChips({ m, mine, nameOf }: { m: ChatMessage; mine: boolean; nameOf: (id: string) => string }) {
  const { me } = useAuth()
  const toggle = useToggleReaction()
  if (!m.reactions.length) return null
  const groups = REACTIONS.map((r) => ({ ...r, who: m.reactions.filter((x) => x.reaction === r.key).map((x) => x.employee_id) })).filter((g) => g.who.length)
  return (
    <div className="mt-1.5 flex flex-wrap gap-1" data-testid="chat-reactions">
      {groups.map((g) => {
        const own = me ? g.who.includes(me.id) : false
        return (
          <button
            key={g.key}
            type="button"
            onClick={() => toggle.mutate({ id: m.id, chatId: m.chat_id, reaction: g.key }, { onError: (e) => toast.error((e as Error).message) })}
            title={g.who.map(nameOf).join(', ')}
            className={cn(
              'inline-flex animate-bump items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 transition active:scale-95',
              mine
                ? own
                  ? 'bg-white text-brand-800 ring-white'
                  : 'bg-white/15 text-white ring-white/30 hover:bg-white/25'
                : own
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : 'bg-canvas text-ink-soft ring-line hover:ring-brand-300',
            )}
            data-testid="reaction-chip"
          >
            <ReactionIcon reaction={g.key} className={cn('h-3.5 w-3.5', ((mine && !own) || (!mine && own)) && 'text-current')} />
            {g.who.length}
          </button>
        )
      })}
    </div>
  )
}

/** Кнопки при наведении: ответить и меню действий (на телефоне — долгое нажатие) */
function HoverActions({ reverse, onMenu, onReply, label, replyLabel }: { reverse: boolean; onMenu: (x: number, y: number) => void; onReply?: () => void; label: string; replyLabel: string }) {
  const cls =
    'shrink-0 rounded-full p-1.5 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-white hover:text-brand-700 focus:opacity-100 [@media(hover:none)]:opacity-60'
  return (
    <div className={cn('mb-1 flex shrink-0 items-center', reverse && 'flex-row-reverse')}>
      {onReply && (
        <button type="button" onClick={onReply} className={cls} aria-label={replyLabel} title={replyLabel} data-testid="chat-reply">
          <CornerUpLeft className="h-4 w-4" />
        </button>
      )}
      <button type="button" onClick={(e) => onMenu(e.clientX, e.clientY)} className={cn(cls, '[@media(hover:none)]:hidden')} aria-label={label} title={label} data-testid="chat-actions">
        <MoreVertical className="h-4 w-4" />
      </button>
    </div>
  )
}

export const MessageBubble = memo(function MessageBubble({
  m,
  mine,
  showAuthor,
  showAvatar,
  quoted,
  read,
  pollState,
  canPin,
  pinned,
  canDelete,
  canClosePoll,
  canReply,
  flash,
  highlight,
  nameOf,
  people,
  actions,
}: {
  m: ChatMessage
  mine: boolean
  showAuthor: boolean
  showAvatar: boolean | null
  quoted?: ChatMessage | null
  read: 'sent' | 'read' | null
  pollState?: PollState
  canPin: boolean
  pinned: boolean
  canDelete: boolean
  canClosePoll: boolean
  canReply: boolean
  flash: boolean
  highlight?: string
  nameOf: (id: string) => string
  people: { id: string; name: string }[]
  actions: BubbleActions
}) {
  const { t } = useI18n()
  const toggle = useToggleReaction()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const press = useRef<number | null>(null)
  const media = m.attachments.filter((a) => a.kind === 'image' || a.kind === 'video')
  const others = m.attachments.filter((a) => a.kind !== 'image' && a.kind !== 'video')
  const mediaOnly = media.length > 0 && !others.length && !m.body && !m.reply_to && !m.forward_author_id && m.kind === 'text'
  const time = (
    <>
      {m.edited_at && <span className="mr-1">{t('msg.edited')}</span>}
      {fmtTime(m.created_at)}
      {read && (read === 'read' ? <CheckCheck className="ml-0.5 inline h-3.5 w-3.5" aria-label={t('msg.read')} /> : <Check className="ml-0.5 inline h-3.5 w-3.5" aria-label={t('msg.sent')} />)}
    </>
  )
  const openMenu = (x: number, y: number) => setMenu({ x, y })
  const react = (r: ReactionKey) => {
    setMenu(null)
    toggle.mutate({ id: m.id, chatId: m.chat_id, reaction: r }, { onError: (e) => toast.error((e as Error).message) })
  }

  return (
    <li
      id={`msg-${m.id}`}
      className={cn('group flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('a,video,audio,input,textarea')) return
        e.preventDefault()
        openMenu(e.clientX, e.clientY)
      }}
      onTouchStart={(e) => {
        const tch = e.touches[0]
        press.current = window.setTimeout(() => openMenu(tch.clientX, tch.clientY), 480)
      }}
      onTouchEnd={() => press.current && window.clearTimeout(press.current)}
      onTouchMove={() => press.current && window.clearTimeout(press.current)}
      data-testid={mine ? 'chat-message-mine' : 'chat-message'}
    >
      {showAvatar !== null && (showAvatar ? <Avatar id={m.author_id} name={nameOf(m.author_id)} size={30} /> : <span className="w-[30px] shrink-0" />)}
      {mine && (
        <HoverActions
          reverse={mine}
          onMenu={(x, y) => openMenu(x, y)}
          onReply={canReply && actions.onReply ? () => actions.onReply!(m) : undefined}
          label={t('msg.actions')}
          replyLabel={t('chat.reply')}
        />
      )}
      <div
        className={cn(
          'relative max-w-[82%] text-[15px] leading-snug shadow-sm transition sm:max-w-[70%]',
          // с фото или видео пузырь шириной с альбом, текст переносится под ним, как в Telegram
          media.length > 0 && 'w-[min(78vw,380px)]',
          mediaOnly ? 'overflow-hidden rounded-2xl' : 'rounded-2xl px-3 py-2',
          !mediaOnly && (mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-white text-ink ring-1 ring-line'),
          flash && 'ring-4 ring-amber-300',
        )}
        data-testid={mine ? 'chat-bubble-mine' : 'chat-bubble'}
      >
        {showAuthor && !mediaOnly && <div className="mb-0.5 text-xs font-semibold text-brand-700">{nameOf(m.author_id)}</div>}
        {m.forward_author_id && (
          <div className={cn('mb-1 flex items-center gap-1 text-xs font-medium', mine ? 'text-white/85' : 'text-brand-700')} data-testid="chat-forwarded">
            <Forward className="h-3.5 w-3.5" />
            {t('msg.forwardedFrom', { name: m.forward_chat_title || nameOf(m.forward_author_id) })}
          </div>
        )}
        {m.reply_to && (
          <button
            type="button"
            onClick={() => quoted && actions.onJump(quoted.id)}
            className={cn(
              'mb-1 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs',
              mine ? 'border-white/70 bg-white/15 text-white/90' : 'border-brand-500 bg-brand-50 text-ink-soft',
            )}
          >
            <span className="block font-semibold">{quoted ? nameOf(quoted.author_id) : t('msg.deleted')}</span>
            <span className="line-clamp-2 block">{quoted ? quotePreview(quoted, t) : ''}</span>
          </button>
        )}
        {media.length > 0 && (
          <div className={cn(!mediaOnly && 'mb-1 -mx-1 overflow-hidden rounded-xl')}>
            <MediaAlbum items={media} onOpen={(i) => actions.onOpenMedia(media, i)} />
          </div>
        )}
        {m.kind === 'poll' && m.poll && <PollCard msg={m} state={pollState} mine={mine} canClose={canClosePoll} nameOf={nameOf} />}
        {others.map((a) =>
          a.kind === 'voice' ? (
            <VoicePlayer key={a.id} a={a} mine={mine} />
          ) : a.kind === 'contact' ? (
            <ContactCard key={a.id} a={a} mine={mine} />
          ) : (
            <FileCard key={a.id} a={a} mine={mine} />
          ),
        )}
        {m.body && m.kind === 'text' && (
          <div className={cn(m.attachments.length > 0 && 'mt-1')}>
            <RichText text={m.body} people={people} mine={mine} highlight={highlight} />
          </div>
        )}
        {mediaOnly ? (
          <>
            {m.reactions.length > 0 && (
              <div className="absolute bottom-1.5 left-1.5">
                <ReactionChips m={m} mine={false} nameOf={nameOf} />
              </div>
            )}
            <span className="absolute right-1.5 bottom-1.5 rounded-full bg-ink/55 px-1.5 py-0.5 text-[11px] text-white tabular-nums">{time}</span>
          </>
        ) : (
          <>
            <ReactionChips m={m} mine={mine} nameOf={nameOf} />
            <div className={cn('mt-0.5 flex items-center justify-end gap-0.5 text-[11px] tabular-nums', mine ? 'text-white/75' : 'text-muted')}>
              {pinned && <Pin className="mr-0.5 h-3 w-3" aria-label={t('msg.pinned')} />}
              {time}
            </div>
          </>
        )}
      </div>
      {!mine && (
        <HoverActions
          reverse={mine}
          onMenu={(x, y) => openMenu(x, y)}
          onReply={canReply && actions.onReply ? () => actions.onReply!(m) : undefined}
          label={t('msg.actions')}
          replyLabel={t('chat.reply')}
        />
      )}
      {menu && (
        <FloatingMenu at={menu} onClose={() => setMenu(null)} width={250}>
          <div className="mb-1 flex justify-between gap-0.5 border-b border-line px-1 pb-1.5" data-testid="reaction-bar">
            {REACTIONS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => react(r.key)}
                className={cn('grid h-9 w-9 place-items-center rounded-full transition hover:scale-125', r.bg)}
                aria-label={t(`msg.reaction.${r.key}` as I18nKey)}
                title={t(`msg.reaction.${r.key}` as I18nKey)}
                data-testid={`react-${r.key}`}
              >
                <ReactionIcon reaction={r.key} className="h-[18px] w-[18px]" />
              </button>
            ))}
          </div>
          {canReply && actions.onReply && (
            <MenuButton icon={<CornerUpLeft className="h-4 w-4" />} onClick={() => (setMenu(null), actions.onReply!(m))} testId="menu-reply">
              {t('chat.reply')}
            </MenuButton>
          )}
          {m.kind === 'text' && (
            <MenuButton icon={<Forward className="h-4 w-4" />} onClick={() => (setMenu(null), actions.onForward(m))} testId="menu-forward">
              {t('msg.forward')}
            </MenuButton>
          )}
          {m.body && m.kind !== 'system' && (
            <MenuButton
              icon={<Copy className="h-4 w-4" />}
              onClick={() => {
                setMenu(null)
                void navigator.clipboard?.writeText(m.body).then(() => toast.success(t('msg.copied')))
              }}
            >
              {t('msg.copy')}
            </MenuButton>
          )}
          {canPin && actions.onPin && (
            <MenuButton icon={pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />} onClick={() => (setMenu(null), actions.onPin!(m, !pinned))} testId="menu-pin">
              {pinned ? t('msg.unpin') : t('msg.pin')}
            </MenuButton>
          )}
          {mine && m.kind === 'text' && (
            <MenuButton icon={<Pencil className="h-4 w-4" />} onClick={() => (setMenu(null), actions.onEdit(m))} testId="menu-edit">
              {t('msg.edit')}
            </MenuButton>
          )}
          {canDelete && (
            <MenuButton danger icon={<Trash2 className="h-4 w-4" />} onClick={() => (setMenu(null), actions.onDelete(m))} testId="menu-delete">
              {t('common.delete')}
            </MenuButton>
          )}
        </FloatingMenu>
      )}
    </li>
  )
})

/** Короткое описание сообщения для цитаты, закрепа и списка чатов */
export function quotePreview(m: Pick<ChatMessage, 'body' | 'kind' | 'attachments' | 'poll'>, t: (k: I18nKey, v?: Record<string, string | number>) => string): string {
  if (m.kind === 'poll') return `${t('msg.kind.poll')}: ${m.poll?.question ?? m.body}`
  if (m.body) return m.body
  const a = m.attachments[0]
  if (!a) return ''
  if (m.attachments.length > 1 && (a.kind === 'image' || a.kind === 'video')) return t('msg.kind.album', { n: m.attachments.length })
  return a.kind === 'file' ? `${t('msg.kind.file')}: ${a.name}` : t(`msg.kind.${a.kind}` as I18nKey)
}
