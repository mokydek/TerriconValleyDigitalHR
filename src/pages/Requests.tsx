import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronRight, FilePlus2, FileStack } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useMyRequests } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { HrRequest, RequestType } from '@/lib/types'
import { REQUEST_TYPES } from '@/lib/constants'
import { Button, Card, Empty, ErrorBox, PageHeader, Skeleton, Tabs } from '@/components/ui'
import { NewRequestModal } from '@/components/requests/NewRequestModal'
import { RequestDrawer } from '@/components/requests/RequestDrawer'
import { requestSummary, StatusBadge, TypeLabel } from '@/components/requests/RequestParts'

type Filter = 'all' | 'active' | 'closed'

export default function RequestsPage() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const { data, isLoading, error, refetch } = useMyRequests()
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const newType = params.get('new') as RequestType | null
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (newType && (REQUEST_TYPES as string[]).includes(newType)) setCreating(true)
  }, [newType])

  const rows = useMemo(() => {
    const list = data ?? []
    if (filter === 'active') return list.filter((r) => ['pending', 'approved', 'processing'].includes(r.status))
    if (filter === 'closed') return list.filter((r) => ['done', 'rejected', 'cancelled'].includes(r.status))
    return list
  }, [data, filter])

  const selected = (data ?? []).find((r) => r.id === openId) ?? null
  const activeCount = (data ?? []).filter((r) => ['pending', 'approved', 'processing'].includes(r.status)).length

  const closeCreate = () => {
    setCreating(false)
    if (params.get('new')) {
      params.delete('new')
      setParams(params, { replace: true })
    }
  }

  return (
    <div>
      <PageHeader
        title={t('nav.requests')}
        actions={
          <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setCreating(true)} data-testid="new-request">
            {t('req.new')}
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {REQUEST_TYPES.map((rt) => (
          <button
            key={rt}
            onClick={() => {
              params.set('new', rt)
              setParams(params, { replace: true })
              setCreating(true)
            }}
            className="card flex items-center justify-between gap-2 p-3.5 text-left transition hover:border-brand-300"
          >
            <TypeLabel type={rt} withHint />
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
          </button>
        ))}
      </div>

      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        className="mb-4"
        items={[
          { value: 'all', label: 'Все', count: data?.length },
          { value: 'active', label: 'В работе', count: activeCount },
          { value: 'closed', label: 'Завершённые' },
        ]}
      />

      {error && <ErrorBox error={error} onRetry={() => void refetch()} />}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty icon={<FileStack className="h-6 w-6" />} title="Заявок нет" text={t('home.noRequests')} action={<Button onClick={() => setCreating(true)}>{t('req.new')}</Button>} />
        ) : (
          <>
            {/* Таблица — десктоп */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-line bg-canvas/60 text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">№</th>
                  <th className="px-5 py-3 font-medium">Тип</th>
                  <th className="px-5 py-3 font-medium">Детали</th>
                  <th className="px-5 py-3 font-medium">Создана</th>
                  <th className="px-5 py-3 font-medium">Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RequestRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
                ))}
              </tbody>
            </table>
            {/* Карточки — мобильные */}
            <ul className="divide-y divide-line md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setOpenId(r.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <TypeLabel type={r.type} />
                        <span className="text-xs text-muted">№{r.number}</span>
                      </div>
                      <div className="mt-1 truncate text-sm text-muted">{requestSummary(r)}</div>
                      <div className="mt-1.5">
                        <StatusBadge status={r.status} />
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <NewRequestModal open={creating} onClose={closeCreate} initialType={newType} onCreated={(r) => setOpenId(r.id)} />
      <RequestDrawer request={selected} onClose={() => setOpenId(null)} />
    </div>
  )
}

function RequestRow({ r, onOpen }: { r: HrRequest; onOpen: () => void }) {
  return (
    <tr onClick={onOpen} className="cursor-pointer border-b border-line/70 transition last:border-0 hover:bg-brand-50/30" data-testid={`request-row-${r.number}`}>
      <td className="px-5 py-3.5 font-medium text-muted tabular-nums">{r.number}</td>
      <td className="px-5 py-3.5">
        <TypeLabel type={r.type} />
      </td>
      <td className="px-5 py-3.5 text-ink-soft">{requestSummary(r)}</td>
      <td className="px-5 py-3.5 text-muted">{fmtDate(r.created_at)}</td>
      <td className="px-5 py-3.5">
        <StatusBadge status={r.status} />
      </td>
      <td className="px-5 py-3.5 text-right">
        <ChevronRight className="inline h-4 w-4 text-muted" />
      </td>
    </tr>
  )
}
