import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { errorMessage, supabase } from './supabase'
import type { Employee, Role } from './types'

export const EMPLOYEE_SELECT =
  '*, department:departments!employees_department_fk(id,name), location:locations!employees_location_fk(id,name,city,country), manager:manager(id,first_name,last_name,position,email,phone)'

interface AuthCtx {
  session: Session | null
  me: Employee | null
  role: Role | null
  isHr: boolean
  isManager: boolean
  loading: boolean
  /** вошли, но карточка сотрудника не найдена */
  orphan: boolean
  /** не удалось загрузить карточку сотрудника (нет связи с сервером) */
  loadError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  reloadMe: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [orphan, setOrphan] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s) {
      setMe(null)
      setOrphan(false)
      setLoadError(null)
      return
    }
    const { data, error } = await supabase.from('employees').select(EMPLOYEE_SELECT).eq('user_id', s.user.id).maybeSingle()
    if (error) {
      // сбой связи — это не «карточка не найдена»: показываем ошибку с повтором
      console.error(error)
      setLoadError(errorMessage(error))
      return
    }
    setLoadError(null)
    setMe((data as Employee) ?? null)
    setOrphan(!data)
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return
        setSession(data.session)
        await loadMe(data.session)
      })
      .catch((error: unknown) => {
        console.error(error)
        if (active) setLoadError(errorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // загрузку профиля выносим из колбэка, чтобы не блокировать клиент Supabase
        setTimeout(() => {
          void loadMe(s).then(() => setLoading(false))
        }, 0)
      }
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadMe])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      throw new Error(error.message === 'Invalid login credentials' ? 'Неверная почта или пароль' : error.message)
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    qc.clear()
    setMe(null)
  }, [qc])

  const value = useMemo<AuthCtx>(() => {
    const role = me?.role ?? null
    return {
      session,
      me,
      role,
      isHr: role === 'hr',
      isManager: role === 'manager' || role === 'hr',
      loading,
      orphan: Boolean(session) && orphan,
      loadError,
      signIn,
      signOut,
      reloadMe: () => loadMe(session),
    }
  }, [session, me, loading, orphan, loadError, signIn, signOut, loadMe])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth вне AuthProvider')
  return ctx
}

/** Текущий сотрудник (страницы внутри защищённой зоны) */
export function useMe(): Employee {
  const { me } = useAuth()
  if (!me) throw new Error('Нет текущего сотрудника')
  return me
}
