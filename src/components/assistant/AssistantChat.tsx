import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUp, BookOpenCheck, ChartColumnBig, CircleAlert, ShieldAlert, Sparkles, UserRound, UsersRound } from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { askJana, logQuery, type AiAnswer } from '@/lib/assistant/engine'
import { useCreateTicket } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  answer?: AiAnswer
  queryId?: string | null
  escalated?: number | null
}

interface AssistantCtx {
  messages: ChatMessage[]
  busy: boolean
  send: (q: string) => Promise<void>
  reset: () => void
  markEscalated: (id: string, number: number) => void
}

const Ctx = createContext<AssistantCtx | null>(null)

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { me, role } = useAuth()
  const { t } = useI18n()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => setMessages([]), [me?.id])

  const send = useCallback(
    async (q: string) => {
      const question = q.trim()
      if (!question || !me || !role) return
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: question }
      setMessages((m) => [...m, userMsg])
      setBusy(true)
      try {
        const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.text }))
        const answer = await askJana(question, history, { role, firstName: me.first_name })
        const queryId = await logQuery(me.id, question, answer)
        setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', text: answer.text, answer, queryId }])
      } catch (e) {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: t('ai.error'),
            answer: { status: 'no_answer', text: '', sources: [], mode: 'kb' },
          },
        ])
        console.error(e)
      } finally {
        setBusy(false)
      }
    },
    [me, role, messages, t],
  )

  const value = useMemo<AssistantCtx>(
    () => ({
      messages,
      busy,
      send,
      reset: () => setMessages([]),
      markEscalated: (id, number) => setMessages((m) => m.map((x) => (x.id === id ? { ...x, escalated: number } : x))),
    }),
    [messages, busy, send],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAssistant() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAssistant must be used within AssistantProvider')
  return ctx
}

// Примеры вопросов по ролям: ключи словаря, текст подставляется на языке интерфейса при отрисовке
const SUGGESTIONS: Record<string, I18nKey[]> = {
  employee: ['ai.q.myVacationDays', 'ai.q.advance', 'ai.q.moveVacation', 'ai.q.myRequests', 'ai.q.payday', 'ai.q.nightShift'],
  manager: ['ai.q.vacationNextWeek', 'ai.q.over30Days', 'ai.q.safetyWorst', 'ai.q.approvalTime', 'ai.q.myVacationDays'],
  hr: ['ai.q.vacationNextWeek', 'ai.q.over30Days', 'ai.q.safetyWorst', 'ai.q.pendingCount', 'ai.q.lateLearning', 'ai.q.vacationIn1c'],
}

function StatusChip({ answer }: { answer: AiAnswer }) {
  const { t } = useI18n()
  const map: Record<AiAnswer['status'], { icon: ReactNode; label: string; cls: string }> = {
    answered: { icon: <BookOpenCheck className="h-3.5 w-3.5" />, label: t('ai.st.answered'), cls: 'bg-brand-50 text-brand-700' },
    personal: { icon: <UserRound className="h-3.5 w-3.5" />, label: t('ai.st.personal'), cls: 'bg-sky-50 text-sky-700' },
    analytics: { icon: <ChartColumnBig className="h-3.5 w-3.5" />, label: t('ai.st.analytics'), cls: 'bg-violet-50 text-violet-700' },
    no_answer: { icon: <CircleAlert className="h-3.5 w-3.5" />, label: t('ai.st.noAnswer'), cls: 'bg-amber-50 text-amber-800' },
    refused: { icon: <ShieldAlert className="h-3.5 w-3.5" />, label: t('ai.st.refused'), cls: 'bg-rose-50 text-rose-700' },
    smalltalk: { icon: <Sparkles className="h-3.5 w-3.5" />, label: t('ai.title'), cls: 'bg-canvas text-ink-soft' },
  }
  const s = map[answer.status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', s.cls)}>
      {s.icon}
      {s.label}
      {answer.mode === 'llm' && <span className="opacity-70">· Claude</span>}
    </span>
  )
}

/** Простая разметка: **жирный** и переносы строк */
function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-[14.5px] leading-relaxed whitespace-pre-line">
      {text.split('\n\n').map((para, i) => (
        <p key={i}>
          {para.split(/(\*\*[^*]+\*\*)/g).map((chunk, j) =>
            chunk.startsWith('**') && chunk.endsWith('**') ? (
              <strong key={j} className="font-semibold text-ink">
                {chunk.slice(2, -2)}
              </strong>
            ) : (
              <span key={j}>{chunk}</span>
            ),
          )}
        </p>
      ))}
    </div>
  )
}

function AssistantBubble({ msg, compact }: { msg: ChatMessage; compact?: boolean }) {
  const a = msg.answer!
  const { t } = useI18n()
  const createTicket = useCreateTicket()
  const { markEscalated, messages } = useAssistant()
  const navigate = useNavigate()
  const question = useMemo(() => {
    const idx = messages.findIndex((m) => m.id === msg.id)
    return idx > 0 ? messages[idx - 1].text : ''
  }, [messages, msg.id])

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-md border border-line bg-white px-4 py-3 text-ink-soft shadow-[var(--shadow-card)]">
          <div className="mb-2">
            <StatusChip answer={a} />
          </div>
          <RichText text={msg.text} />
          {a.table && (
            <div className="scrollbar-thin mt-3 overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-canvas text-muted">
                  <tr>
                    {a.table.columns.map((c) => (
                      <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.table.rows.slice(0, compact ? 8 : 30).map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      {r.map((c, j) => (
                        <td key={j} className="px-3 py-1.5 whitespace-nowrap text-ink">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {a.table.rows.length > (compact ? 8 : 30) && <div className="border-t border-line px-3 py-1.5 text-xs text-muted">{t('ai.andMore', { n: a.table.rows.length - (compact ? 8 : 30) })}</div>}
            </div>
          )}
          {a.sources.length > 0 && (
            <div className="mt-3 border-t border-line pt-2.5">
              <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{t('ai.source')}</div>
              <div className="flex flex-col gap-1.5">
                {a.sources.map((s, i) =>
                  s.slug ? (
                    <Link
                      key={i}
                      to={`/knowledge/${s.slug}${s.heading ? `#${encodeURIComponent(s.heading)}` : ''}`}
                      className="group inline-flex items-start gap-2 rounded-lg bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink-soft hover:bg-brand-50 hover:text-brand-800"
                    >
                      <BookOpenCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                      <span>
                        <span className="font-medium text-ink group-hover:text-brand-800">
                          {s.title}
                          {s.heading ? ` → ${s.heading}` : ''}
                        </span>
                        {s.source_title && <span className="block text-[11.5px] text-muted">{s.source_title}</span>}
                      </span>
                    </Link>
                  ) : (
                    <span key={i} className="inline-flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink-soft">
                      {s.kind === 'analytics' ? <UsersRound className="h-3.5 w-3.5 text-violet-600" /> : <UserRound className="h-3.5 w-3.5 text-sky-600" />}
                      {s.title}
                    </span>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {a.actions?.map((act) => (
            <Button key={act.to} variant="soft" size="sm" onClick={() => navigate(act.to)}>
              {act.label}
            </Button>
          ))}
          {(a.status === 'no_answer' || a.status === 'refused') &&
            (msg.escalated ? (
              <span className="inline-flex items-center rounded-lg bg-brand-50 px-3 py-1.5 text-sm text-brand-700">
                ✓ {t('ai.ticketSent', { n: msg.escalated })}
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                loading={createTicket.isPending}
                onClick={async () => {
                  try {
                    const ticket = await createTicket.mutateAsync({ question, aiQueryId: msg.queryId })
                    markEscalated(msg.id, ticket.number)
                    toast.success(t('ai.escalated'))
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
              >
                {t('ai.escalate')}
              </Button>
            ))}
        </div>
      </div>
    </div>
  )
}

export function AssistantChat({ compact = false }: { compact?: boolean }) {
  const { messages, busy, send } = useAssistant()
  const { role, me } = useAuth()
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  const submit = (q?: string) => {
    const text = (q ?? input).trim()
    if (!text || busy) return
    setInput('')
    void send(text)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto', compact ? 'px-4 py-4' : 'px-1 py-2')}>
        {messages.length === 0 && (
          <div className="py-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-ink">{t('ai.hello', { name: me?.first_name ?? '' })}</p>
                <p className="mt-1 text-sm text-muted">{t('ai.intro')}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(SUGGESTIONS[role ?? 'employee'] ?? SUGGESTIONS.employee).map((key) => {
                const s = t(key)
                return (
                  <button
                    key={key}
                    onClick={() => submit(s)}
                    className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-[13px] text-ink-soft transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-brand-600 px-4 py-2.5 text-[14.5px] text-white shadow-sm">{m.text}</div>
            </div>
          ) : (
            <AssistantBubble key={m.id} msg={m} compact={compact} />
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2.5 text-sm text-muted">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-brand-600">
              <Sparkles className="h-4 w-4 animate-pulse" />
            </div>
            {t('ai.thinking')}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className={cn('border-t border-line bg-white', compact ? 'p-3' : 'pt-3')}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-white p-1.5 pl-3.5 focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={t('ai.placeholder')}
            className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-muted/70"
            aria-label={t('ai.inputLabel')}
          />
          <Button type="submit" size="icon" disabled={!input.trim() || busy} aria-label={t('common.send')}>
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted">{t('ai.disclaimer')}</p>
      </form>
    </div>
  )
}
