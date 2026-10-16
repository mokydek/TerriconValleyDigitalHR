import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useMarkAllRead, useMarkNotificationRead, useNotifications } from '@/lib/api'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button, Card, Empty, PageHeader, Skeleton, Tabs } from '@/components/ui'

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  request: { label: 'Заявки', cls: 'bg-sky-50 text-sky-700' },
  success: { label: 'Готово', cls: 'bg-brand-50 text-brand-700' },
  warning: { label: 'Важно', cls: 'bg-amber-50 text-amber-800' },
  course: { label: 'Обучение', cls: 'bg-violet-50 text-violet-700' },
  task: { label: 'Задачи', cls: 'bg-indigo-50 text-indigo-700' },
  ticket: { label: 'Вопросы', cls: 'bg-rose-50 text-rose-700' },
  announcement: { label: 'Объявления', cls: 'bg-teal-50 text-teal-700' },
  info: { label: 'Инфо', cls: 'bg-slate-100 text-slate-600' },
}

type Filter = 'all' | 'unread'

export default function NotificationsPage() {
  const { t } = useI18n()
  const { data, isLoading } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllRead()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const list = (data ?? []).filter((n) => filter === 'all' || !n.read_at)
  const unread = (data ?? []).filter((n) => !n.read_at).length

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('notif.title')}
        subtitle="Статусы заявок, назначение и завершение обучения, задачи и ответы HR"
        actions={
          unread > 0 && (
            <Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} loading={markAll.isPending} onClick={() => markAll.mutate()}>
              {t('notif.markAll')}
            </Button>
          )
        }
      />
      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        className="mb-4"
        items={[
          { value: 'all', label: 'Все', count: data?.length },
          { value: 'unread', label: 'Непрочитанные', count: unread },
        ]}
      />
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : list.length === 0 ? (
          <Empty icon={<Bell className="h-6 w-6" />} title={t('notif.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((n) => {
              const k = KIND_LABEL[n.kind] ?? KIND_LABEL.info
              return (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      if (!n.read_at) markRead.mutate(n.id)
                      if (n.link) navigate(n.link)
                    }}
                    className={cn('flex w-full gap-3 px-5 py-4 text-left transition hover:bg-canvas', !n.read_at && 'bg-brand-50/40')}
                  >
                    <span className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-line' : 'bg-brand-500')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', k.cls)}>{k.label}</span>
                        <span className="font-medium text-ink">{n.title}</span>
                      </span>
                      {n.body && <span className="mt-1 block text-sm text-muted">{n.body}</span>}
                      <span className="mt-1 block text-xs text-muted/80" title={fmtDateTime(n.created_at)}>
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
