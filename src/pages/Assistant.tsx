import { Link } from 'react-router-dom'
import { BookOpenCheck, MessageCircleQuestion, RotateCcw, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useTickets } from '@/lib/api'
import { fmtDate, timeAgo } from '@/lib/format'
import { AssistantChat, useAssistant } from '@/components/assistant/AssistantChat'
import { Badge, Button, Card, CardHeader } from '@/components/ui'

export default function AssistantPage() {
  const { t } = useI18n()
  const { reset, messages } = useAssistant()
  const { isHr } = useAuth()
  const tickets = useTickets('mine')

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="flex h-[calc(100dvh-170px)] min-h-[520px] flex-col p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">AI Jana</h1>
              <p className="text-sm text-muted">{t('ai.subtitle')}</p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>
              Новый диалог
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <AssistantChat />
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="p-5">
          <h3 className="font-semibold">Как AI Jana отвечает</h3>
          <ul className="mt-3 space-y-3 text-sm text-ink-soft">
            <li className="flex gap-2.5">
              <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              Только по утверждённой базе знаний HR — у каждого ответа есть ссылка на положение.
            </li>
            <li className="flex gap-2.5">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
              Ваши данные (остаток отпуска, заявки, курсы) — только ваши, из профиля и 1С:ЗУП.
            </li>
            <li className="flex gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              Не раскрывает чужие персональные данные и не принимает кадровых решений{isHr ? '; цифры по компании — по вашей роли HR' : ''}.
            </li>
            <li className="flex gap-2.5">
              <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              Нет надёжного ответа — честно скажет и передаст вопрос в HR. Ответ HR пополнит базу знаний.
            </li>
          </ul>
          <Link to="/knowledge" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
            Открыть базу знаний →
          </Link>
        </Card>

        <Card>
          <CardHeader title="Мои вопросы в HR" subtitle="Эскалации, на которые ответит HR" />
          <ul className="divide-y divide-line border-t border-line">
            {(tickets.data ?? []).length === 0 && <li className="px-5 py-5 text-center text-sm text-muted">Пока нет обращений</li>}
            {(tickets.data ?? []).slice(0, 6).map((tk) => (
              <li key={tk.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    №{tk.number} · {fmtDate(tk.created_at, 'd MMM')}
                  </span>
                  <Badge className={tk.status === 'open' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-brand-50 text-brand-700 ring-brand-200'}>
                    {tk.status === 'open' ? 'ждёт ответа' : 'есть ответ'}
                  </Badge>
                </div>
                <div className="mt-1 text-sm font-medium text-ink">{tk.question}</div>
                {tk.answer && (
                  <div className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">
                    {tk.answer}
                    <div className="mt-1 text-[11px] text-brand-700/80">HR · {timeAgo(tk.answered_at)}</div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
