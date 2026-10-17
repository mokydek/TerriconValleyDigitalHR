import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Building2, FileStack, GraduationCap, Lock, Mail, Palmtree, Pencil, Phone, RefreshCw, ShieldCheck, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useEmployee, useMyAssignments, useMyRequests, useVacationBalance } from '@/lib/api'
import { must, supabase } from '@/lib/supabase'
import { days, fmtDate, fmtDateTime, fullName } from '@/lib/format'
import { Badge, Button, Card, CardHeader, Field, Modal, PageHeader, Progress, Skeleton, Tabs } from '@/components/ui'
import { requestSummary, StatusBadge, TypeLabel } from '@/components/requests/RequestParts'
import { MyPhoto } from '@/components/profile/PhotoPicker'
import { useQueryClient } from '@tanstack/react-query'
import { TabLabel, useTabParam } from '@/lib/tabs'
import type { HrRequest } from '@/lib/types'

function Item({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="py-2.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={`mt-0.5 font-medium text-ink ${mono ? 'tabular-nums' : ''}`}>{value || '–'}</dd>
    </div>
  )
}

const PROFILE_TABS = ['data', 'vacation', 'learning', 'requests'] as const
type ProfileTab = (typeof PROFILE_TABS)[number]

export default function ProfilePage() {
  const { me } = useAuth()
  const { t } = useI18n()
  const emp = useEmployee(me?.id)
  const balance = useVacationBalance()
  const assignments = useMyAssignments()
  const requests = useMyRequests()
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useTabParam<ProfileTab>(PROFILE_TABS, 'data')
  if (!me) return null
  const priv = emp.data?.priv
  const b = balance.data
  const fullFio = [me.last_name, me.first_name, me.middle_name].filter(Boolean).join(' ')
  const vacations = (requests.data ?? []).filter((r) => r.type === 'vacation')
  const icon = 'h-4 w-4'

  return (
    <div>
      <PageHeader
        title={t('nav.profile')}
        actions={
          <Link to="/requests?new=data_change">
            <Button variant="outline" icon={<Pencil className="h-4 w-4" />}>
              {t('profile.requestChange')}
            </Button>
          </Link>
        }
      />

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <MyPhoto size={64} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">{fullFio}</h2>
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

      <Tabs<ProfileTab>
        value={tab}
        onChange={setTab}
        className="mt-5 mb-4"
        items={[
          { value: 'data', label: <TabLabel icon={<UserRound className={icon} />}>{t('profile.tabData')}</TabLabel> },
          { value: 'vacation', label: <TabLabel icon={<Palmtree className={icon} />}>{t('profile.tabVacation')}</TabLabel> },
          {
            value: 'learning',
            label: <TabLabel icon={<GraduationCap className={icon} />}>{t('profile.tabLearning')}</TabLabel>,
            count: (assignments.data ?? []).filter((a) => a.status !== 'completed').length,
          },
          {
            value: 'requests',
            label: <TabLabel icon={<FileStack className={icon} />}>{t('profile.tabRequests')}</TabLabel>,
            count: (requests.data ?? []).filter((r) => r.status === 'pending' || r.status === 'approved' || r.status === 'processing').length,
          },
        ]}
      />

      {tab === 'data' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Card className="min-w-0">
            <CardHeader
              icon={<Lock className="h-[18px] w-[18px]" />}
              title={t('profile.official')}
              subtitle={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {t('profile.source')} · {t('common.readOnly')}
                  {me.synced_at && (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <RefreshCw className="h-3 w-3" /> {fmtDateTime(me.synced_at)}
                    </span>
                  )}
                </span>
              }
            />
            <dl className="grid gap-x-8 px-5 pb-4 sm:grid-cols-2">
              <Item label={t('profile.fullName')} value={fullFio} />
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
              Нашли ошибку? Оформите заявку «Изменение данных», HR исправит её в 1С:ЗУП.
            </div>
          </Card>

          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader
                icon={<Lock className="h-[18px] w-[18px]" />}
                title={t('profile.private')}
                subtitle="Видите только вы и HR"
                action={
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
                    Изменить
                  </Button>
                }
              />
              {emp.isLoading ? (
                <Skeleton className="mx-5 mb-5 h-20" />
              ) : (
                <dl className="px-5 pb-4">
                  <Item label="ИИН" value={priv?.iin ? `${priv.iin.slice(0, 4)}••••${priv.iin.slice(-2)}` : null} mono />
                  <Item label="Дата рождения" value={priv?.birth_date ? fmtDate(priv.birth_date) : null} />
                  <Item label="Личный телефон" value={priv?.personal_phone} />
                  <Item label="Адрес" value={priv?.address} />
                  <Item label="Контакт для экстренной связи" value={priv?.emergency_contact} />
                </dl>
              )}
            </Card>
            <Card className="p-5">
              <div className="text-sm font-semibold">Рабочие контакты</div>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-ink-soft">
                  <Mail className="h-4 w-4 text-muted" /> {me.email}
                </div>
                <div className="flex items-center gap-2 text-ink-soft">
                  <Phone className="h-4 w-4 text-muted" /> {me.phone ?? '–'}
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'vacation' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.5fr]">
          <Card className="min-w-0 p-5">
            <div className="text-sm text-muted">
              {t('vac.balance')}, {b?.year ?? new Date().getFullYear()}
            </div>
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
          <Card className="min-w-0">
            <CardHeader title="Мои отпуска" />
            <RequestList items={vacations} empty="Заявок на отпуск пока нет" />
          </Card>
        </div>
      )}

      {tab === 'learning' && (
        <Card className="max-w-3xl">
          <CardHeader
            title={t('profile.tabLearning')}
            action={
              <Link to="/academy" className="text-sm font-medium text-brand-700 hover:underline">
                Jana Academy
              </Link>
            }
          />
          <ul className="space-y-4 px-5 pb-5">
            {(assignments.data ?? []).length === 0 && <li className="py-4 text-center text-sm text-muted">Назначенных курсов нет</li>}
            {(assignments.data ?? []).map((a) => (
              <li key={a.id}>
                <Link to={`/academy/${a.course?.slug}`} className="block">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium">
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
      )}

      {tab === 'requests' && (
        <Card className="max-w-3xl">
          <CardHeader
            title={t('profile.tabRequests')}
            action={
              <Link to="/requests" className="text-sm font-medium text-brand-700 hover:underline">
                {t('home.allRequests')}
              </Link>
            }
          />
          <RequestList items={(requests.data ?? []).slice(0, 10)} empty={t('home.noRequests')} />
        </Card>
      )}
      <EditContacts open={editing} onClose={() => setEditing(false)} initial={priv ?? null} />
    </div>
  )
}

function RequestList({ items, empty }: { items: HrRequest[]; empty: string }) {
  if (items.length === 0) return <p className="px-5 pb-6 text-center text-sm text-muted">{empty}</p>
  return (
    <ul className="divide-y divide-line border-t border-line">
      {items.map((r) => (
        <li key={r.id}>
          <Link to="/requests" className="flex items-center gap-3 px-5 py-3 transition hover:bg-canvas">
            <div className="min-w-0 flex-1">
              <TypeLabel type={r.type} />
              <div className="truncate text-xs text-muted">
                №{r.number} · {requestSummary(r)}
              </div>
            </div>
            <StatusBadge status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
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
