import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Maximize2, Sparkles, X } from '@/components/icons'
import { useI18n } from '@/lib/i18n'
import { AssistantChat } from './AssistantChat'

export function AssistantWidget() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="group fixed right-4 bottom-20 z-30 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 p-3.5 font-semibold text-white shadow-[var(--shadow-pop)] transition hover:scale-[1.04] active:scale-95 sm:py-3 sm:pr-5 sm:pl-4 lg:right-6 lg:bottom-6"
          data-testid="ai-widget-open"
          aria-label={t('ai.title')}
          title={t('ai.widgetSubtitle')}
        >
          {/* мягкая «волна» вокруг кнопки: помощник всегда на месте, справа снизу */}
          <span className="pointer-events-none absolute inset-0 -z-10 animate-ping rounded-full bg-brand-500/30 [animation-duration:2.8s]" aria-hidden />
          <Sparkles className="h-6 w-6 transition-transform group-hover:rotate-12 sm:h-5 sm:w-5" />
          <span className="hidden sm:inline">{t('ai.title')}</span>
        </button>
      )}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] origin-bottom-right flex-col overflow-hidden rounded-t-3xl border border-line bg-white shadow-[var(--shadow-pop)] animate-pop sm:inset-x-auto sm:right-6 sm:bottom-6 sm:h-[640px] sm:max-h-[85dvh] sm:w-[420px] sm:rounded-3xl">
          <div className="flex items-center justify-between bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-white/20">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="text-[15px] font-semibold">{t('ai.title')}</div>
                <div className="text-[11px] text-white/80">{t('ai.widgetSubtitle')}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Link to="/assistant" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white/15" title={t('ai.fullscreen')}>
                <Maximize2 className="h-4 w-4" />
              </Link>
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white/15" aria-label={t('common.close')}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <AssistantChat compact />
          </div>
        </div>
      )}
    </>
  )
}
