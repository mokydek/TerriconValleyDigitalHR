import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { supabaseConfigured } from '@/lib/supabase'
import { reloadFresh } from '@/lib/reload'
import type { Role } from '@/lib/types'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AssistantProvider } from '@/components/assistant/AssistantChat'
import { Button, PageLoader, Spinner } from '@/components/ui'
import LoginPage from '@/pages/Login'

const HomePage = lazy(() => import('@/pages/Home'))
const ProfilePage = lazy(() => import('@/pages/Profile'))
const RequestsPage = lazy(() => import('@/pages/Requests'))
const ApprovalsPage = lazy(() => import('@/pages/Approvals'))
const AcademyPage = lazy(() => import('@/pages/Academy'))
const CoursePage = lazy(() => import('@/pages/Course'))
const AssistantPage = lazy(() => import('@/pages/Assistant'))
const KnowledgePage = lazy(() => import('@/pages/Knowledge'))
const NotificationsPage = lazy(() => import('@/pages/Notifications'))
const TasksPage = lazy(() => import('@/pages/Tasks'))
const AnnouncementsPage = lazy(() => import('@/pages/Announcements'))
const TeamPage = lazy(() => import('@/pages/Team'))
const EmployeesPage = lazy(() => import('@/pages/Employees'))
const EmployeeCardPage = lazy(() => import('@/pages/EmployeeCard'))
const AnalyticsPage = lazy(() => import('@/pages/Analytics'))
const TicketsPage = lazy(() => import('@/pages/Tickets'))
const IntegrationsPage = lazy(() => import('@/pages/Integrations'))
const DocumentPage = lazy(() => import('@/pages/DocumentView'))
const MessagesPage = lazy(() => import('@/pages/Messages'))

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useAuth()
  if (!role || !roles.includes(role)) {
    return (
      <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
        <p className="text-lg font-semibold">Раздел недоступен для вашей роли</p>
        <p className="mt-2 text-sm text-muted">Права проверяет сервер: данные этого раздела вам не отдаются.</p>
      </div>
    )
  }
  return <>{children}</>
}

function NotConfigured() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="card max-w-lg p-8">
        <h1 className="text-xl font-bold">JanaMen: не настроено подключение к Supabase</h1>
        <p className="mt-3 text-muted">
          Задайте переменные окружения <code>VITE_SUPABASE_URL</code> и <code>VITE_SUPABASE_ANON_KEY</code> (см. <code>.env.example</code>) и перезапустите сборку.
        </p>
      </div>
    </div>
  )
}

/** Сбросить сохранённый вход (если старая сессия мешает запуску) и открыть страницу входа */
function resetSignIn() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('janamen-auth')) localStorage.removeItem(key)
  } catch {
    /* хранилище недоступно */
  }
  window.location.replace('/')
}

/** Запуск: пока проверяется вход. Если сервер долго не отвечает — объясняем, что делать, а не крутим спиннер вечно */
function StartupLoader() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-sm">
        <Spinner className="mx-auto h-7 w-7" />
        {slow && (
          <>
            <p className="mt-5 font-semibold">Сервер отвечает дольше обычного</p>
            <p className="mt-2 text-sm text-muted">Проверьте интернет и обновите страницу. Если не помогает, войдите заново.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={reloadFresh}>Обновить</Button>
              <Button variant="outline" onClick={resetSignIn}>
                Войти заново
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function LoadProblem({ message }: { message: string }) {
  const { reloadMe } = useAuth()
  const [busy, setBusy] = useState(false)
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-xl font-bold">Не удалось загрузить данные</h1>
        <p className="mt-3 text-sm text-muted">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button
            loading={busy}
            onClick={() => {
              setBusy(true)
              void reloadMe().finally(() => setBusy(false))
            }}
          >
            Повторить
          </Button>
          <Button variant="outline" onClick={resetSignIn}>
            Войти заново
          </Button>
        </div>
      </div>
    </div>
  )
}

function Orphan() {
  const { signOut, session } = useAuth()
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-xl font-bold">Карточка сотрудника не найдена</h1>
        <p className="mt-3 text-sm text-muted">
          Аккаунт {session?.user.email} не связан с сотрудником в 1С:ЗУП. Обратитесь в HR: после синхронизации доступ откроется сам.
        </p>
        <Button className="mt-5" variant="outline" onClick={() => void signOut()}>
          Выйти
        </Button>
      </div>
    </div>
  )
}

export default function App() {
  const { session, me, loading, orphan, loadError } = useAuth()
  const location = useLocation()

  if (!supabaseConfigured) return <NotConfigured />
  if (loading) return <StartupLoader />
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  if (!me && loadError) return <LoadProblem message={loadError} />
  if (orphan) return <Orphan />
  if (!me) return <StartupLoader />

  return (
    <AssistantProvider>
      <AppShell>
        <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/academy" element={<AcademyPage />} />
            <Route path="/academy/:slug" element={<CoursePage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/knowledge/:slug" element={<KnowledgePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/announcements" element={<AnnouncementsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/documents/:requestId" element={<DocumentPage />} />
            <Route
              path="/approvals"
              element={
                <RoleGate roles={['manager', 'hr']}>
                  <ApprovalsPage />
                </RoleGate>
              }
            />
            <Route
              path="/team"
              element={
                <RoleGate roles={['manager', 'hr']}>
                  <TeamPage />
                </RoleGate>
              }
            />
            <Route
              path="/employees"
              element={
                <RoleGate roles={['hr']}>
                  <EmployeesPage />
                </RoleGate>
              }
            />
            <Route
              path="/employees/:id"
              element={
                <RoleGate roles={['manager', 'hr']}>
                  <EmployeeCardPage />
                </RoleGate>
              }
            />
            <Route
              path="/analytics"
              element={
                <RoleGate roles={['manager', 'hr']}>
                  <AnalyticsPage />
                </RoleGate>
              }
            />
            <Route
              path="/tickets"
              element={
                <RoleGate roles={['hr']}>
                  <TicketsPage />
                </RoleGate>
              }
            />
            <Route
              path="/integrations"
              element={
                <RoleGate roles={['hr']}>
                  <IntegrationsPage />
                </RoleGate>
              }
            />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </AppShell>
    </AssistantProvider>
  )
}
