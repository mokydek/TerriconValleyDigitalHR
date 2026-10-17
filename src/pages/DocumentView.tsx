import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { must, supabase } from '@/lib/supabase'
import { days, fmtDate, money } from '@/lib/format'
import type { Employee, HrRequest } from '@/lib/types'
import { Button, Card, Empty, PageLoader } from '@/components/ui'

/** Демо-представление документа, сформированного во внешней системе (mock 1С:ЗУП / Documentolog) */
export default function DocumentViewPage() {
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
        <Empty title="Документ недоступен" text="Документ виден только сотруднику, его руководителю и HR" />
      </Card>
    )

  const e = data.employee
  const fio = [e.last_name, e.first_name, e.middle_name].filter(Boolean).join(' ')
  const doc = system === 'documentolog' ? data.integration.documentolog : data.integration.zup
  const title =
    system === 'documentolog'
      ? data.type === 'certificate'
        ? 'СПРАВКА С МЕСТА РАБОТЫ'
        : 'ЛИСТ ОЗНАКОМЛЕНИЯ С ПРИКАЗОМ'
      : data.type === 'vacation'
        ? 'ПРИКАЗ О ПРЕДОСТАВЛЕНИИ ЕЖЕГОДНОГО ОПЛАЧИВАЕМОГО ТРУДОВОГО ОТПУСКА'
        : data.type === 'advance'
          ? 'ВЕДОМОСТЬ НА ВЫПЛАТУ АВАНСА'
          : 'ЗАЯВЛЕНИЕ НА ИЗМЕНЕНИЕ ПЕРСОНАЛЬНЫХ ДАННЫХ'

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex items-center justify-between">
        <Link to="/requests" className="text-sm text-muted hover:text-brand-700">
          ← Назад
        </Link>
        <Button variant="outline" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
          Печать / PDF
        </Button>
      </div>
      <div className="print-sheet relative overflow-hidden rounded-2xl border border-line bg-white p-8 font-serif text-[15px] leading-relaxed text-ink shadow-[var(--shadow-card)] sm:p-12">
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-6xl font-black tracking-widest text-ink/[0.04] select-none" style={{ transform: 'rotate(-24deg)' }}>
          ДЕМО · MOCK
        </div>
        <div className="relative">
          <div className="flex items-start justify-between gap-4 font-sans text-xs text-muted">
            <div>
              <div className="font-bold text-ink">{e.company}</div>
              <div>г. Алматы</div>
            </div>
            <div className="text-right">
              <div>{system === 'documentolog' ? 'Documentolog' : '1С:ЗУП'}</div>
              <div className="font-semibold text-ink">{doc?.id ?? '–'}</div>
            </div>
          </div>
          <h1 className="mt-10 text-center text-lg font-bold">{title}</h1>
          <p className="mt-1 text-center text-sm text-muted">{doc?.document ?? ''}</p>

          <div className="mt-8 space-y-4">
            {system === 'documentolog' && data.type === 'certificate' ? (
              <p>
                Настоящая справка выдана <b>{fio}</b> в том, что он(а) действительно работает в {e.company} в должности «{e.position}»
                {e.department ? ` (подразделение «${e.department.name}»)` : ''} с {fmtDate(e.hire_date, 'dd.MM.yyyy')} по настоящее время.
                <br />
                Справка выдана для предъявления: {String(data.details.purpose ?? 'по месту требования').toLowerCase()}.
              </p>
            ) : data.type === 'vacation' ? (
              <>
                <p>
                  Предоставить <b>{fio}</b>, {e.position}
                  {e.department ? `, ${e.department.name}` : ''} (таб. № {e.zup_id}), ежегодный оплачиваемый трудовой отпуск продолжительностью {days(data.days)} с{' '}
                  {fmtDate(data.start_date, 'dd.MM.yyyy')} по {fmtDate(data.end_date, 'dd.MM.yyyy')}.
                </p>
                <p>Основание: заявление работника № {data.number}, согласованное руководителем в JanaMen.</p>
                {system === 'documentolog' && <p>С приказом ознакомлен(а) электронно в Documentolog.</p>}
              </>
            ) : data.type === 'advance' ? (
              <p>
                Выплатить <b>{fio}</b>, {e.position} (таб. № {e.zup_id}), аванс в счёт заработной платы в размере <b>{money(data.amount)}</b>. Основание: заявка № {data.number}.
              </p>
            ) : (
              <p>
                Работник <b>{fio}</b> просит внести изменения: {String(data.details.field ?? '')} → «{String(data.details.new_value ?? '')}». Основание: заявка № {data.number}.
              </p>
            )}
          </div>

          <div className="mt-14 grid grid-cols-2 gap-8 font-sans text-sm">
            <div>
              <div className="text-muted">HR-директор</div>
              <div className="mt-6 border-t border-ink/30 pt-1 text-xs text-muted">подписано ЭЦП в Documentolog (демо)</div>
            </div>
            <div>
              <div className="text-muted">Работник</div>
              <div className="mt-6 border-t border-ink/30 pt-1 text-xs text-muted">{system === 'documentolog' ? 'ознакомлен(а) электронно' : '–'}</div>
            </div>
          </div>
          <p className="mt-10 font-sans text-xs text-muted">
            Демонстрационный документ, сформированный mock-адаптером. В промышленной версии документ создаётся в {system === 'documentolog' ? 'Documentolog' : '1С:ЗУП'} и открывается по ссылке из системы.
          </p>
        </div>
      </div>
    </div>
  )
}
