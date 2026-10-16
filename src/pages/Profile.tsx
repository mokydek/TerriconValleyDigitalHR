import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Building2, Lock, Mail, Pencil, Phone, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useEmployee, useMyAssignments, useMyRequests, useVacationBalance } from '@/lib/api'
import { must, supabase } from '@/lib/supabase'
import { days, fmtDate, fmtDateTime, fullName } from '@/lib/format'
import { Avatar, Badge, Button, Card, CardHeader, Field, Modal, PageHeader, Progress, Skeleton } from '@/components/ui'
import { requestSummary, StatusBadge, TypeLabel } from '@/components/requests/RequestParts'
import { useQueryClient } from '@tanstack/react-query'

function Item({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="py-2.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={`mt-0.5 font-medium text-ink ${mono ? 'tabular-nums' : ''}`}>{value || '—'}</dd>
    </div>
  )
}

export default function ProfilePage() {
  const { me } = useAuth()
  const { t } = useI18n()
  const emp = useEmployee(me?.id)
  const balance = useVacationBalance()
  const assignments = useMyAssignments()
  const requests = useMyRequests()
  const [editing, setEditing] = useState(false)
  if (!me) return null
  const priv = emp.data?.priv
  const b = balance.data

  return (
    <div>
      <PageHeader
        title={t('profile.title')}
        subtitle="Профиль, остаток отпуска, обучение и заявки — всё о вас в одном месте"
        actions={
          <Link to="/requests?new=data_change">
            <Button variant="outline" icon={<Pencil className="h-4 w-4" />}>
              {t('profile.requestChange')}
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Avatar name={fullName(me)} size={72} />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold">{[me.last_name, me.first_name, me.middle_name].filter(Boolean).join(' ')}</h2>
                <p className="text-muted">
                  {me.position} · {me.department?.name}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge className="bg-brand-50 text-brand-700 ring-brand-200">
                    <BadgeCheck className="h-3.5 w-3.5" /> {t(`role.${me.role}`)}
                  </Badge>
                  <Badge className="bg-canvas text-ink-soft ring-line">
                    <Building2 className="h-3.5 w-3.5" /> {me.company}
                  </Badge>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={<Lock className="h-[18px] w-[18px]" />}
              title={t('profile.official')}
              subtitle={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {t('profile.source')} · {t('common.readOnly')}
                  {me.synced_at && (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <RefreshCw className="h-3 w-3" /> синхронизировано {fmtDateTime(me.synced_at)}
                    </span>
                  )}
                </span>
              }
            />
            <dl className="grid gap-x-8 px-5 pb-4 sm:grid-cols-2">
              <Item label={t('profile.fullName')} value={[me.last_name, me.first_name, me.middle_name].filter(Boolean).join(' ')} />
              <Item label={t('profile.company')} value={me.company} />
              <Item label={t('profile.position')} value={me.position} />
              <Item label={t('profile.department')} value={me.department?.name} />
              <Item label={t('profile.manager')} value={me.manager ? `${fullName(me.manager)}, ${me.manager.position}` : null} />
              <Item label={t('profile.hireDate')} value={fmtDate(me.hire_date)} />
              <Item label={t('profile.location')} value={me.location ? `${me.location.name}, ${me.location.city}` : null} />
              <Item label={t('profile.tabNo')} value={me.zup_id} mono />
            </dl>
            <div className="mx-5 mb-5 flex items-start gap-2.5 rounded-xl bg-canvas px-4 py-3 text-sm text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              Официальные кадровые данные ведутся в 1С:ЗУП. Нашли ошибку? Оформите заявку «Изменение данных» — HR исправит в 1С, и профиль обновится после синхронизации.
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={<Lock className="h-[18px] w-[18px]" />}
              title={t('profile.private')}
              subtitle="Видите только вы и HR — руководитель и коллеги эти данные не получают"
              action={
                <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
                  Контакты
                </Button>
              }
            />
            {emp.isLoading ? (
              <Skeleton className="mx-5 mb-5 h-20" />
            ) : (
              <dl className="grid gap-x-8 px-5 pb-4 sm:grid-cols-2">
                <Item label="ИИН" value={priv?.iin ? `${priv.iin.slice(0, 4)}••••${priv.iin.slice(-2)}` : null} mono />
                <Item label="Дата рождения" value={priv?.birth_date ? fmtDate(priv.birth_date) : null} />
                <Item label="Личный телефон" value={priv?.personal_phone} />
                <Item label="Адрес" value={priv?.address} />
                <Item label="Контакт для экстренной связи" value={priv?.emergency_contact} />
              </dl>
            )}
          </Card>

          <Card>
            <CardHeader title="Мои заявки" subtitle="Последние" action={<Link to="/requests" className="text-sm font-medium text-brand-700 hover:underline">Все</Link>} />
            <ul className="divide-y divide-line border-t border-line">
              {(requests.data ?? []).slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <TypeLabel type={r.type} />
                    <div className="truncate text-xs text-muted">
                      №{r.number} · {requestSummary(r)}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="text-sm text-muted">{t('vac.balance')} на {b?.year ?? new Date().getFullYear()} год</div>
            {b ? (
              <>
                <div className="mt-1 text-4xl font-bold tracking-tight text-brand-700">{days(b.available)}</div>
                <Progress value={b.entitled ? ((b.used + b.reserved) / b.entitled) * 100 : 0} className="mt-4" />
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-xl bg-canvas p-2.5">
                    <div className="font-semibold">{days(b.entitled)}</div>
                    <div className="text-xs text-muted">{t('vac.entitled')}</div>
                  </div>
                  <div className="rounded-xl bg-canvas p-2.5">
                    <div className="font-semibold">{days(b.used)}</div>
                    <div className="text-xs text-muted">{t('vac.used')}</div>
                  </div>
                  <div className="rounded-xl bg-canvas p-2.5">
                    <div className="font-semibold">{days(b.reserved)}</div>
                    <div className="text-xs text-muted">{t('vac.reserved')}</div>
                  </div>
                </div>
                <Link to="/requests?new=vacation" className="mt-4 block">
                  <Button className="w-full">{t('home.qVacation')}</Button>
                </Link>
              </>
            ) : (
              <Skeleton className="mt-2 h-24" />
            )}
          </Card>

          <Card>
            <CardHeader title="Обучение" subtitle="Назначенные курсы и результаты" action={<Link to="/academy" className="text-sm font-medium text-brand-700 hover:underline">Academy</Link>} />
            <ul className="space-y-3 px-5 pb-5">
              {(assignments.data ?? []).map((a) => (
                <li key={a.id}>
                  <Link to={`/academy/${a.course?.slug}`} className="block">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">
                        {a.course?.emoji} {a.course?.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{a.status === 'completed' ? `тест ${a.score}%` : `${a.progress}%`}</span>
                    </div>
                    <Progress value={a.progress} className="mt-1.5 h-1.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <div className="text-sm font-semibold">Рабочие контакты</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-ink-soft">
                <Mail className="h-4 w-4 text-muted" /> {me.email}
              </div>
              <div className="flex items-center gap-2 text-ink-soft">
                <Phone className="h-4 w-4 text-muted" /> {me.phone ?? '—'}
              </div>
            </div>
          </Card>
        </div>
      </div>
      <EditContacts open={editing} onClose={() => setEditing(false)} initial={priv ?? null} />
    </div>
  )
}

function EditContacts({
  open,
  onClose,
  initial,
}: {
  open: boolean
  onClose: () => void
  initial: { personal_phone: string | null; address: string | null; emergency_contact: string | null } | null
}) {
  const { me } = useAuth()
  const qc = useQueryClient()
  const [phone, setPhone] = useState(initial?.personal_phone ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [emergency, setEmergency] = useState(initial?.emergency_contact ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Личные контакты"
      subtitle="Эти поля вы можете менять сами. ИИН, дату рождения и оклад меняет только 1С:ЗУП."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await must(
                  supabase
                    .from('employee_private')
                    .update({ personal_phone: phone || null, address: address || null, emergency_contact: emergency || null })
                    .eq('employee_id', me!.id),
                )
                await qc.invalidateQueries({ queryKey: ['employee', me!.id] })
                toast.success('Контакты сохранены')
                onClose()
              } catch (e) {
                toast.error((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Личный телефон">
          <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 7xx xxx xx xx" />
        </Field>
        <Field label="Адрес проживания">
          <input className="field" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Контакт для экстренной связи">
          <input className="field" value={emergency} onChange={(e) => setEmergency(e.target.value)} placeholder="ФИО, кем приходится, телефон" />
        </Field>
      </div>
    </Modal>
  )
}
