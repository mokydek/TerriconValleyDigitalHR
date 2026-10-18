import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  BookOpen,
  Building2,
  Camera,
  ChartColumnBig,
  CheckCheck,
  ChevronDown,
  ClipboardList,
  FileStack,
  GraduationCap,
  HeartPulse,
  Home,
  Globe,
  Inbox,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  MessagesSquare,
  Plug,
  Trash2,
  UserRound,
  Users,
  X,
} from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { LANGS, useI18n, type I18nKey } from '@/lib/i18n'
import { serverText } from '@/lib/serverText'
import { useMarkAllRead, useMarkNotificationRead, useNotifications, useRealtimeNotifications } from '@/lib/api'
import { useAvatar, useRemoveAvatar } from '@/lib/avatars'
import { useChatUnread, useRealtimeChats } from '@/lib/chat'
import { fullName, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar, Badge } from '@/components/ui'
import { usePhotoPicker } from '@/components/profile/PhotoPicker'
import { AssistantWidget } from '@/components/assistant/AssistantWidget'
import { LanguageList, LanguageMenu } from '@/components/LanguageMenu'
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
      { to: '/requests', key: 'nav.requests', icon: <FileStack className={ICON} /> },
      { to: '/academy', key: 'nav.academy', icon: <GraduationCap className={ICON} /> },
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

/** compact: на самых узких телефонах в шапке остаётся только значок, чтобы поместились кнопки справа */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2.5', className)} aria-label="JanaMen">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-sm">
        <span className="text-[15px] font-extrabold tracking-tight">J</span>
      </div>
      <div className={cn('leading-none', compact && 'max-[399px]:hidden')}>
        <div className="text-[17px] font-extrabold tracking-tight text-ink">
          Jana<span className="text-brand-600">Men</span>
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
                          'group/nav flex items-center gap-3 rounded-xl px-3 py-2 text-[14.5px] font-medium transition active:scale-[0.98]',
                          isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:translate-x-0.5 hover:bg-canvas hover:text-ink',
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
          <Avatar id={me.id} name={fullName(me)} size={36} />
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
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
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
                    <span className="block text-sm font-medium text-ink">{serverText(n.title)}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{serverText(n.body)}</span>}
                    <span className="mt-1 block text-[11px] text-muted/80">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
            <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-canvas">
              {t('notif.all')}
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

function ChatButton() {
  const unread = useChatUnread()
  const { t } = useI18n()
  return (
    <Link
      to="/messages"
      className="relative grid h-10 w-10 place-items-center rounded-xl text-ink-soft transition hover:bg-canvas hover:text-ink"
      aria-label={t('nav.messages')}
      title={t('nav.messages')}
      data-testid="chat-button"
    >
      <MessageCircle className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute top-1.5 right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}

function MenuItem({ icon, children, onClick, to, danger }: { icon: ReactNode; children: ReactNode; onClick?: () => void; to?: string; danger?: boolean }) {
  const cls = cn(
    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14.5px] font-medium transition',
    danger ? 'text-rose-600 hover:bg-rose-50' : 'text-ink-soft hover:bg-canvas hover:text-ink',
  )
  return to ? (
    <Link to={to} onClick={onClick} className={cls} role="menuitem">
      {icon}
      {children}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} role="menuitem">
      {icon}
      {children}
    </button>
  )
}

/** Профиль справа сверху: фото, переход в профиль, смена фото, язык, выход */
function ProfileMenu() {
  const { me, role, signOut } = useAuth()
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const photo = usePhotoPicker()
  const hasPhoto = Boolean(useAvatar(me?.id))
  const removePhoto = useRemoveAvatar()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!me || !role) return null
  const close = () => {
    setOpen(false)
    setLangOpen(false)
  }
  return (
    <div className="relative">
      {photo.input}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="relative ml-0.5 rounded-full ring-2 ring-transparent transition hover:ring-brand-200 focus-visible:ring-brand-400"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('menu.open')}
        data-testid="profile-menu"
        data-role={me.role}
      >
        <Avatar id={me.id} name={fullName(me)} size={36} />
        {photo.busy && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-ink/40 text-white">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={close} />
          <div role="menu" className="absolute right-0 z-40 mt-2 w-[min(92vw,300px)] overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)] animate-fade-in">
            <div className="flex items-center gap-3 border-b border-line px-4 py-4">
              <button
                type="button"
                onClick={() => {
                  photo.pick()
                  close()
                }}
                className="group relative shrink-0 rounded-full"
                title={t('menu.changePhoto')}
                aria-label={t('menu.changePhoto')}
              >
                <Avatar id={me.id} name={fullName(me)} size={52} />
                <span className="absolute -right-0.5 -bottom-0.5 grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white ring-2 ring-white group-hover:bg-brand-700">
                  <Camera className="h-3.5 w-3.5" />
                </span>
              </button>
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">{fullName(me)}</div>
                <div className="truncate text-xs text-muted">{me.position}</div>
                <Badge className="mt-1.5 bg-brand-50 text-brand-700 ring-brand-200">{t(`role.${role}` as I18nKey)}</Badge>
              </div>
            </div>
            <div className="p-1.5">
              <MenuItem to="/profile" onClick={close} icon={<UserRound className="h-4 w-4" />}>
                {t('nav.profile')}
              </MenuItem>
              <MenuItem to="/messages" onClick={close} icon={<MessageCircle className="h-4 w-4" />}>
                {t('nav.messages')}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  photo.pick()
                  close()
                }}
                icon={<Camera className="h-4 w-4" />}
              >
                {t('menu.changePhoto')}
              </MenuItem>
              {hasPhoto && (
                <MenuItem
                  onClick={() => {
                    close()
                    removePhoto.mutate(undefined, {
                      onSuccess: () => toast.success(t('photo.removed')),
                      onError: (e) => toast.error((e as Error).message),
                    })
                  }}
                  icon={<Trash2 className="h-4 w-4" />}
                >
                  {t('menu.removePhoto')}
                </MenuItem>
              )}
              <button
                type="button"
                onClick={() => setLangOpen((o) => !o)}
                aria-expanded={langOpen}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14.5px] font-medium text-ink-soft transition hover:bg-canvas hover:text-ink"
                data-testid="menu-language"
              >
                <Globe className="h-4 w-4" />
                <span className="flex-1">{t('menu.language')}</span>
                <span className="text-xs text-muted">{LANGS.find((l) => l.code === lang)?.name}</span>
                <ChevronDown className={cn('h-4 w-4 text-muted transition', langOpen && 'rotate-180')} />
              </button>
              {langOpen && (
                <div className="mx-1 mb-1 rounded-xl bg-canvas/60">
                  <LanguageList onPicked={close} />
                </div>
              )}
            </div>
            <div className="border-t border-line p-1.5">
              <MenuItem danger onClick={() => void signOut()} icon={<LogOut className="h-4 w-4" />}>
                {t('nav.logout')}
              </MenuItem>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MobileTabBar() {
  const { role } = useAuth()
  const { t } = useI18n()
  // Короткие подписи nav.tab.*: полные названия меню («Пульс компании», «Jana Academy») не помещаются в 72 px
  const items: { to: string; key: I18nKey; icon: ReactNode; end?: boolean }[] = [
    { to: '/', key: role === 'hr' ? 'nav.tab.pulse' : 'nav.home', icon: role === 'hr' ? <HeartPulse className="h-5 w-5" /> : <Home className="h-5 w-5" />, end: true },
    role === 'employee'
      ? { to: '/requests', key: 'nav.tab.requests', icon: <FileStack className="h-5 w-5" /> }
      : { to: '/approvals', key: role === 'hr' ? 'nav.hrRequests' : 'nav.tab.approvals', icon: <Inbox className="h-5 w-5" /> },
    { to: '/tasks', key: 'nav.tab.tasks', icon: <ClipboardList className="h-5 w-5" /> },
    { to: '/academy', key: 'nav.tab.academy', icon: <GraduationCap className="h-5 w-5" /> },
    { to: '/announcements', key: 'nav.announcements', icon: <Megaphone className="h-5 w-5" /> },
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
                cn('flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium transition active:scale-90', isActive ? 'text-brand-700 [&>svg]:animate-bump' : 'text-muted')
              }
            >
              {it.icon}
              <span className="max-w-full truncate px-0.5">{t(it.key)}</span>
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
  useRealtimeNotifications()
  useRealtimeChats()
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
            <button className="absolute top-4 right-3 rounded-lg p-2 text-muted" onClick={() => setMobileOpen(false)} aria-label={t('shell.closeMenu')}>
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 border-b border-line/80 bg-canvas/85 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
            <button className="rounded-xl p-2 text-ink-soft hover:bg-white lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t('shell.menu')}>
              <Menu className="h-5 w-5" />
            </button>
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <div className="hidden min-w-0 items-center gap-2 text-sm text-muted lg:flex">
              <Building2 className="h-4 w-4" />
              <span className="truncate">{me?.company}</span>
              {me?.department?.name && <span className="truncate">· {me.department.name}</span>}
            </div>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              {role && <Badge className="hidden bg-white text-ink-soft ring-line xl:inline-flex">{t(`role.${role}` as I18nKey)}</Badge>}
              <LanguageMenu />
              <ChatButton />
              <NotificationsBell />
              <ProfileMenu />
            </div>
          </div>
        </header>
        <main key={location.pathname} className="mx-auto max-w-[1400px] overflow-x-clip px-4 pt-6 pb-28 sm:px-6 lg:pb-12 animate-fade-in">
          {children}
        </main>
      </div>
      <MobileTabBar />
      {!/^\/(assistant|messages)/.test(location.pathname) && <AssistantWidget />}
    </div>
  )
}
