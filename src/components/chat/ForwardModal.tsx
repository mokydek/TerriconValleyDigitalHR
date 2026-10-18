import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Bookmark, Check, Search } from '@/components/icons'
import { useI18n } from '@/lib/i18n'
import { useChats, useForwardMessages, useOpenSavedChat } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { Button, Field, Modal } from '@/components/ui'
import type { ChatMessage } from '@/lib/types'
import { ChatAvatar, useChatTitle } from './shared'
import { quotePreview } from './MessageBubble'

/** Переслать сообщение: выбрать чат (или «Избранное»), по желанию добавить комментарий */
export function ForwardModal({ message, onClose }: { message: ChatMessage | null; onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const chats = useChats()
  const forward = useForwardMessages()
  const saved = useOpenSavedChat()
  const title = useChatTitle()
  const [q, setQ] = useState('')
  const [to, setTo] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  useEffect(() => {
    setQ('')
    setTo(null)
    setComment('')
  }, [message?.id])
  if (!message) return null

  // в канал пересылать могут только его админы
  const targets = (chats.data ?? []).filter((c) => c.kind !== 'channel' || c.my_role !== 'member')
  const needle = q.trim().toLowerCase()
  const shown = targets.filter((c) => !needle || title(c).toLowerCase().includes(needle))
  const hasSaved = targets.some((c) => c.kind === 'saved')

  const go = (chatId: string) =>
    forward.mutate(
      { ids: [message.id], to: chatId, comment: comment.trim() },
      {
        onSuccess: () => {
          toast.success(t('msg.forwarded'), { action: { label: t('msg.openChat'), onClick: () => navigate(`/messages?chat=${chatId}`) } })
          onClose()
        },
        onError: (e) => toast.error((e as Error).message),
      },
    )

  return (
    <Modal
      open
      onClose={onClose}
      title={t('msg.forwardTitle')}
      subtitle={quotePreview(message, t).slice(0, 120)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!to} loading={forward.isPending} onClick={() => to && go(to)} data-testid="forward-send">
            {t('msg.forward')}
          </Button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        <input className="field pl-9" placeholder={t('chat.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('chat.search')} />
      </div>
      <ul className="scrollbar-thin -mx-2 max-h-[42dvh] overflow-y-auto">
        {!hasSaved && !needle && (
          <li>
            <button
              type="button"
              onClick={() => saved.mutate(undefined, { onSuccess: (id) => go(id), onError: (e) => toast.error((e as Error).message) })}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-canvas"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                <Bookmark className="h-4 w-4" />
              </span>
              <span className="font-medium">{t('msg.saved')}</span>
            </button>
          </li>
        )}
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setTo(c.id)}
              className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition', to === c.id ? 'bg-brand-50' : 'hover:bg-canvas')}
              aria-pressed={to === c.id}
              data-testid="forward-target"
            >
              <ChatAvatar chat={c} size={40} />
              <span className="min-w-0 flex-1 truncate font-medium">{title(c)}</span>
              {to === c.id && <Check className="h-4 w-4 text-brand-600" />}
            </button>
          </li>
        ))}
      </ul>
      <Field label={t('msg.forwardComment')} className="mt-3">
        <input className="field" value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} placeholder={t('msg.forwardCommentHint')} />
      </Field>
    </Modal>
  )
}
