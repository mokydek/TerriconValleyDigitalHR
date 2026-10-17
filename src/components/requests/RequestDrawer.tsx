import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useCancelRequest, useDecideRequest, useRequestEvents, useRunIntegrationWorker, useVacationBalance } from '@/lib/api'
import { days, entitledText, fmtDate, fmtDateTime, fullName, money } from '@/lib/format'
import type { HrRequest } from '@/lib/types'
import { sleep } from '@/lib/utils'
import { Button, Drawer, Skeleton } from '@/components/ui'
import { IntegrationDocs, RequestStepper, RequestTimeline, StatusBadge, TypeLabel } from './RequestParts'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  )
}

export function RequestDrawer({ request, onClose }: { request: HrRequest | null; onClose: () => void }) {
  const { me, isHr } = useAuth()
  const events = useRequestEvents(request?.id)
  const decide = useDecideRequest()
  const cancel = useCancelRequest()
  const worker = useRunIntegrationWorker()
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState('')
  const isMine = request?.employee_id === me?.id
  const balance = useVacationBalance(request && !isMine && request.type === 'vacation' ? request.employee_id : undefined)

  if (!request) return null
  const r = request

  const act = async (action: 'approve' | 'process' | 'reject') => {
    try {
      await decide.mutateAsync({ id: r.id, action, comment: action === 'reject' ? comment : comment || undefined })
      if (action === 'process') {
        toast.success('Передано в 1С:ЗУП, ждём ответ…')
        await sleep(2500)
        await worker.mutateAsync()
        toast.success('1С:ЗУП подтвердила: документы сформированы')
      } else {
        toast.success(action === 'approve' ? 'Заявка согласована' : 'Заявка отклонена')
      }
      setRejecting(false)
      setComment('')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const canManagerApprove = !isMine && r.status === 'pending' && (r.approver_id === me?.id || isHr) && r.approver?.role !== 'hr'
  const canProcess = isHr && !isMine && (r.status === 'approved' || (r.status === 'pending' && (r.approver?.role === 'hr' || !r.employee?.manager_id)))
  const canReject = !isMine && (r.status === 'pending' || r.status === 'approved') && (r.approver_id === me?.id || isHr)
  const canCancel = isMine && (r.status === 'pending' || r.status === 'approved')

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <TypeLabel type={r.type} /> <span className="text-muted">№{r.number}</span>
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={r.status} /> <span>создана {fmtDateTime(r.created_at)}</span>
        </span>
      }
      footer={
        rejecting ? (
          <div className="w-full space-y-2">
            <textarea className="field min-h-[72px]" placeholder="Причина отказа и альтернатива (обязательно)" value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                Назад
              </Button>
              <Button variant="danger" loading={decide.isPending} disabled={!comment.trim()} onClick={() => void act('reject')}>
                Отклонить
              </Button>
            </div>
          </div>
        ) : (
          <>
            {canCancel && (
              <Button
                variant="outline"
                loading={cancel.isPending}
                onClick={async () => {
                  try {
                    await cancel.mutateAsync(r.id)
                    toast.success('Заявка отозвана')
                    onClose()
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
              >
                Отозвать заявку
              </Button>
            )}
            {canReject && (
              <Button variant="outline" className="text-rose-700" onClick={() => setRejecting(true)}>
                Отклонить
              </Button>
            )}
            {canManagerApprove && (
              <Button loading={decide.isPending} onClick={() => void act('approve')} data-testid="drawer-approve">
                Согласовать
              </Button>
            )}
            {canProcess && (
              <Button loading={decide.isPending || worker.isPending} onClick={() => void act('process')} data-testid="drawer-process">
                Оформить в 1С:ЗУП
              </Button>
            )}
            {isHr && r.status === 'processing' && (
              <Button variant="soft" icon={<RefreshCw className="h-4 w-4" />} loading={worker.isPending} onClick={() => worker.mutate()}>
                Запросить статус из 1С
              </Button>
            )}
            {!canCancel && !canReject && !canManagerApprove && !canProcess && (
              <Button variant="outline" onClick={onClose}>
                Закрыть
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-6">
        <section className="rounded-2xl border border-line bg-canvas/50 px-3 pt-4 pb-3">
          <RequestStepper request={r} events={events.data} />
        </section>

        <section>
          <h4 className="mb-1 text-sm font-semibold text-ink">Детали</h4>
          <div className="divide-y divide-line">
            {!isMine && r.employee && <Row label="Сотрудник" value={`${fullName(r.employee)} · ${r.employee.position}`} />}
            {r.type === 'vacation' && (
              <>
                <Row label="Период" value={`${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`} />
                <Row label="Дней (без праздников)" value={days(r.days)} />
              </>
            )}
            {r.type === 'advance' && <Row label="Сумма" value={money(r.amount)} />}
            {r.type === 'certificate' && (
              <>
                <Row label="Цель" value={String(r.details.purpose ?? '–')} />
                <Row label="Язык / экземпляров" value={`${String(r.details.language ?? 'ru').toUpperCase()} / ${r.details.copies ?? 1}`} />
              </>
            )}
            {r.type === 'data_change' && (
              <>
                <Row label="Что изменить" value={String(r.details.field ?? '–')} />
                <Row label="Новое значение" value={String(r.details.new_value ?? '–')} />
              </>
            )}
            {r.comment && <Row label="Комментарий" value={r.comment} />}
            {r.approver && ['pending', 'approved'].includes(r.status) && <Row label="Сейчас у" value={`${fullName(r.approver)} (${r.approver.role === 'hr' ? 'HR' : 'руководитель'})`} />}
          </div>
          {!isMine && r.type === 'vacation' && balance.data && (
            <div className="mt-3 rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800">
              Остаток отпуска сотрудника: <b>{days(balance.data.available)}</b> (с учётом этой заявки), положено {entitledText(balance.data)}
            </div>
          )}
        </section>

        {(r.integration?.zup || r.integration?.documentolog) && (
          <section>
            <h4 className="mb-2 text-sm font-semibold text-ink">Документы</h4>
            <IntegrationDocs request={r} />
          </section>
        )}
        {r.status === 'processing' && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-sm text-indigo-800">
            Заявка передана в 1С:ЗУП. Как только система вернёт номер документа, статус сменится на «Оформлено», а сотрудник получит уведомление.
          </div>
        )}

        <section>
          <h4 className="mb-3 text-sm font-semibold text-ink">История</h4>
          {events.isLoading ? <Skeleton className="h-24" /> : <RequestTimeline events={events.data ?? []} />}
        </section>
      </div>
    </Drawer>
  )
}
