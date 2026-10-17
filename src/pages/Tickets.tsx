import { useState } from 'react'
import { BookPlus, MessagesSquare, Send } from '@/components/icons'
import { toast } from 'sonner'
import { useAnswerTicket, useTickets } from '@/lib/api'
import { fmtDateTime, fullName, timeAgo } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import type { HrTicket } from '@/lib/types'
import { Avatar, Badge, Button, Card, Empty, Field, PageHeader, Skeleton, Tabs } from '@/components/ui'

type Filter = 'open' | 'answered'

export default function TicketsPage() {
  const { t } = useI18n()
  const { data, isLoading } = useTickets('all')
  const [filter, setFilter] = useState<Filter>('open')
  const list = (data ?? []).filter((x) => (filter === 'open' ? x.status === 'open' : x.status !== 'open'))
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('nav.tickets')}
        subtitle={t('tickets.subtitle')}
      />
      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        className="mb-4"
        items={[
          { value: 'open', label: t('tickets.tab.open'), count: (data ?? []).filter((x) => x.status === 'open').length },
          { value: 'answered', label: t('tickets.tab.answered') },
        ]}
      />
      <div className="space-y-3">
        {isLoading && <Skeleton className="h-40" />}
        {!isLoading && list.length === 0 && (
          <Card>
            <Empty icon={<MessagesSquare className="h-6 w-6" />} title={filter === 'open' ? t('tickets.emptyOpen') : t('tickets.emptyAnswered')} />
          </Card>
        )}
        {list.map((x) => (
          <TicketCard key={x.id} ticket={x} />
        ))}
      </div>
    </div>
  )
}

function TicketCard({ ticket }: { ticket: HrTicket }) {
  const { t } = useI18n()
  const answer = useAnswerTicket()
  const [text, setText] = useState('')
  const [addToKb, setAddToKb] = useState(true)
  const [kbTitle, setKbTitle] = useState(ticket.question.replace(/\?$/, ''))
  return (
    <Card className="p-5" data-testid="ticket">
      <div className="flex items-start gap-3">
        <Avatar id={ticket.employee_id} name={fullName(ticket.employee)} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{fullName(ticket.employee)}</span>
            <span className="text-sm text-muted">
              {ticket.employee?.position} · {ticket.employee?.department?.name}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted">{t('tickets.meta', { number: ticket.number, date: fmtDateTime(ticket.created_at) })}</div>
          <p className="mt-3 rounded-xl bg-canvas px-4 py-3 text-[15px] text-ink">{ticket.question}</p>
        </div>
        <Badge className={ticket.status === 'open' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-brand-50 text-brand-700 ring-brand-200'}>
          {ticket.status === 'open' ? t('tickets.status.open') : t('tickets.status.answered')}
        </Badge>
      </div>
      {ticket.status !== 'open' ? (
        <div className="mt-4 ml-[52px] rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
          {ticket.answer}
          <div className="mt-1 text-xs text-brand-700/80">{t('tickets.answeredAgo', { ago: timeAgo(ticket.answered_at) })}</div>
        </div>
      ) : (
        <div className="mt-4 space-y-3 sm:ml-[52px]">
          <textarea className="field min-h-[100px]" placeholder={t('tickets.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={addToKb} onChange={(e) => setAddToKb(e.target.checked)} />
            <BookPlus className="h-4 w-4 text-brand-600" /> {t('tickets.addToKb')}
          </label>
          {addToKb && (
            <Field label={t('tickets.kbTitle')}>
              <input className="field" value={kbTitle} onChange={(e) => setKbTitle(e.target.value)} />
            </Field>
          )}
          <div className="flex justify-end">
            <Button
              icon={<Send className="h-4 w-4" />}
              loading={answer.isPending}
              disabled={!text.trim()}
              onClick={async () => {
                try {
                  await answer.mutateAsync({ id: ticket.id, answer: text, addToKb, kbTitle })
                  toast.success(t('tickets.sent'), { description: addToKb ? t('tickets.sentKb') : undefined })
                } catch (e) {
                  toast.error((e as Error).message)
                }
              }}
              data-testid="ticket-answer"
            >
              {t('tickets.reply')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
