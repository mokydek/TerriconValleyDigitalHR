import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, TrendingUp, Users } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useEmployeesLite } from '@/lib/api'
import { must, supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui'

type Absence = { request_id: string; employee_id: string; full_name: string; start_date: string; end_date: string; status: string }

/** Пик логистики 11.11: 16–30 ноября (регламент планирования отпусков) */
function hitsPeak(start: string, end: string) {
  const s = new Date(start)
  const e = new Date(end)
  for (let y = s.getFullYear(); y <= e.getFullYear(); y++) {
    const ps = new Date(`${y}-11-16`)
    const pe = new Date(`${y}-11-30`)
    if (s <= pe && e >= ps) return true
  }
  return false
}

/**
 * «Кто ещё в отпуске в эти даты»: пока сотрудник выбирает даты, видно, сколько коллег его команды
 * уже отдыхает в этот период, и попадает ли отпуск в пик сезона. Это помогает выбрать даты,
 * которые руководитель согласует без переносов. Видны только оформленные отпуска коллег.
 */
export function TeamOverlap({ start, end }: { start: string; end: string }) {
  const { t } = useI18n()
  const { me } = useAuth()
  const people = useEmployeesLite()
  const { data, isLoading } = useQuery({
    queryKey: ['team-overlap', start, end],
    enabled: Boolean(start && end && start <= end),
    queryFn: async () => (await must(supabase.rpc('team_absences', { p_from: start, p_to: end }))) as Absence[],
  })
  if (!start || !end || start > end) return null
  const teamSize = (people.data ?? []).filter((p) => p.manager_id && p.manager_id === me?.manager_id && p.id !== me?.id).length
  const others = (data ?? []).filter((a) => a.employee_id !== me?.id)
  const uniq = [...new Map(others.map((a) => [a.employee_id, a])).values()]
  const share = teamSize ? uniq.length / teamSize : 0
  const busy = share >= 0.3
  const peak = hitsPeak(start, end)

  const s = new Date(start).getTime()
  const e = new Date(end).getTime() + 86_400_000
  const span = e - s

  return (
    <div className={cn('animate-rise rounded-xl border px-4 py-3 text-sm', busy || peak ? 'border-amber-200 bg-amber-50/50' : 'border-brand-100 bg-brand-50/40')} data-testid="team-overlap">
      <div className="flex items-start gap-2">
        {busy ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : uniq.length === 0 ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <Users className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">
            {isLoading ? t('common.loading') : uniq.length === 0 ? t('v2v.free') : t('v2v.busy', { n: uniq.length, total: teamSize || uniq.length })}
          </div>
          {!isLoading && <div className="text-xs text-muted">{busy ? t('v2v.busyHint') : uniq.length === 0 ? t('v2v.freeHint') : t('v2v.okHint')}</div>}
        </div>
      </div>

      {uniq.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {uniq.slice(0, 5).map((a) => {
            const left = Math.max(0, (new Date(a.start_date).getTime() - s) / span)
            const right = Math.min(1, (new Date(a.end_date).getTime() + 86_400_000 - s) / span)
            return (
              <li key={a.employee_id} className="flex items-center gap-2">
                <Avatar id={a.employee_id} name={a.full_name} size={22} />
                <span className="w-32 shrink-0 truncate text-xs font-medium">{a.full_name}</span>
                <span className="relative h-2 flex-1 rounded-full bg-white ring-1 ring-line" title={`${fmtDate(a.start_date, 'd MMM')} – ${fmtDate(a.end_date, 'd MMM')}`}>
                  <span className="absolute inset-y-0 rounded-full bg-amber-400" style={{ left: `${left * 100}%`, width: `${Math.max(4, (right - left) * 100)}%` }} />
                </span>
                <span className="w-24 shrink-0 text-right text-[11px] text-muted">
                  {fmtDate(a.start_date, 'd MMM')} – {fmtDate(a.end_date, 'd MMM')}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {peak && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-white/80 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('v2v.peak')}
        </div>
      )}
    </div>
  )
}
