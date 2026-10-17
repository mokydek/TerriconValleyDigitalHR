import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Database, FileSignature, RefreshCw, UserPlus } from '@/components/icons'
import { toast } from 'sonner'
import { useIntegrationEvents, useRunIntegrationWorker, useSyncZup, useZupPending } from '@/lib/api'
import { fmtDateTime } from '@/lib/format'
import { tr, useI18n, type I18nKey } from '@/lib/i18n'
import { serverText } from '@/lib/serverText'
import { cn } from '@/lib/utils'
import { Badge, Button, Card, CardHeader, PageHeader, Skeleton } from '@/components/ui'

// Ключи подписей типов событий; незнакомый тип показываем как есть
const ENTITY: Record<string, I18nKey> = {
  vacation_order: 'integr.entity.vacationOrder',
  advance_payment: 'integr.entity.advancePayment',
  employee_change: 'type.data_change',
  acquaintance: 'integr.entity.acquaintance',
  certificate: 'type.certificate',
  employee_created: 'integr.entity.employeeCreated',
  employee_updated: 'integr.entity.employeeUpdated',
}

export default function IntegrationsPage() {
  const { t } = useI18n()
  const pending = useZupPending()
  const sync = useSyncZup()
  const events = useIntegrationEvents()
  const worker = useRunIntegrationWorker()
  const changes = (pending.data?.new.length ?? 0) + (pending.data?.changed.length ?? 0)

  return (
    <div>
      <PageHeader
        title={t('nav.integrations')}
        subtitle={t('integr.subtitle')}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={<Database className="h-[18px] w-[18px]" />}
            title={t('integr.zup.title')}
            subtitle={t('integr.zup.subtitle')}
            action={<Badge className="bg-amber-50 text-amber-800 ring-amber-200">mock API</Badge>}
          />
          <div className="space-y-4 px-5 pb-5">
            <ul className="space-y-1.5 text-sm text-ink-soft">
              <li className="flex gap-2">
                <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /> {t('integr.zup.inbound')}
              </li>
              <li className="flex gap-2">
                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {t('integr.zup.outbound')}
              </li>
            </ul>
            <div className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{t('integr.zup.sync')}</div>
                  <div className="text-xs text-muted">{t('integr.zup.lastSync', { date: pending.data?.last_sync ? fmtDateTime(pending.data.last_sync) : '–' })}</div>
                </div>
                <Button
                  icon={<RefreshCw className="h-4 w-4" />}
                  loading={sync.isPending}
                  onClick={async () => {
                    try {
                      const r = await sync.mutateAsync()
                      toast.success(t('integr.zup.synced', { inserted: r.inserted, updated: r.updated }), { description: t('integr.zup.total', { n: r.total }) })
                    } catch (e) {
                      toast.error((e as Error).message)
                    }
                  }}
                  data-testid="zup-sync"
                >
                  {t('integr.zup.syncButton')}
                </Button>
              </div>
              {pending.isLoading ? (
                <Skeleton className="mt-3 h-12" />
              ) : changes === 0 ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-brand-700">
                  <CheckCircle2 className="h-4 w-4" /> {t('integr.zup.inSync')}
                </div>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {pending.data?.new.map((n) => (
                    <li key={n.tab_no} className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-sky-600" /> {tr('integr.zup.new', { name: <b>{n.name}</b>, position: n.position, tabNo: n.tab_no })}
                    </li>
                  ))}
                  {pending.data?.changed.map((c) => (
                    <li key={c.tab_no} className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-amber-600" /> {t('integr.zup.changed', { name: c.name, field: serverText(c.field), from: c.from, to: c.to })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<FileSignature className="h-[18px] w-[18px]" />}
            title="Documentolog"
            subtitle={t('integr.dl.subtitle')}
            action={<Badge className="bg-amber-50 text-amber-800 ring-amber-200">mock API</Badge>}
          />
          <div className="space-y-3 px-5 pb-5 text-sm text-ink-soft">
            <p>{t('integr.dl.text1')}</p>
            <p>{t('integr.dl.text2')}</p>
            <Button
              variant="outline"
              icon={<RefreshCw className="h-4 w-4" />}
              loading={worker.isPending}
              onClick={() => worker.mutate()}
              className="h-auto min-h-10 max-w-full py-2 text-left whitespace-normal"
            >
              {t('integr.dl.process')}
            </Button>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t('integr.log.title')} subtitle={t('integr.log.subtitle')} />
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-y border-line bg-canvas/60 text-xs text-muted uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">{t('integr.col.time')}</th>
                <th className="px-5 py-2.5 font-medium">{t('integr.col.system')}</th>
                <th className="px-5 py-2.5 font-medium">{t('integr.col.direction')}</th>
                <th className="px-5 py-2.5 font-medium">{t('integr.col.event')}</th>
                <th className="px-5 py-2.5 font-medium">{t('integr.col.document')}</th>
                <th className="px-5 py-2.5 font-medium">{t('integr.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(events.data ?? []).map((e) => (
                <tr key={e.id} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-2.5 whitespace-nowrap text-muted">{fmtDateTime(e.created_at)}</td>
                  <td className="px-5 py-2.5 font-medium">{e.system === '1c_zup' ? t('integr.system.zup') : 'Documentolog'}</td>
                  <td className="px-5 py-2.5 whitespace-nowrap">{e.direction === 'inbound' ? t('integr.dir.in') : t('integr.dir.out')}</td>
                  <td className="px-5 py-2.5">{ENTITY[e.entity] ? t(ENTITY[e.entity]) : e.entity}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{serverText(e.response?.document) || (e.external_id ?? '–')}</td>
                  <td className="px-5 py-2.5">
                    <Badge className={cn(e.status === 'sent' ? 'bg-brand-50 text-brand-700 ring-brand-200' : e.status === 'error' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-amber-50 text-amber-800 ring-amber-200')}>
                      {e.status === 'sent' ? t('integr.status.sent') : e.status === 'error' ? t('integr.status.error') : t('integr.status.pending')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
