import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reloadFresh } from '@/lib/reload'

const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Loading chunk/i
export const RELOAD_FLAG = 'janamen-chunk-reload'

interface Props {
  children: ReactNode
  /** смена ключа (например, адреса страницы) сбрасывает ошибку */
  resetKey?: string
}

/**
 * Ошибка в одном разделе не должна ронять всё приложение: показываем понятное сообщение.
 * После обновления сайта старые файлы страниц исчезают — в этом случае один раз перезагружаемся.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    if (CHUNK_ERROR.test(error.message)) {
      try {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1')
          reloadFresh()
        }
      } catch {
        /* хранилище недоступно — показываем сообщение */
      }
    }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-ink">Не удалось открыть раздел</h1>
        <p className="mt-3 text-[15px] text-muted">Попробуйте обновить страницу. Если ошибка повторится, откройте сайт в другом браузере.</p>
        <button
          type="button"
          className="mt-6 rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white"
          onClick={() => {
            try {
              sessionStorage.removeItem(RELOAD_FLAG)
            } catch {
              /* ignore */
            }
            reloadFresh()
          }}
        >
          Обновить
        </button>
        <p className="mt-6 text-xs break-words text-muted/80">{error.message}</p>
      </div>
    )
  }
}
