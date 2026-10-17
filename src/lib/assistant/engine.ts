/**
 * AI Jana — встроенный режим «строго по базе знаний».
 * Работает без LLM: распознаёт намерение, берёт ответ из утверждённых источников
 * (база знаний, собственные данные пользователя, аналитика по роли) и всегда
 * показывает источник. Если надёжного ответа нет — честно говорит об этом.
 * Все данные запрашиваются с токеном пользователя, поэтому RLS не даёт увидеть чужое.
 * Вопросы распознаются на всех языках интерфейса (intents.ts), ответ пишется на языке интерфейса.
 * Статьи базы знаний и значения из базы (названия курсов, подразделений) остаются на русском.
 */
import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { getLang, t, type I18nKey } from '@/lib/i18n'
import { fmtDate, fmtRange, isoDate, money, num } from '@/lib/format'
import type { KbHit, Role } from '@/lib/types'
import {
  aiJanaSource,
  analyticsIntent,
  articleAction,
  asksForOthersData,
  courseCode,
  isGreeting,
  kbTopicQuery,
  mentionsDepartment,
  NO_DEPARTMENT,
  periodKind,
  personalIntent,
  prepare,
  requestTypeCode,
  vacationThreshold,
  type Query,
} from './intents'

export interface AiSource {
  kind: 'kb' | 'profile' | 'analytics'
  title: string
  slug?: string
  heading?: string
  source_title?: string
}

export interface AiAction {
  label: string
  to: string
}

export interface AiAnswer {
  status: 'answered' | 'personal' | 'analytics' | 'no_answer' | 'refused' | 'smalltalk'
  text: string
  sources: AiSource[]
  mode: 'kb' | 'llm'
  table?: { columns: string[]; rows: (string | number)[][] }
  actions?: AiAction[]
}

/* ---------- Подписи на языке интерфейса ---------- */

const REQUEST_STATUSES = new Set(['pending', 'approved', 'processing', 'done', 'rejected', 'cancelled'])
const requestStatus = (s: string) => (REQUEST_STATUSES.has(s) ? t(`status.${s}` as I18nKey) : s)

/** Тип заявки приходит из базы по-русски (request_type_label) */
function requestType(label: string) {
  const code = requestTypeCode(label)
  return code ? t(`type.${code}`) : label
}

const COURSE_STATUS: Record<string, I18nKey> = { assigned: 'academy.colNotStarted', in_progress: 'academy.colInProgress', completed: 'academy.completed' }
const courseStatus = (s: string) => (COURSE_STATUS[s] ? t(COURSE_STATUS[s]) : s)

const department = (d: string | null) => (!d ? '–' : d === NO_DEPARTMENT ? t('srv.an.noDepartment') : d)

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const profileSource = (): AiSource => ({ kind: 'profile', title: t('jana.src.profile') })
const analyticsSource = (): AiSource => ({ kind: 'analytics', title: t('jana.src.analytics', { date: fmtDate(new Date(), 'dd.MM.yyyy') }) })

const ACTIONS: Record<'vacation' | 'advance' | 'certificate', { label: I18nKey; to: string }> = {
  vacation: { label: 'home.qVacation', to: '/requests?new=vacation' },
  advance: { label: 'home.qAdvance', to: '/requests?new=advance' },
  certificate: { label: 'home.qCertificate', to: '/requests?new=certificate' },
}
const action = (kind: keyof typeof ACTIONS): AiAction => ({ label: t(ACTIONS[kind].label), to: ACTIONS[kind].to })

/* ---------- Период из фразы ---------- */

function parsePeriod(x: Query): { from: Date; to: Date; label: string } {
  const now = new Date()
  const kind = periodKind(x)
  const label = t(`jana.period.${kind}`)
  switch (kind) {
    case 'nextWeek': {
      const start = startOfWeek(addDays(now, 7), { weekStartsOn: 1 })
      return { from: start, to: endOfWeek(start, { weekStartsOn: 1 }), label }
    }
    case 'thisWeek':
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }), label }
    case 'tomorrow':
      return { from: addDays(now, 1), to: addDays(now, 1), label }
    case 'nextMonth': {
      const start = startOfMonth(addDays(endOfMonth(now), 1))
      return { from: start, to: endOfMonth(start), label }
    }
    case 'thisMonth':
      return { from: startOfMonth(now), to: endOfMonth(now), label }
    case 'today':
      return { from: now, to: now, label }
    default:
      return { from: now, to: addDays(now, 7), label }
  }
}

/* ---------- Аналитика по роли ---------- */

async function analytics(kind: string, params: Record<string, unknown>) {
  const { data, error } = await supabase.rpc('analytics_query', { p_kind: kind, p_params: params })
  if (error) throw new Error(error.message)
  return data as { scope: 'company' | 'team'; rows: Record<string, unknown>[] }
}

/** В переводах фраза может начинаться с подставленного периода или охвата: первая буква заглавная */
async function tryAnalytics(x: Query, role: Role): Promise<AiAnswer | null> {
  const a = await analyticsAnswer(x, role)
  return a && { ...a, text: cap(a.text) }
}

async function analyticsAnswer(x: Query, role: Role): Promise<AiAnswer | null> {
  const intent = analyticsIntent(x)
  if (!intent) return null

  if (role === 'employee') {
    return { status: 'refused', text: t('jana.analyticsDenied'), sources: [], mode: 'kb' }
  }

  const scope = t(role === 'hr' ? 'jana.scope.company' : 'jana.scope.team')

  if (intent.vacationOver) {
    const threshold = vacationThreshold(x) ?? 30
    const data = await analytics('vacation_over', { threshold })
    const rows = data.rows as { name: string; department: string; available: number }[]
    return {
      status: 'analytics',
      text: rows.length ? t('jana.vacationOver', { threshold, scope, n: rows.length }) : t('jana.vacationOverNone', { threshold, scope }),
      table: rows.length
        ? {
            columns: [t('req.employee'), t('academy.colDepartment'), t('jana.col.balance')],
            rows: rows.map((r) => [r.name, department(r.department), num(r.available, 1)]),
          }
        : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
      actions: role === 'hr' ? [{ label: t('jana.act.attention'), to: '/' }] : undefined,
    }
  }

  if (intent.courseDept || (intent.overdue && mentionsDepartment(x))) {
    const course = courseCode(x)
    const data = await analytics('course_by_department', { course })
    const rows = data.rows as { department: string; course: string; assigned: number; completed: number; pct: number; overdue: number }[]
    if (!rows.length) return { status: 'analytics', text: t('jana.courseNone'), sources: [analyticsSource()], mode: 'kb' }
    const worst = rows[0]
    return {
      status: 'analytics',
      text: t('jana.courseWorst', {
        what: course ? t('jana.courseWhat', { course: worst.course }) : t('jana.courseWhatAll'),
        department: department(worst.department),
        completed: worst.completed,
        assigned: worst.assigned,
        pct: worst.pct,
        overdue: worst.overdue ? t('jana.courseOverdue', { n: worst.overdue }) : '',
        scope,
      }),
      table: {
        columns: [t('academy.colDepartment'), t('academy.course'), t('academy.colDone'), '%', t('academy.colOverdue')],
        rows: rows.map((r) => [department(r.department), r.course, `${r.completed}/${r.assigned}`, `${r.pct}%`, r.overdue]),
      },
      sources: [analyticsSource()],
      mode: 'kb',
      actions: [{ label: t('jana.act.learning'), to: '/analytics?tab=learning' }],
    }
  }

  if (intent.onVacation) {
    const period = parsePeriod(x)
    const data = await analytics('on_vacation', { from: isoDate(period.from), to: isoDate(period.to) })
    const rows = data.rows as { name: string; department: string; start_date: string; end_date: string; status: string }[]
    return {
      status: 'analytics',
      text: rows.length
        ? t('jana.onVacation', { period: period.label, range: fmtRange(isoDate(period.from), isoDate(period.to)), scope, n: rows.length })
        : t('jana.onVacationNone', { period: period.label, scope }),
      table: rows.length
        ? {
            columns: [t('req.employee'), t('academy.colDepartment'), t('req.period'), t('req.colStatus')],
            rows: rows.map((r) => [r.name, department(r.department), fmtRange(r.start_date, r.end_date), requestStatus(r.status)]),
          }
        : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
    }
  }

  if (intent.overdue) {
    const data = await analytics('overdue_courses', {})
    const rows = data.rows as { name: string; course: string; due_date: string; progress: number }[]
    return {
      status: 'analytics',
      text: rows.length ? t('jana.overdue', { scope, n: rows.length }) : t('jana.overdueNone', { scope }),
      table: rows.length
        ? {
            columns: [t('req.employee'), t('academy.course'), t('jana.col.due'), t('jana.col.progress')],
            rows: rows.map((r) => [r.name, r.course, fmtDate(r.due_date), `${r.progress}%`]),
          }
        : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
    }
  }

  if (intent.requestsInWork) {
    const data = await analytics('requests_in_work', {})
    const rows = data.rows as { number: number; type: string; employee: string; status: string; approver: string | null; hours: number }[]
    return {
      status: 'analytics',
      text: rows.length
        ? t('jana.inWork', { n: rows.length, scope, days: Math.round(Math.max(...rows.map((r) => r.hours)) / 24) })
        : t('jana.inWorkNone', { scope }),
      table: rows.length
        ? {
            columns: [t('req.colNo'), t('req.colType'), t('req.employee'), t('jana.col.stage'), t('jana.col.waitHours')],
            rows: rows.map((r) => [r.number, requestType(r.type), r.employee, requestStatus(r.status), r.hours]),
          }
        : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
      actions: [{ label: t('jana.act.approvals'), to: '/approvals' }],
    }
  }

  if (intent.newcomers) {
    const data = await analytics('newcomers', {})
    const rows = data.rows as { name: string; position: string; hire_date: string }[]
    return {
      status: 'analytics',
      text: rows.length ? t('jana.newcomers', { scope, n: rows.length }) : t('jana.newcomersNone', { scope }),
      table: rows.length
        ? { columns: [t('req.employee'), t('profile.position'), t('profile.hireDate')], rows: rows.map((r) => [r.name, r.position, fmtDate(r.hire_date)]) }
        : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
    }
  }

  const data = await analytics('headcount', {})
  const rows = data.rows as { department: string; count: number }[]
  const total = rows.reduce((s, r) => s + Number(r.count), 0)
  return {
    status: 'analytics',
    text: t('jana.headcount', { scope, n: total }),
    table: { columns: [t('academy.colDepartment'), t('analytics.col.people')], rows: rows.map((r) => [department(r.department), r.count]) },
    sources: [analyticsSource()],
    mode: 'kb',
  }
}

/* ---------- Личные данные ---------- */

interface AssistantContext {
  profile: { full_name: string; company: string; position: string; department: string | null; manager: string | null; hire_date: string }
  vacation: { year: number; entitled: number; used: number; reserved: number; available: number; carryover_from_last_year?: number }
  requests: { number: number; type: string; status: string; start_date: string | null; end_date: string | null; amount: number | null; created_at: string }[]
  courses: { title: string; status: string; progress: number; score: number | null; due_date: string | null }[]
  open_tasks: number
}

async function context(): Promise<AssistantContext> {
  const { data, error } = await supabase.rpc('assistant_context')
  if (error) throw new Error(error.message)
  return data as AssistantContext
}

async function tryPersonal(x: Query): Promise<AiAnswer | null> {
  const intent = personalIntent(x)
  if (!intent) return null

  const ctx = await context()
  if (intent === 'balance') {
    const v = ctx.vacation
    const carry = v.carryover_from_last_year ?? 0
    return {
      status: 'personal',
      text: t('jana.balance', {
        available: num(v.available, 1),
        year: v.year,
        entitled: num(v.entitled - carry, 1),
        carryover: carry ? t('jana.balanceCarryover', { n: num(carry, 1) }) : '',
        used: num(v.used, 1),
        reserved: num(v.reserved, 1),
      }),
      sources: [profileSource()],
      mode: 'kb',
      actions: [action('vacation')],
    }
  }
  if (intent === 'requests') {
    if (!ctx.requests.length) {
      return { status: 'personal', text: t('jana.noRequests'), sources: [profileSource()], mode: 'kb', actions: [{ label: t('req.new'), to: '/requests?new=vacation' }] }
    }
    return {
      status: 'personal',
      text: t('jana.myRequests'),
      table: {
        columns: [t('req.colNo'), t('req.colType'), t('req.details'), t('req.colStatus')],
        rows: ctx.requests.map((r) => [
          r.number,
          requestType(r.type),
          r.amount ? money(r.amount) : r.start_date ? fmtRange(r.start_date, r.end_date) : fmtDate(r.created_at),
          requestStatus(r.status),
        ]),
      },
      sources: [profileSource()],
      mode: 'kb',
      actions: [{ label: t('nav.requests'), to: '/requests' }],
    }
  }
  if (intent === 'courses') {
    if (!ctx.courses.length) {
      return { status: 'personal', text: t('jana.noCourses'), sources: [profileSource()], mode: 'kb', actions: [{ label: 'Jana Academy', to: '/academy' }] }
    }
    return {
      status: 'personal',
      text: t('jana.myCourses'),
      table: {
        columns: [t('academy.course'), t('req.colStatus'), t('jana.col.progress'), t('jana.col.due')],
        rows: ctx.courses.map((c) => [
          c.title,
          courseStatus(c.status),
          `${c.progress}%${c.score ? ` · ${t('academy.testScore', { score: c.score })}` : ''}`,
          c.due_date ? fmtDate(c.due_date) : '–',
        ]),
      },
      sources: [profileSource()],
      mode: 'kb',
      actions: [{ label: t('jana.act.academy'), to: '/academy' }],
    }
  }
  if (intent === 'manager') {
    return {
      status: 'personal',
      text: ctx.profile.manager ? t('jana.manager', { name: ctx.profile.manager }) : t('jana.managerNone'),
      sources: [profileSource()],
      mode: 'kb',
      actions: [{ label: t('nav.profile'), to: '/profile' }],
    }
  }
  return {
    status: 'personal',
    text: t('jana.hired', { company: ctx.profile.company, date: fmtDate(ctx.profile.hire_date), position: ctx.profile.position }),
    sources: [profileSource()],
    mode: 'kb',
  }
}

/* ---------- База знаний ---------- */

function isReliable(hit: KbHit): boolean {
  const coverage = hit.matched / Math.max(1, hit.total_terms)
  if (hit.total_terms <= 2) return hit.matched === hit.total_terms
  return (hit.matched >= 2 && coverage >= 0.5) || coverage >= 0.75
}

async function kbSearch(query: string): Promise<KbHit[]> {
  const { data, error } = await supabase.rpc('kb_search', { p_query: query, p_limit: 4 })
  if (error) throw new Error(error.message)
  return ((data ?? []) as KbHit[]).filter(isReliable)
}

async function tryKnowledgeBase(x: Query): Promise<AiAnswer | null> {
  // Статьи и поиск по ним русские: вопрос на другом языке сначала ищем по русскому запросу его темы
  const ru = getLang() === 'ru'
  const topic = kbTopicQuery(x)
  const queries = [...new Set(ru ? [x.raw, topic] : [topic, x.raw])].filter((s): s is string => Boolean(s))
  let reliable: KbHit[] = []
  for (const query of queries) {
    reliable = await kbSearch(query)
    if (reliable.length) break
  }
  if (!reliable.length) return null
  const top = reliable[0]
  // второй фрагмент той же статьи, если он тоже уверенно найден
  const extra = reliable.slice(1).find((h) => h.article_id === top.article_id && h.matched >= top.matched - 1)
  const parts = [top, ...(extra ? [extra] : [])]
  const kind = articleAction(top.title)
  return {
    status: 'answered',
    text: [...(ru ? [] : [t('jana.kbInRussian')]), ...parts.map((h) => h.content)].join('\n\n'),
    sources: parts.map((h) => ({ kind: 'kb', title: h.title, slug: h.slug, heading: h.heading, source_title: h.source_title })),
    mode: 'kb',
    actions: kind ? [action(kind)] : undefined,
  }
}

/* ---------- Точка входа ---------- */

export async function answerLocally(question: string, opts: { role: Role; firstName: string }): Promise<AiAnswer> {
  const x = prepare(question)

  if (isGreeting(x)) {
    return {
      status: 'smalltalk',
      text: t('jana.greeting') + (opts.role !== 'employee' ? ` ${t('jana.greetingLead')}` : ''),
      sources: [aiJanaSource('about')],
      mode: 'kb',
    }
  }

  if (asksForOthersData(x, opts.firstName)) {
    return { status: 'refused', text: t('jana.refusedOthers'), sources: [aiJanaSource('limits')], mode: 'kb' }
  }

  const personal = await tryPersonal(x)
  if (personal) return personal

  const stats = await tryAnalytics(x, opts.role)
  if (stats) return stats

  const kb = await tryKnowledgeBase(x)
  if (kb) return kb

  return { status: 'no_answer', text: t('jana.noAnswer'), sources: [], mode: 'kb' }
}

/* ---------- Сервер (LLM) с откатом на встроенный режим ---------- */

/** Подписи источников «профиль» и «аналитика» сервер пишет по-русски: заменяем на язык интерфейса */
const localSource = (s: AiSource): AiSource => (s.kind === 'profile' ? profileSource() : s.kind === 'analytics' ? analyticsSource() : s)

export async function askJana(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  opts: { role: Role; firstName: string },
): Promise<AiAnswer> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) {
      const res = await fetch('/api/ai-jana', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, history, lang: getLang() }),
      })
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const json = (await res.json()) as { status: AiAnswer['status']; answer: string; sources: AiSource[]; canned?: 'refused' | 'no_answer' }
        // Готовые фразы сервера (отказ модели, ответ без источника) показываем из словаря
        const text = json.canned === 'refused' ? t('jana.llmRefused') : json.canned === 'no_answer' ? t('jana.noAnswer') : json.answer
        return { status: json.status, text, sources: (json.sources ?? []).map(localSource), mode: 'llm' }
      }
    }
  } catch {
    /* сервер недоступен — работаем во встроенном режиме */
  }
  return answerLocally(question, opts)
}

/** Записываем вопрос в журнал (для аналитики HR и эскалации) */
export async function logQuery(employeeId: string, question: string, a: AiAnswer): Promise<string | null> {
  const status = a.status === 'analytics' || a.status === 'smalltalk' ? 'answered' : a.status
  const { data } = await supabase
    .from('ai_queries')
    .insert({
      employee_id: employeeId,
      question,
      answer: a.text.slice(0, 2000),
      status,
      mode: a.mode,
      sources: a.sources.filter((s) => s.slug).map((s) => ({ slug: s.slug, heading: s.heading })),
    })
    .select('id')
    .single()
  return (data as { id: string } | null)?.id ?? null
}
