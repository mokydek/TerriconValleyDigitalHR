import { useState } from 'react'
import { RefreshCw } from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useCancelRequest, useDecideRequest, useRequestEvents, useRunIntegrationWorker, useVacationBalance } from '@/lib/api'
import { certPurposeLabel, dataFieldLabel } from '@/lib/constants'
import { days, entitledText, fmtDate, fmtDateTime, fullName, money } from '@/lib/format'
import { tr, useI18n } from '@/lib/i18n'
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
  const { t } = useI18n()
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
        toast.success(t('req.toastTo1c'))
        await sleep(2500)
        await worker.mutateAsync()
        toast.success(t('req.toast1cDone'))
      } else {
        toast.success(action === 'approve' ? t('req.toastApproved') : t('req.toastRejected'))
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
          <TypeLabel type={r.type} /> <span className="text-muted">{t('req.no', { n: r.number })}</span>
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={r.status} /> <span>{t('req.createdAt', { date: fmtDateTime(r.created_at) })}</span>
        </span>
      }
      footer={
        rejecting ? (
          <div className="w-full space-y-2">
            <textarea className="field min-h-[72px]" placeholder={t('req.rejectPh')} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                {t('common.back')}
              </Button>
              <Button variant="danger" loading={decide.isPending} disabled={!comment.trim()} onClick={() => void act('reject')}>
                {t('req.reject')}
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
                    toast.success(t('req.ev.cancelled'))
                    onClose()
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
              >
                {t('req.cancel')}
              </Button>
            )}
            {canReject && (
              <Button variant="outline" className="text-rose-700" onClick={() => setRejecting(true)}>
                {t('req.reject')}
              </Button>
            )}
            {canManagerApprove && (
              <Button loading={decide.isPending} onClick={() => void act('approve')} data-testid="drawer-approve">
                {t('req.approve')}
              </Button>
            )}
            {canProcess && (
              <Button loading={decide.isPending || worker.isPending} onClick={() => void act('process')} data-testid="drawer-process">
                {t('req.process1c')}
              </Button>
            )}
            {isHr && r.status === 'processing' && (
              <Button variant="soft" icon={<RefreshCw className="h-4 w-4" />} loading={worker.isPending} onClick={() => worker.mutate()}>
                {t('req.status1c')}
              </Button>
            )}
            {!canCancel && !canReject && !canManagerApprove && !canProcess && (
              <Button variant="outline" onClick={onClose}>
                {t('common.close')}
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
          <h4 className="mb-1 text-sm font-semibold text-ink">{t('req.details')}</h4>
          <div className="divide-y divide-line">
            {!isMine && r.employee && <Row label={t('req.employee')} value={`${fullName(r.employee)} · ${r.employee.position}`} />}
            {r.type === 'vacation' && (
              <>
                <Row label={t('req.period')} value={`${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`} />
                <Row label={t('req.daysNoHolidays')} value={days(r.days)} />
              </>
            )}
            {r.type === 'advance' && <Row label={t('req.amount')} value={money(r.amount)} />}
            {r.type === 'certificate' && (
              <>
                <Row label={t('req.purpose')} value={r.details.purpose == null ? '–' : certPurposeLabel(String(r.details.purpose))} />
                <Row label={t('req.langCopies')} value={`${String(r.details.language ?? 'ru').toUpperCase()} / ${r.details.copies ?? 1}`} />
              </>
            )}
            {r.type === 'data_change' && (
              <>
                <Row label={t('req.whatChange')} value={r.details.field == null ? '–' : dataFieldLabel(String(r.details.field))} />
                <Row label={t('req.newValue')} value={String(r.details.new_value ?? '–')} />
              </>
            )}
            {r.comment && <Row label={t('req.comment')} value={r.comment} />}
            {r.approver && ['pending', 'approved'].includes(r.status) && (
              <Row label={t('req.nowAt')} value={r.approver.role === 'hr' ? `${fullName(r.approver)} (HR)` : t('req.atManager', { name: fullName(r.approver) })} />
            )}
          </div>
          {!isMine && r.type === 'vacation' && balance.data && (
            <div className="mt-3 rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800">
              {tr('req.empBalance', { days: <b>{days(balance.data.available)}</b>, entitled: entitledText(balance.data) })}
            </div>
          )}
        </section>

        {(r.integration?.zup || r.integration?.documentolog) && (
          <section>
            <h4 className="mb-2 text-sm font-semibold text-ink">{t('req.documents')}</h4>
            <IntegrationDocs request={r} />
          </section>
        )}
        {r.status === 'processing' && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-sm text-indigo-800">{t('req.processingInfo', { status: t('status.done') })}</div>
        )}

        <section>
          <h4 className="mb-3 text-sm font-semibold text-ink">{t('req.history')}</h4>
          {events.isLoading ? <Skeleton className="h-24" /> : <RequestTimeline events={events.data ?? []} />}
        </section>
      </div>
    </Drawer>
  )
}
