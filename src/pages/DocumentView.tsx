import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer } from '@/components/icons'
import { must, supabase } from '@/lib/supabase'
import { CERT_PURPOSES, certPurposeLabel, dataFieldLabel } from '@/lib/constants'
import { days, fmtDate, money } from '@/lib/format'
import { tr, useI18n } from '@/lib/i18n'
import { serverText } from '@/lib/serverText'
import type { Employee, HrRequest } from '@/lib/types'
import { Button, Card, Empty, PageLoader } from '@/components/ui'

/** Демо-представление документа, сформированного во внешней системе (mock 1С:ЗУП / Documentolog) */
export default function DocumentViewPage() {
  const { t } = useI18n()
  const { requestId } = useParams()
  const [params] = useSearchParams()
  const system = params.get('system') === 'documentolog' ? 'documentolog' : 'zup'
  const { data, isLoading } = useQuery({
    queryKey: ['document', requestId],
    queryFn: async () => {
      const r = (await must(
        supabase
          .from('requests')
          .select(
            '*, employee:employees!requests_employee_fk(id,first_name,last_name,middle_name,position,company,hire_date,zup_id,department:departments!employees_department_fk(name))',
          )
          .eq('id', requestId!)
          .maybeSingle(),
      )) as (HrRequest & { employee: Employee & { department: { name: string } | null } }) | null
      return r
    },
  })
  if (isLoading) return <PageLoader />
  if (!data)
    return (
      <Card>
        <Empty title={t('doc.unavailable')} text={t('doc.unavailableText')} />
      </Card>
    )

  const e = data.employee
  const fio = <b>{[e.last_name, e.first_name, e.middle_name].filter(Boolean).join(' ')}</b>
  const doc = system === 'documentolog' ? data.integration.documentolog : data.integration.zup
  const systemName = system === 'documentolog' ? 'Documentolog' : t('req.zup')
  const title =
    system === 'documentolog'
      ? data.type === 'certificate'
        ? t('doc.titleCertificate')
        : t('doc.titleAcquaintance')
      : data.type === 'vacation'
        ? t('doc.titleVacation')
        : data.type === 'advance'
          ? t('doc.titleAdvance')
          : t('doc.titleDataChange')

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex items-center justify-between">
        <Link to="/requests" className="group inline-flex items-center gap-1 text-sm text-muted hover:text-brand-700">
          <ArrowLeft className="h-4 w-4 transition group-hover:-translate-x-0.5" /> {t('common.back')}
        </Link>
        <Button variant="outline" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
          {t('doc.print')}
        </Button>
      </div>
      <div className="print-sheet relative overflow-hidden rounded-2xl border border-line bg-white p-8 font-serif text-[15px] leading-relaxed text-ink shadow-[var(--shadow-card)] sm:p-12">
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-6xl font-black tracking-widest text-ink/[0.04] select-none" style={{ transform: 'rotate(-24deg)' }}>
          {t('doc.watermark')}
        </div>
        <div className="relative">
          <div className="flex items-start justify-between gap-4 font-sans text-xs text-muted">
            <div>
              <div className="font-bold text-ink">{e.company}</div>
              <div>{t('doc.city')}</div>
            </div>
            <div className="text-right">
              <div>{systemName}</div>
              <div className="font-semibold text-ink">{doc?.id ?? '–'}</div>
            </div>
          </div>
          <h1 className="mt-10 text-center text-lg font-bold">{title}</h1>
          <p className="mt-1 text-center text-sm text-muted">{serverText(doc?.document)}</p>

          <div className="mt-8 space-y-4">
            {system === 'documentolog' && data.type === 'certificate' ? (
              <p>
                {e.department
                  ? tr('doc.certTextDept', { fio, company: e.company, position: e.position, dept: e.department.name, date: fmtDate(e.hire_date, 'dd.MM.yyyy') })
                  : tr('doc.certText', { fio, company: e.company, position: e.position, date: fmtDate(e.hire_date, 'dd.MM.yyyy') })}
                <br />
                {t('doc.certPurpose', { purpose: certPurposeLabel(String(data.details.purpose ?? CERT_PURPOSES[0].value)).toLowerCase() })}
              </p>
            ) : data.type === 'vacation' ? (
              <>
                <p>
                  {tr('doc.vacText', {
                    fio,
                    position: e.department ? `${e.position}, ${e.department.name}` : e.position,
                    tab: e.zup_id ?? '',
                    days: days(data.days),
                    from: fmtDate(data.start_date, 'dd.MM.yyyy'),
                    to: fmtDate(data.end_date, 'dd.MM.yyyy'),
                  })}
                </p>
                <p>{t('doc.vacBasis', { n: data.number })}</p>
                {system === 'documentolog' && <p>{t('doc.vacAck')}</p>}
              </>
            ) : data.type === 'advance' ? (
              <p>{tr('doc.advText', { fio, position: e.position, tab: e.zup_id ?? '', amount: <b>{money(data.amount)}</b>, n: data.number })}</p>
            ) : (
              <p>
                {tr('doc.dataText', {
                  fio,
                  field: data.details.field == null ? '' : dataFieldLabel(String(data.details.field)),
                  value: String(data.details.new_value ?? ''),
                  n: data.number,
                })}
              </p>
            )}
          </div>

          <div className="mt-14 grid grid-cols-2 gap-8 font-sans text-sm">
            <div>
              <div className="text-muted">{t('doc.hrDirector')}</div>
              <div className="mt-6 border-t border-ink/30 pt-1 text-xs text-muted">{t('doc.signedDemo')}</div>
            </div>
            <div>
              <div className="text-muted">{t('doc.employee')}</div>
              <div className="mt-6 border-t border-ink/30 pt-1 text-xs text-muted">{system === 'documentolog' ? t('doc.ackElectronic') : '–'}</div>
            </div>
          </div>
          <p className="mt-10 font-sans text-xs text-muted">{t('doc.demoNote', { system: systemName })}</p>
        </div>
      </div>
    </div>
  )
}
