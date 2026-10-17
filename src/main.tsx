import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast, Toaster } from 'sonner'
import { AuthProvider } from '@/lib/auth'
import { I18nProvider, initLang, t } from '@/lib/i18n'
import App from './App'
import { ErrorBoundary, RELOAD_FLAG } from '@/components/ErrorBoundary'
import { reloadFresh } from '@/lib/reload'
import './index.css'

// После обновления сайта файлы старой сборки исчезают: перезагружаемся один раз, а не показываем белый экран
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return
    sessionStorage.setItem(RELOAD_FLAG, '1')
  } catch {
    return
  }
  event.preventDefault()
  reloadFresh()
})
window.setTimeout(() => {
  try {
    sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    /* ignore */
  }
}, 20_000)

// Вкладка, открытая до обновления сайта, продолжает работать на старой сборке: при возвращении
// на вкладку сверяем сборку с сервером и предлагаем обновить страницу
const runningEntry = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src')
let lastUpdateCheck = Date.now()
document.addEventListener('visibilitychange', () => {
  if (!runningEntry || document.visibilityState !== 'visible' || Date.now() - lastUpdateCheck < 60_000) return
  lastUpdateCheck = Date.now()
  fetch(`/?_r=${Date.now()}`, { cache: 'no-store' })
    .then((res) => res.text())
    .then((html) => {
      const latest = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
      if (latest && latest !== runningEntry) {
        toast(t('app.newVersion'), {
          id: 'new-version',
          duration: Infinity,
          action: { label: t('common.refresh'), onClick: reloadFresh },
        })
      }
    })
    .catch(() => {
      /* нет сети — проверим при следующем возвращении */
    })
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
})

// Внешний ErrorBoundary ловит сбои вне страниц (провайдеры, уведомления): вместо пустого экрана — сообщение.
// Сначала подгружаем словарь сохранённого языка, чтобы первый же экран был на нём
void initLang().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <I18nProvider>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <AuthProvider>
                <ErrorBoundary>
                  <App />
                </ErrorBoundary>
                <Toaster position="top-center" richColors closeButton toastOptions={{ duration: 4000 }} />
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </I18nProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
})
