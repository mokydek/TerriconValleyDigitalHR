import { useState } from 'react'
import { ArrowRight, BadgeCheck, Briefcase, GraduationCap, Sparkles, UserRound, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button, Field } from '@/components/ui'

const DEMO_PASSWORD = 'Jana2026!'

const DEMO = [
  {
    email: 'employee@jana.test',
    role: 'Работник',
    name: 'Дана Жумабекова',
    position: 'Старший оператор сортировки',
    icon: <UserRound className="h-5 w-5" />,
    tone: 'from-brand-500 to-brand-700',
  },
  {
    email: 'manager@jana.test',
    role: 'Руководитель',
    name: 'Ерлан Сапаров',
    position: 'Руководитель склада и сортировки',
    icon: <Briefcase className="h-5 w-5" />,
    tone: 'from-sky-500 to-sky-700',
  },
  {
    email: 'hr@jana.test',
    role: 'HR / администратор',
    name: 'Айгерим Нурланова',
    position: 'HR-директор · «Пульс компании»',
    icon: <UsersRound className="h-5 w-5" />,
    tone: 'from-violet-500 to-violet-700',
  },
]

const PATH = ['Вход и роль', 'Профиль', 'Заявка', 'Обучение', 'HR-ассистент']

export default function LoginPage() {
  const { signIn } = useAuth()
  const { t, lang, setLang } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const login = async (e: string, p: string) => {
    setBusy(e)
    try {
      await signIn(e, p)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Бренд-панель */}
      <div className="relative hidden overflow-hidden bg-[#0f2a12] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-40" viewBox="0 0 800 800" preserveAspectRatio="none" aria-hidden>
          {Array.from({ length: 9 }).map((_, i) => (
            <path key={i} d={`M ${-200 + i * 40} 900 Q ${300 + i * 30} ${420 - i * 25} ${1000} ${-100 + i * 35}`} stroke="#4eb34a" strokeWidth="1" fill="none" opacity={0.25 + i * 0.06} />
          ))}
        </svg>
        <div className="relative">
          <div className="text-[32px] leading-none font-extrabold tracking-tight">
            JANA <span className="text-brand-300">POST</span>
          </div>
          <div className="mt-1 text-sm text-white/60">× Terricon Valley Hackathon · Digital HR</div>
        </div>
        <div className="relative max-w-xl">
          <h1 className="text-5xl leading-[1.05] font-extrabold tracking-tight">
            Jana<span className="text-brand-300">Men</span>
          </h1>
          <p className="mt-4 text-xl text-white/85">Одна платформа для сотрудника: профиль, заявки, обучение и HR-помощь — в одном окне.</p>
          <ol className="mt-10 grid grid-cols-5 gap-3">
            {PATH.map((p, i) => (
              <li key={p}>
                <div className="text-3xl font-extrabold text-brand-300">{String(i + 1).padStart(2, '0')}</div>
                <div className="mt-2 h-px bg-white/25" />
                <div className="mt-2 text-xs font-semibold tracking-wide text-white/80 uppercase">{p}</div>
              </li>
            ))}
          </ol>
        </div>
        <div className="relative flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
          <span className="inline-flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-brand-300" /> Данные из 1С:ЗУП
          </span>
          <span className="inline-flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-brand-300" /> Jana Academy
          </span>
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-300" /> AI Jana с источниками
          </span>
        </div>
      </div>

      {/* Форма */}
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center justify-between">
            <div className="text-2xl font-extrabold tracking-tight lg:hidden">
              Jana<span className="text-brand-600">Men</span>
            </div>
            <div className="ml-auto inline-flex rounded-lg bg-white p-0.5 text-xs font-semibold ring-1 ring-line">
              {(['ru', 'kk'] as const).map((l) => (
                <button key={l} onClick={() => setLang(l)} className={cn('rounded-md px-2.5 py-1', lang === l ? 'bg-brand-600 text-white' : 'text-muted')}>
                  {l === 'ru' ? 'RU' : 'ҚАЗ'}
                </button>
              ))}
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight">{t('login.title')}</h2>
          <p className="mt-1.5 text-muted">{t('login.subtitle')}</p>

          <div className="mt-7">
            <div className="mb-2.5 text-sm font-semibold text-ink-soft">{t('login.demo')}</div>
            <div className="space-y-2.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  onClick={() => void login(d.email, DEMO_PASSWORD)}
                  disabled={Boolean(busy)}
                  className="group flex w-full items-center gap-3.5 rounded-2xl border border-line bg-white p-3.5 text-left shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-[var(--shadow-pop)] disabled:opacity-60"
                  data-testid={`demo-${d.email.split('@')[0]}`}
                >
                  <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white', d.tone)}>{d.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">{d.role}</div>
                    <div className="truncate text-sm text-muted">
                      {d.name} · {d.position}
                    </div>
                  </div>
                  {busy === d.email ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                  ) : (
                    <ArrowRight className="h-5 w-5 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={() => void login('newbie@jana.test', DEMO_PASSWORD)}
              className="mt-2.5 text-sm text-muted underline-offset-2 hover:text-brand-700 hover:underline"
            >
              или войти как новый сотрудник (5-й день в компании)
            </button>
          </div>

          <div className="my-7 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-line" /> или по почте <div className="h-px flex-1 bg-line" />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void login(email.trim(), password)
            }}
            className="space-y-3.5"
          >
            <Field label={t('login.email')}>
              <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@jana.test" required />
            </Field>
            <Field label={t('login.password')}>
              <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={busy === email.trim()}>
              {t('login.submit')}
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-muted">Демо-стенд: все данные вымышленные. Пароль тестовых аккаунтов — {DEMO_PASSWORD}</p>
        </div>
      </div>
    </div>
  )
}
