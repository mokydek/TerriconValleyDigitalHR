import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, GraduationCap, Inbox, Megaphone, MessageCircleQuestion, Send } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useTickets, useWorkRequests } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CustomReminderModal } from '@/components/hr/HrBlocks'

type Action = {
  id: string
  icon: ReactNode
  label: string
  hint: string
  tone: string
  count?: number
  onClick: () => void
}

/**
 * Быстрые действия руководителя и HR: всё, чем они управляют, в один клик с главной.
 * Каждая плитка открывает форму прямо там, где действие делается (задача, курс, объявление, напоминание),
 * а очереди (заявки, обращения) показывают, сколько ждёт решения. Набор зависит от роли:
 * HR видит всю компанию и обращения, руководитель видит свою команду.
 */
export function LeadActions() {
  const { t } = useI18n()
  const { role, me } = useAuth()
  const navigate = useNavigate()
  const work = useWorkRequests(0)
  const tickets = useTickets(role === 'hr' ? 'all' : 'mine')
  const [remind, setRemind] = useState(false)
  const hr = role === 'hr'

  const atHr = (work.data ?? []).filter((r) => r.status === 'approved' || (r.status === 'pending' && r.approver?.role === 'hr')).length
  const atMe = (work.data ?? []).filter((r) => r.status === 'pending' && r.approver_id === me?.id).length
  const openTickets = hr ? (tickets.data ?? []).filter((x) => x.status === 'open').length : 0

  const actions: Action[] = [
    hr
      ? { id: 'requests', icon: <Inbox className="h-5 w-5" />, label: t('cc.requests'), hint: atHr ? t('cc.requestsHint', { n: atHr }) : t('cc.queueEmpty'), tone: 'bg-sky-50 text-sky-600', count: atHr, onClick: () => navigate('/approvals') }
      : { id: 'approvals', icon: <Inbox className="h-5 w-5" />, label: t('cc.approvals'), hint: atMe ? t('cc.approvalsHint', { n: atMe }) : t('cc.queueEmpty'), tone: 'bg-sky-50 text-sky-600', count: atMe, onClick: () => navigate('/approvals') },
    ...(hr
      ? [{ id: 'tickets', icon: <MessageCircleQuestion className="h-5 w-5" />, label: t('cc.tickets'), hint: openTickets ? t('cc.ticketsHint', { n: openTickets }) : t('cc.queueEmpty'), tone: 'bg-rose-50 text-rose-600', count: openTickets, onClick: () => navigate('/tickets') }]
      : []),
    { id: 'task', icon: <ClipboardList className="h-5 w-5" />, label: t('cc.task'), hint: t('cc.taskHint'), tone: 'bg-brand-50 text-brand-700', onClick: () => navigate('/tasks?new=1') },
    { id: 'course', icon: <GraduationCap className="h-5 w-5" />, label: t('cc.course'), hint: hr ? t('cc.courseHint') : t('cc.courseHintTeam'), tone: 'bg-violet-50 text-violet-600', onClick: () => navigate('/academy?assign=1') },
    { id: 'announce', icon: <Megaphone className="h-5 w-5" />, label: t('cc.announce'), hint: hr ? t('cc.announceHint') : t('cc.announceHintTeam'), tone: 'bg-amber-50 text-amber-700', onClick: () => navigate('/announcements?new=1') },
    { id: 'remind', icon: <Send className="h-5 w-5" />, label: t('cc.remind'), hint: hr ? t('cc.remindHint') : t('cc.remindHintTeam'), tone: 'bg-canvas text-ink-soft', onClick: () => setRemind(true) },
  ]

  return (
    <>
      <div className={cn('stagger grid grid-cols-2 gap-2.5 sm:grid-cols-3', hr ? 'xl:grid-cols-6' : 'xl:grid-cols-5')} data-testid="lead-actions">
        {actions.map((a, i) => (
          <button
            key={a.id}
            onClick={a.onClick}
            style={{ ['--i' as string]: i }}
            className="lift group relative flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-3 text-left transition hover:border-brand-200 active:scale-[0.98]"
            data-testid={`lead-action-${a.id}`}
          >
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl transition group-hover:scale-105', a.tone)}>{a.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm leading-tight font-semibold text-ink">{a.label}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted">{a.hint}</span>
            </span>
            {Boolean(a.count) && (
              <span className="animate-bump absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white ring-2 ring-white">
                {a.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <CustomReminderModal open={remind} onClose={() => setRemind(false)} />
    </>
  )
}
