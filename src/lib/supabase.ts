import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'janamen-auth' },
})

/** Сообщение об ошибке PostgREST/RPC в человекочитаемом виде */
export function errorMessage(error: unknown): string {
  if (!error) return 'Неизвестная ошибка'
  if (typeof error === 'string') return error
  const e = error as { message?: string; details?: string; hint?: string; code?: string }
  if (e.code === '42501' && !e.message) return 'Недостаточно прав'
  if (e.message === 'Failed to fetch') return 'Нет связи с сервером. Проверьте интернет.'
  return e.message || e.details || 'Ошибка запроса'
}

/** Обёртка: бросает исключение, если запрос вернул ошибку */
export async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw new Error(errorMessage(error))
  return data
}
