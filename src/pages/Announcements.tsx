import { useEffect, useState } from 'react'
import { Megaphone, Pin, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useAnnouncements, useCreateAnnouncement, useDepartments, useMarkAnnouncementRead } from '@/lib/api'
import { ANNOUNCEMENT_CATEGORIES } from '@/lib/constants'
import { fmtDateTime, fullName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar, Badge, Button, Card, Empty, Field, Modal, PageHeader, Skeleton } from '@/components/ui'

export default function AnnouncementsPage() {
  const { role } = useAuth()
  const { t } = useI18n()
  const { data, isLoading } = useAnnouncements(50)
  const markRead = useMarkAnnouncementRead()
  const [filter, setFilter] = useState<string>('all')
  const [creating, setCreating] = useState(false)
  const list = (data ?? []).filter((a) => filter === 'all' || a.category === filter)

  // всё, что пользователь увидел на странице, считаем прочитанным
  useEffect(() => {
    for (const a of data ?? []) if (!a.read) markRead.mutate(a.id)
  }, [data?.length])

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('nav.announcements')}
        actions={
          role !== 'employee' && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              {t('ann.publish')}
            </Button>
          )
        }
      />
      <div className="scrollbar-thin mb-4 flex gap-2 overflow-x-auto">
        {[['all', { label: t('common.all'), emoji: '📋', style: '' }] as const, ...Object.entries(ANNOUNCEMENT_CATEGORIES)].map(([k, v]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition', filter === k ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-soft ring-line hover:ring-brand-300')}
          >
            {v.emoji} {v.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {isLoading && <Skeleton className="h-32" />}
        {!isLoading && list.length === 0 && (
          <Card>
            <Empty icon={<Megaphone className="h-6 w-6" />} title={t('ann.empty')} />
          </Card>
        )}
        {list.map((a) => {
          const cat = ANNOUNCEMENT_CATEGORIES[a.category] ?? ANNOUNCEMENT_CATEGORIES.news
          return (
            <Card key={a.id} className={cn('p-5', a.category === 'urgent' && 'border-rose-200 bg-rose-50/30')}>
              <div className="flex flex-wrap items-center gap-2">
                {a.pinned && (
                  <Badge className="bg-brand-50 text-brand-700 ring-brand-200">
                    <Pin className="h-3 w-3" /> {t('ann.pinned')}
                  </Badge>
                )}
                <Badge className={cat.style}>
                  {cat.emoji} {cat.label}
                </Badge>
                {a.department && <Badge className="bg-canvas text-ink-soft ring-line">{t('ann.for', { name: a.department.name })}</Badge>}
              </div>
              <h2 className="mt-3 text-lg font-semibold">{a.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line text-ink-soft">{a.body}</p>
              <div className="mt-4 flex items-center gap-2 text-sm text-muted">
                <Avatar id={a.author_id} name={fullName(a.author)} size={24} />
                {fullName(a.author)} · {a.author?.position} · {fmtDateTime(a.created_at)}
              </div>
            </Card>
          )
        })}
      </div>
      <NewAnnouncement open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function NewAnnouncement({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role, me } = useAuth()
  const { t } = useI18n()
  const create = useCreateAnnouncement()
  const departments = useDepartments()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('news')
  const [pinned, setPinned] = useState(false)
  const [audience, setAudience] = useState<string>(role === 'manager' ? me?.department_id ?? '' : '')
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('ann.new')}
      subtitle={role === 'manager' ? t('ann.managerHint') : t('ann.notifyHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={create.isPending}
            disabled={!title.trim() || !body.trim()}
            onClick={async () => {
              try {
                await create.mutateAsync({ title: title.trim(), body: body.trim(), category, pinned, audience_department_id: audience || null })
                toast.success(t('ann.published'))
                setTitle('')
                setBody('')
                onClose()
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
          >
            {t('ann.publish')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('ann.titleLabel')}>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('ann.body')}>
          <textarea className="field min-h-[140px]" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('ann.category')}>
            <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(ANNOUNCEMENT_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.emoji} {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('ann.audience')}>
            <select className="field" value={audience} onChange={(e) => setAudience(e.target.value)} disabled={role === 'manager'}>
              <option value="">{t('ann.wholeCompany')}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          {t('ann.pinNotify')}
        </label>
      </div>
    </Modal>
  )
}
