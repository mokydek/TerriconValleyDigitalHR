import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { BookOpen, FileText, Lock, Search, Sparkles } from '@/components/icons'
import { t, useI18n } from '@/lib/i18n'
import { useKbArticle, useKbArticles } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge, Card, Empty, PageHeader, PageLoader } from '@/components/ui'

export default function KnowledgePage() {
  const { slug } = useParams()
  return slug ? <Article slug={slug} /> : <ArticleList />
}

function ArticleList() {
  const { lang } = useI18n()
  const { data, isLoading } = useKbArticles()
  const [q, setQ] = useState('')
  const filtered = (data ?? []).filter((a) => !q || `${a.title} ${a.summary} ${a.content}`.toLowerCase().includes(q.toLowerCase()))
  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>()
    for (const a of filtered) m.set(a.category, [...(m.get(a.category) ?? []), a])
    return [...m.entries()]
  }, [filtered])

  return (
    <div>
      <PageHeader
        title={t('kb.title')}
        subtitle={t('kb.subtitle')}
      />
      <div className="relative mb-5 max-w-xl">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted" />
        <input className="field pl-10" placeholder={t('kb.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {lang !== 'ru' && <p className="-mt-2 mb-5 text-sm text-muted">{t('kb.contentNote')}</p>}
      {isLoading && <PageLoader />}
      {!isLoading && filtered.length === 0 && (
        <Card>
          <Empty icon={<BookOpen className="h-6 w-6" />} title={t('kb.notFound')} text={t('kb.notFoundText')} />
        </Card>
      )}
      <div className="space-y-6">
        {groups.map(([cat, items]) => (
          <section key={cat}>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{cat}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((a) => (
                <Link key={a.id} to={`/knowledge/${a.slug}`} className="card group p-4 transition hover:border-brand-300">
                  <div className="flex items-start justify-between gap-2">
                    <FileText className="h-5 w-5 text-brand-600" />
                    {a.visibility !== 'all' && (
                      <Badge className="bg-violet-50 text-violet-700 ring-violet-200">
                        <Lock className="h-3 w-3" /> {a.visibility === 'hr' ? t('kb.onlyHr') : t('kb.managers')}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 font-semibold text-ink group-hover:text-brand-800">{lang === 'kk' && a.title_kk ? a.title_kk : a.title}</div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{a.summary}</p>
                  <p className="mt-2 text-xs text-muted">{a.source_title}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function Article({ slug }: { slug: string }) {
  const { lang } = useI18n()
  const { data, isLoading } = useKbArticle(slug)
  const location = useLocation()
  const anchor = decodeURIComponent(location.hash.replace(/^#/, ''))

  useEffect(() => {
    if (!data || !anchor) return
    const el = document.querySelector(`[data-heading="${CSS.escape(anchor)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [data, anchor])

  if (isLoading) return <PageLoader />
  if (!data)
    return (
      <Card>
        <Empty title={t('kb.unavailable')} text={t('kb.unavailableText')} />
      </Card>
    )

  const sections = data.content.split(/\n(?=## )/)
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/knowledge" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-brand-700">
        ← {t('kb.back')}
      </Link>
      <Card className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-canvas text-ink-soft ring-line">{data.category}</Badge>
          {data.visibility !== 'all' && <Badge className="bg-violet-50 text-violet-700 ring-violet-200">{data.visibility === 'hr' ? t('kb.onlyHr') : t('kb.managers')}</Badge>}
        </div>
        <h1 className="mt-3 text-2xl font-bold">{data.title}</h1>
        {data.title_kk && (lang === 'ru' || lang === 'kk') && <p className="mt-1 text-muted">{data.title_kk}</p>}
        {lang !== 'ru' && <p className="mt-2 text-sm text-muted">{t('kb.contentNote')}</p>}
        <div className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
          <span className="font-semibold">{t('kb.source')}</span> {data.source_title} · {t('kb.updated', { date: fmtDate(data.updated_at) })}
        </div>
        <div className="mt-6 space-y-2">
          {sections.map((sec, i) => {
            const heading = sec.match(/^## (.+)$/m)?.[1] ?? ''
            const highlighted = heading && heading === anchor
            return (
              <div
                key={i}
                data-heading={heading}
                className={cn('prose-jana rounded-2xl px-4 py-1 transition', highlighted && 'bg-amber-50 ring-2 ring-amber-200')}
              >
                <ReactMarkdown>{sec}</ReactMarkdown>
              </div>
            )
          })}
        </div>
        <div className="mt-8 flex items-center gap-2 border-t border-line pt-5 text-sm text-muted">
          <Sparkles className="h-4 w-4 text-brand-600" /> {t('kb.aiRefers')}
        </div>
      </Card>
    </div>
  )
}
