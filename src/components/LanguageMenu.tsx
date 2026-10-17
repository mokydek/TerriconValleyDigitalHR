import { useEffect, useState } from 'react'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { LANGS, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Список языков: название на самом языке и страна, текущий отмечен галочкой */
export function LanguageList({ onPicked }: { onPicked?: () => void }) {
  const { lang, setLang, t } = useI18n()
  return (
    <ul role="listbox" aria-label={t('lang.title')} className="p-1.5">
      {LANGS.map((l) => {
        const selected = l.code === lang
        return (
          <li key={l.code}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              lang={l.code}
              data-testid={`lang-${l.code}`}
              onClick={() => {
                onPicked?.()
                if (!selected) void setLang(l.code)
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition',
                selected ? 'bg-brand-50' : 'hover:bg-canvas',
              )}
            >
              <span className="w-9 shrink-0 text-xs font-semibold text-muted">{l.short}</span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[14.5px] font-medium', selected ? 'text-brand-800' : 'text-ink')}>{l.name}</span>
                {l.country && <span className="block text-xs text-muted">{l.country}</span>}
              </span>
              {selected && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Кнопка с глобусом: открывает выбор языка. В шапке приложения и на странице входа */
export function LanguageMenu({ variant = 'header' }: { variant?: 'header' | 'login' }) {
  const { lang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0]
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('lang.title')}
        title={t('lang.title')}
        data-testid="lang-menu"
        className={
          variant === 'header'
            ? 'inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-xl px-2 text-ink-soft transition hover:bg-canvas hover:text-ink'
            : 'inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-ink-soft ring-1 ring-line transition hover:text-ink'
        }
      >
        <Globe className={variant === 'header' ? 'h-5 w-5' : 'h-4 w-4'} />
        <span className={cn(variant === 'header' && 'hidden text-sm font-semibold sm:inline')}>{current.short}</span>
        {variant === 'login' && <ChevronDown className="h-3.5 w-3.5 opacity-60" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          {/* на телефоне глобус стоит левее других значков, поэтому список открываем во всю ширину экрана */}
          <div
            className={cn(
              'z-40 overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)] animate-fade-in',
              variant === 'header'
                ? 'fixed inset-x-3 top-[4.25rem] sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-64'
                : 'absolute right-0 mt-2 w-64',
            )}
          >
            <div className="border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">{t('lang.title')}</div>
            <LanguageList onPicked={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  )
}
