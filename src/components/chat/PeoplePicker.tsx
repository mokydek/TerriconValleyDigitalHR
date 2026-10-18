import { useState } from 'react'
import { Check, Search } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useEmployeesLite } from '@/lib/api'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar, Skeleton } from '@/components/ui'

/** Поиск и выбор коллег: для нового чата, добавления в группу и отправки контакта */
export function PeoplePicker({
  picked,
  onChange,
  exclude = [],
  single,
  maxHeight = '46dvh',
}: {
  picked: string[]
  onChange: (ids: string[]) => void
  exclude?: string[]
  single?: boolean
  maxHeight?: string
}) {
  const { me } = useAuth()
  const { t } = useI18n()
  const people = useEmployeesLite()
  const [q, setQ] = useState('')
  const all = (people.data ?? []).filter((p) => p.id !== me?.id && !exclude.includes(p.id))
  const needle = q.trim().toLowerCase()
  const shown = needle ? all.filter((p) => `${p.last_name} ${p.first_name} ${p.position}`.toLowerCase().includes(needle)) : all
  const toggle = (id: string) => onChange(single ? [id] : picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  const chosen = all.filter((p) => picked.includes(p.id))

  return (
    <div>
      {!single && chosen.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chosen.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              className="inline-flex animate-pop items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pr-2.5 pl-0.5 text-sm text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100"
            >
              <Avatar id={p.id} name={fullName(p)} size={22} />
              {p.first_name}
              <span className="text-brand-500">×</span>
            </button>
          ))}
        </div>
      )}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="field pl-9"
          placeholder={t('chat.findPeople')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('chat.findPeople')}
          data-testid="chat-people-search"
        />
      </div>
      {!single && shown.length > 1 && (
        <div className="-mt-1 mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => {
              const ids = shown.map((p) => p.id)
              const all = ids.every((id) => picked.includes(id))
              onChange(all ? picked.filter((id) => !ids.includes(id)) : [...new Set([...picked, ...ids])])
            }}
            className="text-sm font-medium text-brand-700 hover:underline"
            data-testid="people-select-all"
          >
            {shown.every((p) => picked.includes(p.id)) ? t('msg.unselectAll') : t('msg.selectAll', { n: shown.length })}
          </button>
        </div>
      )}
      {people.isLoading && <Skeleton className="h-40" />}
      <ul className="scrollbar-thin -mx-2 overflow-y-auto" style={{ maxHeight }}>
        {shown.map((p) => {
          const on = picked.includes(p.id)
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition', on ? 'bg-brand-50' : 'hover:bg-canvas')}
                aria-pressed={on}
                data-testid="chat-person"
              >
                <Avatar id={p.id} name={fullName(p)} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{fullName(p, true)}</span>
                  <span className="block truncate text-xs text-muted">{p.position}</span>
                </span>
                <span
                  className={cn(
                    'grid h-5 w-5 shrink-0 place-items-center border transition',
                    single ? 'rounded-full' : 'rounded-md',
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line',
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
              </button>
            </li>
          )
        })}
        {!people.isLoading && shown.length === 0 && <li className="py-6 text-center text-sm text-muted">{t('chat.noPeople')}</li>}
      </ul>
    </div>
  )
}
