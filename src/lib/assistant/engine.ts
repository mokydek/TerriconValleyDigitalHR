/**
 * AI Jana — встроенный режим «строго по базе знаний».
 * Работает без LLM: распознаёт намерение, берёт ответ из утверждённых источников
 * (база знаний, собственные данные пользователя, аналитика по роли) и всегда
 * показывает источник. Если надёжного ответа нет — честно говорит об этом.
 * Все данные запрашиваются с токеном пользователя, поэтому RLS не даёт увидеть чужое.
 */
import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtRange, isoDate, money, num } from '@/lib/format'
import type { KbHit, Role } from '@/lib/types'

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

const STATUS_RU: Record<string, string> = {
  pending: 'на согласовании у руководителя',
  approved: 'согласована, ждёт оформления HR',
  processing: 'передана в 1С:ЗУП, оформляется',
  done: 'оформлена',
  rejected: 'отклонена',
  cancelled: 'отменена',
}

const COURSE_STATUS: Record<string, string> = { assigned: 'не начат', in_progress: 'в процессе', completed: 'пройден' }

function norm(s: string) {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

const PROFILE_SOURCE: AiSource = { kind: 'profile', title: 'Личный кабинет JanaМен · данные 1С:ЗУП' }
const analyticsSource = (): AiSource => ({ kind: 'analytics', title: `Аналитика JanaМен на ${fmtDate(new Date(), 'dd.MM.yyyy')}` })

/* ---------- Защита: чужие персональные данные ---------- */

const SENSITIVE = /(зарплат|заработн|оклад|(^|[^а-я])зп(?![а-я])|получает|иин|адрес|дат[аы] рождени|день рождени|паспорт|удостоверени|больничн|диагноз|болеет|телефон|премия|штраф|кредит)/
const OTHERS = /(у (моего |моей |нашего |нашей )?(руководител|начальник|коллег|директор|сотрудник|друг|сосед)|других сотрудник|чуж|коллеги(?![а-я])|всех сотрудник|кто сколько)/
const NAME_REF = /(?:у|про|о|об)\s+([А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]{2,})/

function asksForOthersData(raw: string, q: string, myFirstName: string): boolean {
  if (!SENSITIVE.test(q)) return false
  if (OTHERS.test(q)) return true
  const m = raw.match(NAME_REF)
  return Boolean(m && m[1].toLowerCase() !== myFirstName.toLowerCase())
}

/* ---------- Период из фразы ---------- */

function parsePeriod(q: string): { from: Date; to: Date; label: string } {
  const now = new Date()
  if (/следующ[а-я]* недел|след\.? недел|на неделе после/.test(q)) {
    const start = startOfWeek(addDays(now, 7), { weekStartsOn: 1 })
    return { from: start, to: endOfWeek(start, { weekStartsOn: 1 }), label: 'на следующей неделе' }
  }
  if (/эт[а-я]* недел|текущ[а-я]* недел/.test(q)) {
    return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }), label: 'на этой неделе' }
  }
  if (/завтра/.test(q)) return { from: addDays(now, 1), to: addDays(now, 1), label: 'завтра' }
  if (/следующ[а-я]* месяц/.test(q)) {
    const start = startOfMonth(addDays(endOfMonth(now), 1))
    return { from: start, to: endOfMonth(start), label: 'в следующем месяце' }
  }
  if (/эт[а-я]* месяц/.test(q)) return { from: startOfMonth(now), to: endOfMonth(now), label: 'в этом месяце' }
  if (/сегодня|сейчас|в данный момент/.test(q)) return { from: now, to: now, label: 'сегодня' }
  return { from: now, to: addDays(now, 7), label: 'в ближайшие 7 дней' }
}

/* ---------- Аналитика по роли ---------- */

async function analytics(kind: string, params: Record<string, unknown>) {
  const { data, error } = await supabase.rpc('analytics_query', { p_kind: kind, p_params: params })
  if (error) throw new Error(error.message)
  return data as { scope: 'company' | 'team'; rows: Record<string, unknown>[] }
}

async function tryAnalytics(q: string, role: Role): Promise<AiAnswer | null> {
  const isOnVacation = /(кто|сколько).*(в отпуске|отдыха|отсутству|уходит в отпуск|будет в отпуске|уйдет в отпуск)/.test(q)
  const isVacationOver = /(у кого|кто|сколько).*(больше|более|свыше|накопил|накоплен|много).*(дн|отпуск)/.test(q)
  const isCourseDept = /(как[а-я]* (отдел|подразделени)|в как[а-я]* (отдел|подразделени)|по отделам|по подразделениям).*(хуже|лучше|меньше|больше|отста|прош|проход|обучен|курс|охран)|(охран|безопасност|курс|обучени).*(отдел|подразделени)/.test(q)
  const isRequestsInWork = /(сколько|какие|покажи).*(заявк).*(в работе|висят|висит|на согласовании|ждут|завис|не оформлен)/.test(q)
  const isOverdue = /(просроч).*(курс|обучени)|(кто).*(не прош[её]л|не сдал).*(курс|обучени|тест)/.test(q)
  const isHeadcount = /(сколько|численность).*(сотрудник|человек|штат)|численност/.test(q)
  const isNewcomers = /(новичк|новые сотрудник|кто (недавно )?(пришел|вышел на работу)|принят[а-я]* недавно)/.test(q)

  if (!(isOnVacation || isVacationOver || isCourseDept || isRequestsInWork || isOverdue || isHeadcount || isNewcomers)) return null

  if (role === 'employee') {
    return {
      status: 'refused',
      text: 'Сводные данные по сотрудникам доступны руководителю и HR. Могу рассказать о ваших собственных данных — например, остатке отпуска или статусе заявок.',
      sources: [],
      mode: 'kb',
    }
  }

  const scopeLabel = role === 'hr' ? 'по компании' : 'по вашей команде'

  if (isVacationOver) {
    const m = q.match(/(\d+)\s*(дн|ден)/)
    const threshold = m ? Number(m[1]) : 30
    const data = await analytics('vacation_over', { threshold })
    const rows = data.rows as { name: string; department: string; available: number }[]
    return {
      status: 'analytics',
      text: rows.length
        ? `Остаток отпуска больше ${threshold} дн. ${scopeLabel} — ${rows.length} чел. Лучше заранее запланировать им отпуск, чтобы снизить риск выгорания.`
        : `Сотрудников с остатком больше ${threshold} дней ${scopeLabel} нет.`,
      table: rows.length ? { columns: ['Сотрудник', 'Подразделение', 'Остаток, дн.'], rows: rows.map((r) => [r.name, r.department ?? '—', num(r.available, 1)]) } : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
      actions: role === 'hr' ? [{ label: 'Открыть «Зону внимания»', to: '/' }] : undefined,
    }
  }

  if (isCourseDept || (isOverdue && /отдел|подразделени/.test(q))) {
    const course = /охран|безопасност на склад|техник[а-я]* безопасн|(^|[^а-я])от(?![а-я])/.test(q)
      ? 'safety'
      : /информацион|(^|[^а-я])иб(?![а-я])|персональн/.test(q)
        ? 'infosec'
        : /адаптац|добро пожаловать|онбординг/.test(q)
          ? 'welcome'
          : ''
    const data = await analytics('course_by_department', { course })
    const rows = data.rows as { department: string; course: string; assigned: number; completed: number; pct: number; overdue: number }[]
    if (!rows.length) return { status: 'analytics', text: 'По этому курсу пока нет назначений.', sources: [analyticsSource()], mode: 'kb' }
    const worst = rows[0]
    return {
      status: 'analytics',
      text: `Хуже всего ${course ? `курс «${worst.course}» ` : 'обязательное обучение '}проходит «${worst.department}»: ${worst.completed} из ${worst.assigned} (${worst.pct}%)${worst.overdue ? `, просрочено — ${worst.overdue}` : ''}. Ниже — все подразделения ${scopeLabel}.`,
      table: {
        columns: ['Подразделение', 'Курс', 'Пройдено', '%', 'Просрочено'],
        rows: rows.map((r) => [r.department, r.course, `${r.completed}/${r.assigned}`, `${r.pct}%`, r.overdue]),
      },
      sources: [analyticsSource()],
      mode: 'kb',
      actions: [{ label: 'Аналитика обучения', to: '/analytics?tab=learning' }],
    }
  }

  if (isOnVacation) {
    const period = parsePeriod(q)
    const data = await analytics('on_vacation', { from: isoDate(period.from), to: isoDate(period.to) })
    const rows = data.rows as { name: string; department: string; start_date: string; end_date: string; status: string }[]
    return {
      status: 'analytics',
      text: rows.length
        ? `${period.label[0].toUpperCase() + period.label.slice(1)} (${fmtRange(isoDate(period.from), isoDate(period.to))}) ${scopeLabel} в отпуске ${rows.length} чел.`
        : `${period.label[0].toUpperCase() + period.label.slice(1)} ${scopeLabel} никто не в отпуске.`,
      table: rows.length
        ? {
            columns: ['Сотрудник', 'Подразделение', 'Период', 'Статус'],
            rows: rows.map((r) => [r.name, r.department ?? '—', fmtRange(r.start_date, r.end_date), STATUS_RU[r.status] ?? r.status]),
          }
        : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
    }
  }

  if (isOverdue) {
    const data = await analytics('overdue_courses', {})
    const rows = data.rows as { name: string; course: string; due_date: string; progress: number }[]
    return {
      status: 'analytics',
      text: rows.length ? `Просроченное обучение ${scopeLabel}: ${rows.length}.` : `Просроченного обучения ${scopeLabel} нет. 👏`,
      table: rows.length ? { columns: ['Сотрудник', 'Курс', 'Срок', 'Прогресс'], rows: rows.map((r) => [r.name, r.course, fmtDate(r.due_date), `${r.progress}%`]) } : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
    }
  }

  if (isRequestsInWork) {
    const data = await analytics('requests_in_work', {})
    const rows = data.rows as { number: number; type: string; employee: string; status: string; approver: string | null; hours: number }[]
    return {
      status: 'analytics',
      text: rows.length ? `В работе ${rows.length} заявок ${scopeLabel}. Самая старая ждёт ${Math.round(Math.max(...rows.map((r) => r.hours)) / 24)} дн.` : `Заявок в работе ${scopeLabel} нет.`,
      table: rows.length
        ? { columns: ['№', 'Тип', 'Сотрудник', 'Этап', 'Ждёт, ч'], rows: rows.map((r) => [r.number, r.type, r.employee, STATUS_RU[r.status] ?? r.status, r.hours]) }
        : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
      actions: [{ label: 'Открыть заявки', to: '/approvals' }],
    }
  }

  if (isNewcomers) {
    const data = await analytics('newcomers', {})
    const rows = data.rows as { name: string; position: string; hire_date: string }[]
    return {
      status: 'analytics',
      text: rows.length ? `Новичков за последние 90 дней ${scopeLabel}: ${rows.length}.` : `Новых сотрудников за 90 дней ${scopeLabel} нет.`,
      table: rows.length ? { columns: ['Сотрудник', 'Должность', 'Дата приёма'], rows: rows.map((r) => [r.name, r.position, fmtDate(r.hire_date)]) } : undefined,
      sources: [analyticsSource()],
      mode: 'kb',
    }
  }

  const data = await analytics('headcount', {})
  const rows = data.rows as { department: string; count: number }[]
  const total = rows.reduce((s, r) => s + Number(r.count), 0)
  return {
    status: 'analytics',
    text: `Численность ${scopeLabel}: ${total} чел.`,
    table: { columns: ['Подразделение', 'Человек'], rows: rows.map((r) => [r.department, r.count]) },
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

async function tryPersonal(q: string): Promise<AiAnswer | null> {
  const balance = /(сколько|остат|осталось|баланс|доступно).*(отпуск|дней отдыха|демалыс)|(отпуск|демалыс).*(осталось|остаток|сколько у меня|мне положено еще)|қалды/.test(q)
  const myRequests = /(статус|где|что с|как там).*(заявк|отпуск|аванс|справк)|(мои|моя|моих|моей) заявк/.test(q)
  const myCourses = /(мои|мой|мне назначен|назначенн).*(курс|обучени)|какие (у меня )?курсы|что (мне )?(нужно )?пройти/.test(q)
  const myManager = /(кто|мой|моя).*(руководител|начальник)/.test(q) && !/зарплат|оклад/.test(q)
  const myHire = /(когда|дата).*(принят|приема|трудоустро)|мой стаж|сколько я работаю/.test(q)
  if (!(balance || myRequests || myCourses || myManager || myHire)) return null

  const ctx = await context()
  if (balance) {
    const v = ctx.vacation
    return {
      status: 'personal',
      text: `У вас доступно **${num(v.available, 1)} дн.** отпуска на ${v.year} год: положено ${num(v.entitled - (v.carryover_from_last_year ?? 0), 1)}${v.carryover_from_last_year ? ` + ${num(v.carryover_from_last_year, 1)} перенесено с прошлого года` : ''}, уже оформлено ${num(v.used, 1)}, на согласовании ${num(v.reserved, 1)}. Праздничные дни в отпуск не засчитываются.`,
      sources: [PROFILE_SOURCE],
      mode: 'kb',
      actions: [{ label: 'Оформить отпуск', to: '/requests?new=vacation' }],
    }
  }
  if (myRequests) {
    if (!ctx.requests.length) {
      return { status: 'personal', text: 'У вас пока нет заявок.', sources: [PROFILE_SOURCE], mode: 'kb', actions: [{ label: 'Новая заявка', to: '/requests?new=vacation' }] }
    }
    return {
      status: 'personal',
      text: 'Ваши последние заявки:',
      table: {
        columns: ['№', 'Тип', 'Детали', 'Статус'],
        rows: ctx.requests.map((r) => [
          r.number,
          r.type,
          r.amount ? money(r.amount) : r.start_date ? fmtRange(r.start_date, r.end_date) : fmtDate(r.created_at),
          STATUS_RU[r.status] ?? r.status,
        ]),
      },
      sources: [PROFILE_SOURCE],
      mode: 'kb',
      actions: [{ label: 'Мои заявки', to: '/requests' }],
    }
  }
  if (myCourses) {
    if (!ctx.courses.length) return { status: 'personal', text: 'Назначенных курсов нет. Загляните в каталог Jana Academy.', sources: [PROFILE_SOURCE], mode: 'kb', actions: [{ label: 'Jana Academy', to: '/academy' }] }
    return {
      status: 'personal',
      text: 'Ваше обучение в Jana Academy:',
      table: {
        columns: ['Курс', 'Статус', 'Прогресс', 'Срок'],
        rows: ctx.courses.map((c) => [c.title, COURSE_STATUS[c.status] ?? c.status, `${c.progress}%${c.score ? ` · тест ${c.score}%` : ''}`, c.due_date ? fmtDate(c.due_date) : '—']),
      },
      sources: [PROFILE_SOURCE],
      mode: 'kb',
      actions: [{ label: 'Открыть Jana Academy', to: '/academy' }],
    }
  }
  if (myManager) {
    return {
      status: 'personal',
      text: ctx.profile.manager
        ? `Ваш непосредственный руководитель — **${ctx.profile.manager}**. Он(а) первым согласует ваши заявки на отпуск и аванс.`
        : 'В 1С:ЗУП у вас не указан непосредственный руководитель — ваши заявки сразу попадают в HR.',
      sources: [PROFILE_SOURCE],
      mode: 'kb',
      actions: [{ label: 'Мой профиль', to: '/profile' }],
    }
  }
  return {
    status: 'personal',
    text: `Вы приняты в ${ctx.profile.company} ${fmtDate(ctx.profile.hire_date)} на должность «${ctx.profile.position}».`,
    sources: [PROFILE_SOURCE],
    mode: 'kb',
  }
}

/* ---------- База знаний ---------- */

function isReliable(hit: KbHit): boolean {
  const coverage = hit.matched / Math.max(1, hit.total_terms)
  if (hit.total_terms <= 2) return hit.matched === hit.total_terms
  return (hit.matched >= 2 && coverage >= 0.5) || coverage >= 0.75
}

async function tryKnowledgeBase(question: string): Promise<AiAnswer | null> {
  const { data, error } = await supabase.rpc('kb_search', { p_query: question, p_limit: 4 })
  if (error) throw new Error(error.message)
  const hits = (data ?? []) as KbHit[]
  const reliable = hits.filter(isReliable)
  if (!reliable.length) return null
  const top = reliable[0]
  // второй фрагмент той же статьи, если он тоже уверенно найден
  const extra = reliable.slice(1).find((h) => h.article_id === top.article_id && h.matched >= top.matched - 1)
  const parts = [top, ...(extra ? [extra] : [])]
  return {
    status: 'answered',
    text: parts.map((h) => h.content).join('\n\n'),
    sources: parts.map((h) => ({ kind: 'kb', title: h.title, slug: h.slug, heading: h.heading, source_title: h.source_title })),
    mode: 'kb',
    actions: /отпуск/i.test(top.title)
      ? [{ label: 'Оформить отпуск', to: '/requests?new=vacation' }]
      : /аванс/i.test(top.title)
        ? [{ label: 'Запросить аванс', to: '/requests?new=advance' }]
        : /справк/i.test(top.title)
          ? [{ label: 'Заказать справку', to: '/requests?new=certificate' }]
          : undefined,
  }
}

/* ---------- Точка входа ---------- */

export async function answerLocally(question: string, opts: { role: Role; firstName: string }): Promise<AiAnswer> {
  const q = norm(question)

  if (/^(привет|здравств|добрый (день|вечер)|доброе утро|салем|сәлем|hello|hi\b)/.test(q) || /(что|чем) (ты )?(умеешь|можешь помочь)|кто ты/.test(q)) {
    return {
      status: 'smalltalk',
      text:
        'Здравствуйте! Я AI Jana — HR-помощник JanaМен. Подскажу, как оформить отпуск, аванс или справку, сколько у вас дней отпуска и статус заявок, что пройти в Jana Academy. Отвечаю только по базе знаний HR и всегда показываю источник.' +
        (opts.role !== 'employee' ? ' Ещё могу показать цифры по вашей команде: кто в отпуске, у кого накопился отпуск, как идёт обучение.' : ''),
      sources: [{ kind: 'kb', title: 'Как работает AI Jana', slug: 'ai-jana', heading: 'Откуда AI Jana берёт ответы', source_title: 'Политика использования AI Jana (демо)' }],
      mode: 'kb',
    }
  }

  if (asksForOthersData(question, q, opts.firstName)) {
    return {
      status: 'refused',
      text: 'Я не раскрываю персональные данные других сотрудников — зарплату, ИИН, адрес, сведения о здоровье. Это защищено политикой конфиденциальности и правами доступа JanaМен.',
      sources: [{ kind: 'kb', title: 'Как работает AI Jana', slug: 'ai-jana', heading: 'Чего AI Jana не делает', source_title: 'Политика использования AI Jana (демо)' }],
      mode: 'kb',
    }
  }

  const personal = await tryPersonal(q)
  if (personal) return personal

  const stats = await tryAnalytics(q, opts.role)
  if (stats) return stats

  const kb = await tryKnowledgeBase(question)
  if (kb) return kb

  return {
    status: 'no_answer',
    text: 'В базе знаний нет надёжного ответа на этот вопрос. Я не буду гадать — могу передать вопрос в HR, и ответ придёт вам в уведомления.',
    sources: [],
    mode: 'kb',
  }
}

/* ---------- Сервер (LLM) с откатом на встроенный режим ---------- */

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
        body: JSON.stringify({ question, history }),
      })
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const json = (await res.json()) as { status: AiAnswer['status']; answer: string; sources: AiSource[] }
        return { status: json.status, text: json.answer, sources: json.sources ?? [], mode: 'llm' }
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
