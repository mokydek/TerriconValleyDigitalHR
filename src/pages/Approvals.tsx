import { useMemo, useState } from 'react'
import { BadgeCheck, Building2, ChevronRight, FileText, Loader2, RefreshCw, Search, Zap } from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useDecideRequest, useNudge, useRunIntegrationWorker, useStageSince, useWorkRequests } from '@/lib/api'
import { fmtDate, fullName } from '@/lib/format'
import type { HrRequest, RequestType } from '@/lib/types'
import { REQUEST_TYPES } from '@/lib/constants'
import { cn, sleep } from '@/lib/utils'
import { Avatar, Button, Card, Empty, ErrorBox, PageHeader, Skeleton, Tabs } from '@/components/ui'
import { RequestDrawer } from '@/components/requests/RequestDrawer'
import { requestSummary, StatusBadge, TypeLabel, WaitingTimer } from '@/components/requests/RequestParts'
import { useI18n, type I18nKey } from '@/lib/i18n'

type Column = 'manager' | 'hr' | '1c' | 'done'

function columnOf(r: HrRequest): Column | null {
  if (r.status === 'pending') return r.approver?.role === 'hr' ? 'hr' : 'manager'
  if (r.status === 'approved') return 'hr'
  if (r.status === 'processing') return '1c'
  if (r.status === 'done') return 'done'
  return null
}

const COLUMNS: { key: Column; title: I18nKey; hint: I18nKey; tone: string }[] = [
  { key: 'manager', title: 'appr.colManager', hint: 'appr.colManagerHint', tone: 'bg-amber-500' },
  { key: 'hr', title: 'appr.colHr', hint: 'appr.colHrHint', tone: 'bg-sky-500' },
  { key: '1c', title: 'appr.col1c', hint: 'appr.col1cHint', tone: 'bg-indigo-500' },
  { key: 'done', title: 'req.stepDone', hint: 'appr.colDoneHint', tone: 'bg-brand-500' },
]

export default function ApprovalsPage() {
  const { isHr } = useAuth()
  return isHr ? <HrKanban /> : <ManagerApprovals />
}

/* ================= HR: канбан по этапам трека ================= */

function HrKanban() {
  const { data, isLoading, error, refetch } = useWorkRequests(14)
  const since = useStageSince((data ?? []).map((r) => r.id))
  const decide = useDecideRequest()
  const nudge = useNudge()
  const worker = useRunIntegrationWorker()
  const { t } = useI18n()
  const [open, setOpen] = useState<HrRequest | null>(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<RequestType | 'all'>('all')

  const filtered = useMemo(
    () =>
      (data ?? []).filter(
        (r) => (type === 'all' || r.type === type) && (!query || fullName(r.employee).toLowerCase().includes(query.toLowerCase()) || String(r.number).includes(query)),
      ),
    [data, query, type],
  )
  const byCol = (c: Column) => {
    const list = filtered.filter((r) => columnOf(r) === c)
    // «Готово» — свежие сверху; остальные этапы — дольше всех ждущие сверху
    return c === 'done' ? list.sort((a, b) => b.updated_at.localeCompare(a.updated_at)) : list
  }

  const process = async (r: HrRequest) => {
    try {
      await decide.mutateAsync({ id: r.id, action: 'process' })
      toast.success(t('appr.toastSent', { n: r.number }), { description: t('appr.toastSentHint') })
      await sleep(2500)
      await worker.mutateAsync()
      toast.success(t('appr.toastDone', { n: r.number }), { description: t('appr.toastDoneHint') })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('appr.title')}
        subtitle={t('appr.subtitle')}
        actions={
          <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} loading={worker.isPending} onClick={() => worker.mutate()}>
            {t('appr.statuses1c')}
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="field pl-9" placeholder={t('appr.searchPh')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="field sm:w-60" value={type} onChange={(e) => setType(e.target.value as RequestType | 'all')}>
          <option value="all">{t('appr.allTypes')}</option>
          {REQUEST_TYPES.map((rt) => (
            <option key={rt} value={rt}>
              {t(`type.${rt}` as I18nKey)}
            </option>
          ))}
        </select>
      </div>
      {error && <ErrorBox error={error} onRetry={() => void refetch()} />}
      <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 pb-2">
        <div className="grid min-w-[1050px] grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const items = byCol(col.key)
            return (
              <div key={col.key} className="flex flex-col rounded-2xl bg-white/60 p-2 ring-1 ring-line" data-testid={`kanban-${col.key}`}>
                <div className="px-2 pt-1 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', col.tone)} />
                    <span className="font-semibold whitespace-nowrap">{t(col.title)}</span>
                    <span className="rounded-full bg-canvas px-2 text-xs font-semibold text-muted">{items.length}</span>
                  </div>
                  <div className="mt-0.5 pl-[18px] text-xs text-muted">{t(col.hint)}</div>
                </div>
                <div className="flex-1 space-y-2">
                  {isLoading && <Skeleton className="h-28" />}
                  {!isLoading && items.length === 0 && <div className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-muted">{t('appr.colEmpty')}</div>}
                  {items.map((r) => (
                    <div key={r.id} className="rounded-xl border border-line bg-white p-3 shadow-[var(--shadow-card)] transition hover:border-brand-300" data-testid={`card-${r.number}`}>
                      <button className="w-full text-left" onClick={() => setOpen(r)}>
                        <div className="flex items-center justify-between gap-2">
                          <TypeLabel type={r.type} />
                          <span className="text-xs text-muted">{t('req.no', { n: r.number })}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Avatar id={r.employee?.id} name={fullName(r.employee)} size={24} />
                          <span className="truncate text-sm font-medium">{fullName(r.employee)}</span>
                        </div>
                        <div className="mt-1 truncate text-[12.5px] text-muted">{requestSummary(r)}</div>
                        {r.employee?.department?.name && (
                          <div className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted">
                            <Building2 className="h-3 w-3" /> {r.employee.department.name}
                          </div>
                        )}
                      </button>
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                        {col.key !== 'done' ? <WaitingTimer since={since.data?.[r.id] ?? r.created_at} warnHours={col.key === '1c' ? 0.05 : 24} alertHours={col.key === '1c' ? 1 : 48} /> : <span className="text-xs text-muted">{fmtDate(r.updated_at, 'd MMM, HH:mm')}</span>}
                        {col.key === 'manager' && (
                          <Button
                            size="sm"
                            variant="soft"
                            loading={nudge.isPending && nudge.variables === r.id}
                            onClick={async () => {
                              try {
                                await nudge.mutateAsync(r.id)
                                toast.success(t('appr.nudged', { name: fullName(r.approver) }))
                              } catch (e) {
                                toast.error((e as Error).message)
                              }
                            }}
                          >
                            {t('appr.nudge')}
                          </Button>
                        )}
                        {col.key === 'hr' && (
                          <Button size="sm" icon={<Zap className="h-3.5 w-3.5" />} loading={decide.isPending && decide.variables?.id === r.id} onClick={() => void process(r)} data-testid={`process-${r.number}`}>
                            {t('appr.process')}
                          </Button>
                        )}
                        {col.key === '1c' && (
                          <span className="inline-flex items-center gap-1 text-xs text-indigo-700">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('appr.waiting1c')}
                          </span>
                        )}
                        {col.key === 'done' && (r.integration?.zup || r.integration?.documentolog) && (
                          <button onClick={() => setOpen(r)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                            <FileText className="h-3.5 w-3.5" /> {r.integration.documentolog?.id ?? r.integration.zup?.id}
                          </button>
                        )}
                      </div>
                      {col.key === 'manager' && r.approver && <div className="mt-1.5 text-[11.5px] text-muted">{t('appr.approver', { name: fullName(r.approver) })}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <RequestDrawer request={open} onClose={() => setOpen(null)} />
    </div>
  )
}

/* ================= Руководитель: согласования команды ================= */

type MgrTab = 'mine' | 'progress' | 'closed'

function ManagerApprovals() {
  const { t } = useI18n()
  const { me } = useAuth()
  const { data, isLoading, error, refetch } = useWorkRequests(14)
  const decide = useDecideRequest()
  const [tab, setTab] = useState<MgrTab>('mine')
  const [open, setOpen] = useState<HrRequest | null>(null)
  const all = data ?? []
  const mine = all.filter((r) => r.status === 'pending' && r.approver_id === me?.id)
  const progress = all.filter((r) => ['approved', 'processing'].includes(r.status) || (r.status === 'pending' && r.approver_id !== me?.id))
  const closed = all.filter((r) => ['done', 'rejected'].includes(r.status))
  const rows = tab === 'mine' ? mine : tab === 'progress' ? progress : closed

  return (
    <div>
      <PageHeader title={t('nav.approvals')} subtitle={t('appr.mgrSubtitle')} />
      <Tabs<MgrTab>
        value={tab}
        onChange={setTab}
        className="mb-4"
        items={[
          { value: 'mine', label: t('appr.tabMine'), count: mine.length },
          { value: 'progress', label: t('req.tabActive'), count: progress.length },
          { value: 'closed', label: t('appr.tabClosed'), count: closed.length },
        ]}
      />
      {error && <ErrorBox error={error} onRetry={() => void refetch()} />}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : rows.length === 0 ? (
          <Empty icon={<BadgeCheck className="h-6 w-6" />} title={t('appr.empty')} text={tab === 'mine' ? t('appr.emptyMine') : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                <button onClick={() => setOpen(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Avatar id={r.employee?.id} name={fullName(r.employee)} size={40} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{fullName(r.employee)}</span>
                      <span className="text-xs text-muted">{r.employee?.position}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <TypeLabel type={r.type} /> · {requestSummary(r)} · {t('req.no', { n: r.number })}
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {tab === 'mine' ? (
                    <>
                      <WaitingTimer since={r.created_at} />
                      <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                        {t('appr.rejectMore')}
                      </Button>
                      <Button
                        size="sm"
                        loading={decide.isPending && decide.variables?.id === r.id}
                        onClick={async () => {
                          try {
                            await decide.mutateAsync({ id: r.id, action: 'approve' })
                            toast.success(t('appr.toastApproved', { n: r.number }), { description: t('appr.toastApprovedHint') })
                          } catch (e) {
                            toast.error((e as Error).message)
                          }
                        }}
                        data-testid={`approve-${r.number}`}
                      >
                        {t('req.approve')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <StatusBadge status={r.status} />
                      <ChevronRight className="h-4 w-4 text-muted" />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <RequestDrawer request={open} onClose={() => setOpen(null)} />
    </div>
  )
}
