import { useState } from 'react'
import { toast } from 'sonner'
import { BarChart3, Check, Lock } from '@/components/icons'
import { useI18n } from '@/lib/i18n'
import { useClosePoll, useVotePoll } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui'
import type { ChatMessage, PollState } from '@/lib/types'

/** Опрос как в Telegram: до голоса — варианты, после — проценты, галочка у своего, в открытом опросе видно, кто голосовал */
export function PollCard({
  msg,
  state,
  mine,
  canClose,
  nameOf,
}: {
  msg: ChatMessage
  state?: PollState
  mine: boolean
  canClose: boolean
  nameOf: (id: string) => string
}) {
  const { t } = useI18n()
  const vote = useVotePoll()
  const close = useClosePoll()
  const poll = msg.poll!
  const [picked, setPicked] = useState<number[]>([])
  const voted = (state?.mine.length ?? 0) > 0
  const closed = Boolean(poll.closed_at)
  const showResults = voted || closed
  const total = state?.total ?? 0
  const onError = (e: unknown) => toast.error((e as Error).message)

  const send = (options: number[]) => vote.mutate({ id: msg.id, options }, { onError, onSuccess: () => setPicked([]) })

  return (
    <div className="w-[min(76vw,340px)] max-w-full py-0.5" data-testid="chat-poll">
      <div className="font-semibold leading-snug break-words">{poll.question}</div>
      <div className={cn('mt-0.5 flex items-center gap-1 text-xs', mine ? 'text-white/75' : 'text-muted')}>
        {closed ? <Lock className="h-3 w-3" /> : <BarChart3 className="h-3 w-3" />}
        {closed ? t('msg.pollClosed') : poll.anonymous ? t('msg.pollAnonymous') : t('msg.pollPublic')}
        {poll.multiple && !closed && <> · {t('msg.pollMultiple')}</>}
      </div>
      <ul className="mt-2 space-y-1.5">
        {poll.options.map((o) => {
          const count = state?.counts[String(o.id)] ?? 0
          const pct = total ? Math.round((count / total) * 100) : 0
          const chosen = state?.mine.includes(o.id)
          const voters = state?.voters?.[String(o.id)] ?? []
          if (showResults)
            return (
              <li key={o.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums">{pct}%</span>
                  <span className="min-w-0 flex-1 truncate">{o.text}</span>
                  {chosen && <Check className={cn('h-4 w-4 shrink-0', mine ? 'text-white' : 'text-brand-600')} />}
                  {voters.length > 0 && (
                    <span className="flex -space-x-1.5" title={voters.map(nameOf).join(', ')}>
                      {voters.slice(0, 3).map((id) => (
                        <Avatar key={id} id={id} name={nameOf(id)} size={18} className="ring-2 ring-white" />
                      ))}
                    </span>
                  )}
                </div>
                <div className={cn('mt-1 ml-11 h-1.5 overflow-hidden rounded-full', mine ? 'bg-white/25' : 'bg-brand-50')}>
                  <div className={cn('h-full rounded-full transition-[width] duration-700', mine ? 'bg-white' : 'bg-brand-500')} style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          const on = picked.includes(o.id)
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={vote.isPending}
                onClick={() => (poll.multiple ? setPicked((cur) => (on ? cur.filter((x) => x !== o.id) : [...cur, o.id])) : send([o.id]))}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition active:scale-[0.99]',
                  mine ? 'border-white/30 hover:bg-white/10' : 'border-line hover:border-brand-300 hover:bg-brand-50/50',
                  on && (mine ? 'bg-white/15' : 'border-brand-400 bg-brand-50'),
                )}
                data-testid="poll-option"
              >
                <span
                  className={cn(
                    'grid h-4 w-4 shrink-0 place-items-center border',
                    poll.multiple ? 'rounded' : 'rounded-full',
                    on ? (mine ? 'border-white bg-white text-brand-700' : 'border-brand-600 bg-brand-600 text-white') : mine ? 'border-white/60' : 'border-line',
                  )}
                >
                  {on && <Check className="h-3 w-3" />}
                </span>
                {o.text}
              </button>
            </li>
          )
        })}
      </ul>
      <div className={cn('mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs', mine ? 'text-white/80' : 'text-muted')}>
        <span>{t('msg.votes', { n: total })}</span>
        {!showResults && poll.multiple && (
          <button
            type="button"
            disabled={!picked.length || vote.isPending}
            onClick={() => send(picked)}
            className={cn('font-semibold disabled:opacity-40', mine ? 'text-white' : 'text-brand-700')}
            data-testid="poll-vote"
          >
            {t('msg.vote')}
          </button>
        )}
        {voted && !closed && (
          <button type="button" onClick={() => send([])} className="font-medium underline-offset-2 hover:underline">
            {t('msg.retractVote')}
          </button>
        )}
        {canClose && !closed && (
          <button type="button" onClick={() => close.mutate({ id: msg.id, chatId: msg.chat_id }, { onError })} className="font-medium underline-offset-2 hover:underline">
            {t('msg.closePoll')}
          </button>
        )}
      </div>
    </div>
  )
}
