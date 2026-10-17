import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Активная вкладка страницы хранится в адресе (?tab=), вкладка по умолчанию — без параметра */
export function useTabParam<T extends string>(tabs: readonly T[], fallback: T): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as T | null
  const tab = raw && tabs.includes(raw) ? raw : fallback
  return [tab, (next: T) => setParams(next === fallback ? {} : { tab: next }, { replace: true })]
}

export function TabLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <>
      {icon}
      {children}
    </>
  )
}
