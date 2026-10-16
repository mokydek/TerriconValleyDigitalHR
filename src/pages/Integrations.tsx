import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Database, FileSignature, RefreshCw, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useIntegrationEvents, useRunIntegrationWorker, useSyncZup, useZupPending } from '@/lib/api'
import { fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge, Button, Card, CardHeader, PageHeader, Skeleton } from '@/components/ui'

const ENTITY: Record<string, string> = {
  vacation_order: 'Приказ об отпуске',
  advance_payment: 'Выплата аванса',
  employee_change: 'Изменение данных',
  acquaintance: 'Ознакомление с приказом',
  certificate: 'Справка с места работы',
  employee_created: 'Новый сотрудник',
  employee_updated: 'Изменение карточки',
}

export default function IntegrationsPage() {
  const pending = useZupPending()
  const sync = useSyncZup()
  const events = useIntegrationEvents()
  const worker = useRunIntegrationWorker()
  const changes = (pending.data?.new.length ?? 0) + (pending.data?.changed.length ?? 0)

  return (
    <div>
      <PageHeader
        title="Интеграции"
        subtitle="Где и как JanaМен подключается к 1С:ЗУП и Documentolog. В прототипе внешние системы — mock-адаптеры с тем же контрактом событий."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={<Database className="h-[18px] w-[18px]" />}
            title="1С:Зарплата и управление персоналом"
            subtitle="Мастер-система кадровых данных"
            action={<Badge className="bg-amber-50 text-amber-800 ring-amber-200">mock API</Badge>}
          />
          <div className="space-y-4 px-5 pb-5">
            <ul className="space-y-1.5 text-sm text-ink-soft">
              <li className="flex gap-2">
                <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /> Входящий поток: сотрудники, должности, подразделения, руководители, даты приёма, оклад — только чтение в JanaМен.
              </li>
              <li className="flex gap-2">
                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Исходящий поток: приказ об отпуске, ведомость аванса, запрос на изменение данных — после оформления заявки HR.
              </li>
            </ul>
            <div className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Синхронизация сотрудников</div>
                  <div className="text-xs text-muted">Последняя: {pending.data?.last_sync ? fmtDateTime(pending.data.last_sync) : '—'}</div>
                </div>
                <Button
                  icon={<RefreshCw className="h-4 w-4" />}
                  loading={sync.isPending}
                  onClick={async () => {
                    try {
                      const r = await sync.mutateAsync()
                      toast.success(`Синхронизировано: +${r.inserted} новых, ${r.updated} изменено`, { description: `Всего в 1С:ЗУП: ${r.total}` })
                    } catch (e) {
                      toast.error((e as Error).message)
                    }
                  }}
                  data-testid="zup-sync"
                >
                  Синхронизировать
                </Button>
              </div>
              {pending.isLoading ? (
                <Skeleton className="mt-3 h-12" />
              ) : changes === 0 ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-brand-700">
                  <CheckCircle2 className="h-4 w-4" /> Данные совпадают с 1С:ЗУП
                </div>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {pending.data?.new.map((n) => (
                    <li key={n.tab_no} className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-sky-600" /> Новый в 1С: <b>{n.name}</b> — {n.position} ({n.tab_no})
                    </li>
                  ))}
                  {pending.data?.changed.map((c) => (
                    <li key={c.tab_no} className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-amber-600" /> {c.name}: {c.field} «{c.from}» → «{c.to}»
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
            subtitle="Электронный документооборот: справки, ознакомление с приказами"
            action={<Badge className="bg-amber-50 text-amber-800 ring-amber-200">mock API</Badge>}
          />
          <div className="space-y-3 px-5 pb-5 text-sm text-ink-soft">
            <p>Когда HR оформляет заявку, JanaМен регистрирует документ в Documentolog и запускает маршрут: подписание HR → ознакомление работника. Номер документа сохраняется в карточке заявки.</p>
            <p>Электронная подпись и хранение оригиналов — на стороне Documentolog (в рамках MVP не требуются).</p>
            <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} loading={worker.isPending} onClick={() => worker.mutate()}>
              Обработать очередь событий
            </Button>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Журнал интеграционных событий" subtitle="Transactional outbox: событие пишется в одной транзакции с бизнес-операцией, адаптер доставляет его во внешнюю систему" />
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-y border-line bg-canvas/60 text-xs text-muted uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">Время</th>
                <th className="px-5 py-2.5 font-medium">Система</th>
                <th className="px-5 py-2.5 font-medium">Направление</th>
                <th className="px-5 py-2.5 font-medium">Событие</th>
                <th className="px-5 py-2.5 font-medium">Внешний номер / документ</th>
                <th className="px-5 py-2.5 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {(events.data ?? []).map((e) => (
                <tr key={e.id} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-2.5 whitespace-nowrap text-muted">{fmtDateTime(e.created_at)}</td>
                  <td className="px-5 py-2.5 font-medium">{e.system === '1c_zup' ? '1С:ЗУП' : 'Documentolog'}</td>
                  <td className="px-5 py-2.5">{e.direction === 'inbound' ? '← входящее' : '→ исходящее'}</td>
                  <td className="px-5 py-2.5">{ENTITY[e.entity] ?? e.entity}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{e.response?.document ?? e.external_id ?? '—'}</td>
                  <td className="px-5 py-2.5">
                    <Badge className={cn(e.status === 'sent' ? 'bg-brand-50 text-brand-700 ring-brand-200' : e.status === 'error' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-amber-50 text-amber-800 ring-amber-200')}>
                      {e.status === 'sent' ? 'доставлено' : e.status === 'error' ? 'ошибка' : 'в очереди'}
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
