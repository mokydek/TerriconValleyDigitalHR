import { useState } from 'react'
import { ArrowRight, Briefcase, UserRound, UsersRound } from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button, Field } from '@/components/ui'
import { LanguageMenu } from '@/components/LanguageMenu'
import { LoginArt } from '@/components/LoginArt'

const DEMO_PASSWORD = 'Jana2026!'

const DEMO = [
  {
    email: 'employee@jana.test',
    role: 'role.employee',
    name: 'Дана Жумабекова', // i18n-ignore: имя из демо-данных
    position: 'login.posEmployee',
    icon: <UserRound className="h-5 w-5" />,
    tone: 'from-brand-500 to-brand-700',
  },
  {
    email: 'manager@jana.test',
    role: 'role.manager',
    name: 'Ерлан Сапаров', // i18n-ignore
    position: 'login.posManager',
    icon: <Briefcase className="h-5 w-5" />,
    tone: 'from-brand-700 to-brand-900',
  },
  {
    email: 'hr@jana.test',
    role: 'role.hr',
    name: 'Айгерим Нурланова', // i18n-ignore
    position: 'login.posHr',
    icon: <UsersRound className="h-5 w-5" />,
    tone: 'from-ink-soft to-ink',
  },
] as const

export default function LoginPage() {
  const { signIn } = useAuth()
  const { t } = useI18n()
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
    // grid-cols-1 (minmax(0, 1fr)): без него колонка на телефоне растягивается по строке с truncate и страница шире экрана
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      {/* Бренд-панель: живой фон с маршрутами, без лишнего текста */}
      <div className="relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <LoginArt />
        <div className="relative animate-fade-in">
          <div className="text-[32px] leading-none font-extrabold tracking-tight">
            JANA <span className="text-brand-300">POST</span>
          </div>
        </div>
        <div className="relative max-w-xl animate-rise">
          <h1 className="text-6xl leading-[1.02] font-extrabold tracking-tight">
            <span className="login-word">Jana</span>
            <span className="text-brand-300">Men</span>
          </h1>
          <p className="mt-5 max-w-md text-xl leading-relaxed text-white/85">{t('login.tagline')}</p>
        </div>
        <div className="relative text-sm text-white/55">{t('login.footerBrand')}</div>
      </div>

      {/* Форма */}
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center justify-between">
            <div className="text-2xl font-extrabold tracking-tight lg:hidden">
              Jana<span className="text-brand-600">Men</span>
            </div>
            <div className="ml-auto">
              <LanguageMenu variant="login" />
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight">{t('login.title')}</h2>
          <p className="mt-1.5 text-muted">{t('login.subtitle')}</p>

          <div className="mt-7">
            <div className="text-sm font-semibold text-ink-soft">{t('login.demo')}</div>
            <p className="mt-0.5 mb-2.5 text-xs text-muted" data-testid="login-tabs-hint">{t('login.tabsHint')}</p>
            <div className="space-y-2.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  onClick={() => void login(d.email, DEMO_PASSWORD)}
                  disabled={Boolean(busy)}
                  className="lift group flex w-full items-center gap-3.5 rounded-2xl border border-line bg-white p-3.5 text-left shadow-[var(--shadow-card)] hover:border-brand-300 disabled:opacity-60"
                  data-testid={`demo-${d.email.split('@')[0]}`}
                >
                  <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white', d.tone)}>{d.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">{t(d.role)}</div>
                    <div className="truncate text-sm text-muted">
                      {d.name} · {t(d.position)}
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
              {t('login.newbie')}
            </button>
          </div>

          <div className="my-7 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-line" /> {t('login.orEmail')} <div className="h-px flex-1 bg-line" />
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
          <p className="mt-6 text-center text-xs text-muted">{t('login.footer', { password: DEMO_PASSWORD })}</p>
        </div>
      </div>
    </div>
  )
}
