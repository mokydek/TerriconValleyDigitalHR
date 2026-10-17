import { createClient } from '@supabase/supabase-js'
import { t } from './i18n'
import { serverText } from './serverText'

// Значения из /config.js (Docker) имеют приоритет над переменными сборки (Vercel, dev)
const runtime = window.__JANAMEN__ ?? {}
const url = runtime.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined)
const key = runtime.anonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)

export const supabaseConfigured = Boolean(url && key)
/** Realtime есть в Supabase Cloud; в локальном Docker-стеке уведомления обновляются опросом */
export const realtimeEnabled = runtime.realtime !== false

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'janamen-auth' },
})

/** Сообщение об ошибке PostgREST/RPC в человекочитаемом виде */
export function errorMessage(error: unknown): string {
  if (!error) return t('err.unknown')
  if (typeof error === 'string') return serverText(error)
  const e = error as { message?: string; details?: string; hint?: string; code?: string }
  if (e.code === '42501' && !e.message) return t('err.forbidden')
  if (e.message === 'Failed to fetch' || e.message === 'Load failed') return t('err.offline')
  return serverText(e.message || e.details) || t('err.request')
}

/** Обёртка: бросает исключение, если запрос вернул ошибку */
export async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw new Error(errorMessage(error))
  return data
}
