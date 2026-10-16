import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  BookOpen,
  Building2,
  ChartColumnBig,
  CheckCheck,
  ClipboardList,
  FileStack,
  GraduationCap,
  HeartPulse,
  Home,
  Inbox,
  LogOut,
  Megaphone,
  Menu,
  MessagesSquare,
  Plug,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { useMarkAllRead, useMarkNotificationRead, useNotifications } from '@/lib/api'
import { fullName, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar, Badge } from '@/components/ui'
import { AssistantWidget } from '@/components/assistant/AssistantWidget'
import type { Role } from '@/lib/types'

interface NavItem {
  to: string
  key: I18nKey
  icon: ReactNode
  roles?: Role[]
  end?: boolean
}

interface NavGroup {
  key?: I18nKey
  roles?: Role[]
  items: NavItem[]
}

const ICON = 'h-[18px] w-[18px]'

const NAV: NavGroup[] = [
  {
    items: [
      { to: '/', key: 'nav.home', icon: <Home className={ICON} />, roles: ['employee', 'manager'], end: true },
      { to: '/', key: 'nav.pulse', icon: <HeartPulse className={ICON} />, roles: ['hr'], end: true },
      { to: '/profile', key: 'nav.profile', icon: <UserRound className={ICON} /> },
      { to: '/requests', key: 'nav.requests', icon: <FileStack className={ICON} /> },
      { to: '/academy', key: 'nav.academy', icon: <GraduationCap className={ICON} /> },
      { to: '/assistant', key: 'nav.assistant', icon: <Sparkles className={ICON} /> },
      { to: '/tasks', key: 'nav.tasks', icon: <ClipboardList className={ICON} /> },
      { to: '/announcements', key: 'nav.announcements', icon: <Megaphone className={ICON} /> },
    ],
  },
  {
    key: 'nav.management',
    roles: ['manager', 'hr'],
    items: [
      { to: '/approvals', key: 'nav.approvals', icon: <Inbox className={ICON} />, roles: ['manager'] },
      { to: '/approvals', key: 'nav.hrRequests', icon: <Inbox className={ICON} />, roles: ['hr'] },
      { to: '/team', key: 'nav.team', icon: <Users className={ICON} />, roles: ['manager'] },
      { to: '/employees', key: 'nav.employees', icon: <Users className={ICON} />, roles: ['hr'] },
      { to: '/analytics', key: 'nav.analytics', icon: <ChartColumnBig className={ICON} /> },
      { to: '/tickets', key: 'nav.tickets', icon: <MessagesSquare className={ICON} />, roles: ['hr'] },
      { to: '/integrations', key: 'nav.integrations', icon: <Plug className={ICON} />, roles: ['hr'] },
    ],
  },
  {
    key: 'nav.company',
    items: [{ to: '/knowledge', key: 'nav.knowledge', icon: <BookOpen className={ICON} /> }],
  },
]

function visible<T extends { roles?: Role[] }>(items: T[], role: Role): T[] {
  return items.filter((i) => !i.roles || i.roles.includes(role))
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2.5', className)}>
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-sm">
        <span className="text-[15px] font-extrabold tracking-tight">J</span>
      </div>
      <div className="leading-none">
        <div className="text-[17px] font-extrabold tracking-tight text-ink">
          JANA<span className="text-brand-600">Мен</span>
        </div>
        <div className="mt-1 text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">Jana Post HR</div>
      </div>
    </Link>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { me, role, signOut } = useAuth()
  const { t } = useI18n()
  if (!me || !role) return null
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-4">
        <Logo />
      </div>
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
        {NAV.filter((g) => !g.roles || g.roles.includes(role)).map((group, gi) => {
          const items = visible(group.items, role)
          if (!items.length) return null
          return (
            <div key={gi} className={cn(gi > 0 && 'mt-5')}>
              {group.key && <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted/80 uppercase">{t(group.key)}</div>}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.key}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-xl px-3 py-2 text-[14.5px] font-medium transition',
                          isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-canvas hover:text-ink',
                        )
                      }
                    >
                      {item.icon}
                      {t(item.key)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <Avatar name={fullName(me)} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{fullName(me)}</div>
            <div className="truncate text-xs text-muted">{t(`role.${role}` as I18nKey)}</div>
          </div>
          <button onClick={() => void signOut()} className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-rose-600" title={t('nav.logout')}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function LangSwitch() {
  const { lang, setLang } = useI18n()
  return (
    <div className="inline-flex rounded-lg bg-canvas p-0.5 text-xs font-semibold" role="group" aria-label="Язык интерфейса">
      {(['ru', 'kk'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={cn('rounded-md px-2 py-1 transition', lang === l ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink')}
        >
          {l === 'ru' ? 'RU' : 'ҚАЗ'}
        </button>
      ))}
    </div>
  )
}

const KIND_DOT: Record<string, string> = {
  success: 'bg-brand-500',
  warning: 'bg-amber-500',
  request: 'bg-sky-500',
  course: 'bg-violet-500',
  task: 'bg-indigo-500',
  ticket: 'bg-rose-500',
  announcement: 'bg-teal-500',
  info: 'bg-slate-400',
}

function NotificationsBell() {
  const { data = [] } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllRead()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const unread = data.filter((n) => !n.read_at).length
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-10 w-10 place-items-center rounded-xl text-ink-soft transition hover:bg-canvas hover:text-ink"
        aria-label={t('notif.title')}
        data-testid="notifications-bell"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)] animate-fade-in">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-semibold">{t('notif.title')}</span>
              {unread > 0 && (
                <button onClick={() => markAll.mutate()} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                  <CheckCheck className="h-3.5 w-3.5" /> {t('notif.markAll')}
                </button>
              )}
            </div>
            <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
              {data.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">{t('notif.empty')}</p>}
              {data.slice(0, 12).map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.read_at) markRead.mutate(n.id)
                    setOpen(false)
                    if (n.link) navigate(n.link)
                  }}
                  className={cn('flex w-full gap-3 border-b border-line/70 px-4 py-3 text-left transition hover:bg-canvas', !n.read_at && 'bg-brand-50/40')}
                >
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-line' : KIND_DOT[n.kind] ?? 'bg-slate-400')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-muted/80">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
            <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-canvas">
              Все уведомления
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

function MobileTabBar() {
  const { role } = useAuth()
  const { t } = useI18n()
  const items: { to: string; key: I18nKey; icon: ReactNode; end?: boolean }[] = [
    { to: '/', key: role === 'hr' ? 'nav.pulse' : 'nav.home', icon: role === 'hr' ? <HeartPulse className="h-5 w-5" /> : <Home className="h-5 w-5" />, end: true },
    role === 'employee'
      ? { to: '/requests', key: 'nav.requests', icon: <FileStack className="h-5 w-5" /> }
      : { to: '/approvals', key: role === 'hr' ? 'nav.hrRequests' : 'nav.approvals', icon: <Inbox className="h-5 w-5" /> },
    { to: '/academy', key: 'nav.academy', icon: <GraduationCap className="h-5 w-5" /> },
    { to: '/assistant', key: 'nav.assistant', icon: <Sparkles className="h-5 w-5" /> },
    { to: '/profile', key: 'nav.profile', icon: <UserRound className="h-5 w-5" /> },
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid grid-cols-5">
        {items.map((it) => (
          <li key={it.to + it.key}>
            <NavLink
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cn('flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium', isActive ? 'text-brand-700' : 'text-muted')
              }
            >
              {it.icon}
              <span className="max-w-full truncate px-1">{t(it.key)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { me, role } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[264px] border-r border-line bg-white lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-white shadow-[var(--shadow-pop)] animate-slide-in">
            <button className="absolute top-4 right-3 rounded-lg p-2 text-muted" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 border-b border-line/80 bg-canvas/85 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
            <button className="rounded-xl p-2 text-ink-soft hover:bg-white lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Меню">
              <Menu className="h-5 w-5" />
            </button>
            <div className="lg:hidden">
              <Logo />
            </div>
            <div className="hidden min-w-0 items-center gap-2 text-sm text-muted lg:flex">
              <Building2 className="h-4 w-4" />
              <span className="truncate">{me?.company}</span>
              {me?.department?.name && <span className="truncate">· {me.department.name}</span>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {role && <Badge className="hidden bg-white text-ink-soft ring-line sm:inline-flex">{t(`role.${role}` as I18nKey)}</Badge>}
              <LangSwitch />
              <NotificationsBell />
            </div>
          </div>
        </header>
        <main key={location.pathname} className="mx-auto max-w-[1400px] px-4 pt-6 pb-28 sm:px-6 lg:pb-12 animate-fade-in">
          {children}
        </main>
      </div>
      <MobileTabBar />
      {!location.pathname.startsWith('/assistant') && <AssistantWidget />}
    </div>
  )
}
