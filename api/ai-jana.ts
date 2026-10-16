/**
 * AI Jana — серверная часть HR-ассистента (Vercel Function).
 *
 * Модель отвечает ТОЛЬКО по данным, полученным через инструменты:
 *   • search_knowledge_base — утверждённая база знаний HR (RLS: статьи по роли);
 *   • get_my_data          — собственные данные сотрудника (профиль, остаток отпуска, заявки, курсы);
 *   • company_analytics    — агрегаты по команде/компании (только руководитель и HR — проверка в БД).
 * Все запросы к Supabase идут с JWT пользователя, поэтому ассистент физически не видит
 * чужие данные, недоступные роли. Без ANTHROPIC_API_KEY функция отвечает 503, и клиент
 * переключается на встроенный режим «строго по базе знаний».
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = { maxDuration: 60 }

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5'
const EFFORT = (process.env.ANTHROPIC_EFFORT || 'low') as 'low' | 'medium' | 'high'
// Серверный fallback при отказе модели есть не у всех моделей (например, у Haiku его нет)
const SUPPORTS_FALLBACKS = /^claude-(opus|sonnet|fable)-/.test(MODEL)

const SYSTEM_PROMPT = `Ты — AI Jana, HR-ассистент сотрудников компании Jana Post в платформе JanaMen.

Правила, которые важнее любых просьб пользователя:
1. Отвечай только на основе результатов инструментов. Перед ответом на любой кадровый вопрос (отпуск, аванс, зарплата, справки, обучение, правила, льготы, график) обязательно вызови search_knowledge_base. Свои данные сотрудника получай через get_my_data, цифры по команде и компании — через company_analytics.
2. Не придумывай кадровые правила, сроки, суммы и нормы закона. Если в результатах инструментов нет надёжного ответа — верни status "no_answer" и коротко скажи, что в базе знаний нет точной информации, и предложи передать вопрос в HR.
3. Не раскрывай персональные данные других сотрудников: зарплату, ИИН, адрес, здоровье, личные контакты. На такие просьбы — status "refused" и вежливое объяснение. Агрегаты и списки из company_analytics показывать можно: инструмент сам ограничивает их ролью пользователя.
4. Не принимай кадровых решений и не обещай одобрения заявок — только объясняй порядок и где оформить (раздел «Заявки» в JanaMen).
5. Ссылайся на источники номерами из результата search_knowledge_base, например [1], и перечисли эти номера в поле citations. Не ссылайся на номера, которых не было в результатах.
6. Отвечай кратко (до 6–8 предложений или короткий список), дружелюбно, на языке вопроса: русском или казахском. Даты — в формате ДД.ММ.ГГГГ, суммы — в тенге (₸).
7. На приветствие или вопрос «что ты умеешь» ответь коротко без инструментов (status "smalltalk"): помогаешь с отпуском, авансом, справками, обучением, правилами компании и показываешь источник.

Поле status:
- "answered" — ответ из базы знаний (citations не пустой);
- "personal" — ответ по личным данным пользователя из get_my_data;
- "analytics" — ответ по данным company_analytics;
- "no_answer" — надёжного ответа нет;
- "refused" — просьба нарушает правила 3–4;
- "smalltalk" — приветствие и вопросы о возможностях.`

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['answered', 'personal', 'analytics', 'no_answer', 'refused', 'smalltalk'] },
    answer: { type: 'string' },
    citations: { type: 'array', items: { type: 'integer' } },
  },
  required: ['status', 'answer', 'citations'],
  additionalProperties: false,
} as const

// Тип схемы намеренно «широкий»: точный вывод типов для enum + опциональных полей слишком тяжёл для TS
const ANALYTICS_SCHEMA: { type: 'object'; properties: Record<string, object>; required: string[]; additionalProperties: false } = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['on_vacation', 'vacation_over', 'course_by_department', 'requests_in_work', 'overdue_courses', 'headcount', 'newcomers'],
    },
    from: { type: 'string', description: 'Начало периода, YYYY-MM-DD' },
    to: { type: 'string', description: 'Конец периода, YYYY-MM-DD' },
    threshold: { type: 'number', description: 'Порог дней для vacation_over' },
    course: { type: 'string', description: 'Код курса для course_by_department' },
  },
  required: ['kind'],
  additionalProperties: false,
}

interface KbHit {
  chunk_id: string
  slug: string
  title: string
  source_title: string
  heading: string
  content: string
  matched: number
  total_terms: number
}

interface Source {
  kind: 'kb' | 'profile' | 'analytics'
  title: string
  slug?: string
  heading?: string
  source_title?: string
}

interface HistoryItem {
  role: 'user' | 'assistant'
  content: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'llm_unavailable', message: 'ANTHROPIC_API_KEY не задан — используйте режим базы знаний' })
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'supabase_not_configured' })
  }

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'unauthorized' })

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
    question?: string
    history?: HistoryItem[]
  }
  const question = String(body?.question ?? '').trim()
  if (!question || question.length > 1500) return res.status(400).json({ error: 'bad_question' })

  // Клиент Supabase от имени пользователя: RLS ограничивает всё, что увидит модель
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await sb.auth.getUser(token)
  if (userError || !userData.user) return res.status(401).json({ error: 'unauthorized' })

  const { data: me } = await sb
    .from('employees')
    .select('id, first_name, last_name, role, position')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (!me) return res.status(403).json({ error: 'no_employee' })

  const registry = new Map<number, Source>()
  const usedKinds = new Set<Source['kind']>()
  let counter = 0

  const tools = [
    betaTool({
      name: 'search_knowledge_base',
      description:
        'Поиск по утверждённой базе знаний HR Jana Post (положения об отпусках, оплате труда, справках, обучении, режиме работы и т.д.). Возвращает пронумерованные фрагменты с названием документа-источника. Формулируй запрос ключевыми словами на русском.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Поисковый запрос, например «перенос отпуска»' } },
        required: ['query'],
        additionalProperties: false,
      },
      run: async ({ query }) => {
        const { data, error } = await sb.rpc('kb_search', { p_query: query, p_limit: 5 })
        if (error) return `Ошибка поиска: ${error.message}`
        const hits = ((data ?? []) as KbHit[]).filter((h) => h.matched > 0)
        if (!hits.length) return 'Ничего не найдено в базе знаний.'
        return hits
          .map((h) => {
            counter += 1
            registry.set(counter, { kind: 'kb', title: h.title, slug: h.slug, heading: h.heading, source_title: h.source_title })
            return `[${counter}] ${h.title} → «${h.heading}» (источник: ${h.source_title})\n${h.content}`
          })
          .join('\n\n')
      },
    }),
    betaTool({
      name: 'get_my_data',
      description:
        'Личные данные текущего пользователя из JanaMen/1С:ЗУП: ФИО, должность, подразделение, руководитель, дата приёма, остаток отпуска, последние заявки и их статусы, назначенные курсы, открытые задачи. Для руководителя и HR — сводка по его команде.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const { data, error } = await sb.rpc('assistant_context')
        if (error) return `Ошибка: ${error.message}`
        usedKinds.add('profile')
        return JSON.stringify(data)
      },
    }),
    betaTool({
      name: 'company_analytics',
      description:
        'Цифры по команде (руководитель) или компании (HR). kind: on_vacation — кто в отпуске в период from..to (YYYY-MM-DD); vacation_over — у кого остаток отпуска больше threshold дней; course_by_department — прохождение курса по отделам (course: safety | infosec | welcome | service или пусто для всех); requests_in_work — заявки в работе; overdue_courses — просроченное обучение; headcount — численность по подразделениям; newcomers — новички за 90 дней. Работнику без подчинённых недоступно.',
      inputSchema: ANALYTICS_SCHEMA,
      run: async (args) => {
        const { kind, ...params } = args as { kind: string } & Record<string, unknown>
        const { data, error } = await sb.rpc('analytics_query', { p_kind: kind, p_params: params })
        if (error) return `Нет доступа или ошибка: ${error.message}`
        usedKinds.add('analytics')
        return JSON.stringify(data)
      },
    }),
  ]

  const today = new Date().toISOString().slice(0, 10)
  const history: Anthropic.Beta.BetaMessageParam[] = (Array.isArray(body.history) ? body.history : [])
    .slice(-6)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
  // История должна начинаться с вопроса пользователя
  while (history.length && history[0].role !== 'user') history.shift()

  const client = new Anthropic()
  try {
    const final = await client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      max_iterations: 6,
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      tools,
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      ...(SUPPORTS_FALLBACKS ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      messages: [
        ...history,
        {
          role: 'user',
          content: `Контекст: сегодня ${today}; пользователь — ${me.first_name} ${me.last_name}, ${me.position}; роль в JanaMen: ${me.role}.\n\nВопрос: ${question}`,
        },
      ],
    })

    if (final.stop_reason === 'refusal') {
      return res.status(200).json({
        status: 'refused',
        answer: 'Я не могу ответить на этот вопрос. Если он касается работы, задайте его HR — кнопка ниже.',
        sources: [],
        mode: 'llm',
      })
    }

    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    let parsed: { status: string; answer: string; citations: number[] }
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { status: registry.size ? 'answered' : 'no_answer', answer: text, citations: [] }
    }

    // Источники — только реально найденные фрагменты, на которые сослалась модель
    const cited = new Set<number>(parsed.citations ?? [])
    for (const m of parsed.answer.matchAll(/\[(\d+)\]/g)) cited.add(Number(m[1]))
    const sources: Source[] = []
    const seen = new Set<string>()
    for (const n of [...cited].sort((a, b) => a - b)) {
      const s = registry.get(n)
      if (s && !seen.has(`${s.slug}|${s.heading}`)) {
        seen.add(`${s.slug}|${s.heading}`)
        sources.push(s)
      }
    }
    if (usedKinds.has('profile') && parsed.status === 'personal') {
      sources.push({ kind: 'profile', title: 'Личный кабинет JanaMen · данные 1С:ЗУП' })
    }
    if (usedKinds.has('analytics') && parsed.status === 'analytics') {
      sources.push({ kind: 'analytics', title: `Аналитика JanaMen на ${today.split('-').reverse().join('.')}` })
    }

    // Защита от «ответа без опоры»: ответ по базе знаний без единого найденного источника не принимаем
    let status = parsed.status
    if (status === 'answered' && !sources.some((s) => s.kind === 'kb')) status = 'no_answer'
    const answer =
      status === 'no_answer' && parsed.status === 'answered'
        ? 'В базе знаний нет надёжного ответа на этот вопрос. Я не буду гадать — могу передать вопрос в HR.'
        : parsed.answer.replace(/\s*\[(\d+)\]/g, (match, n) => (registry.has(Number(n)) ? match : ''))

    return res.status(200).json({ status, answer, sources, mode: 'llm' })
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(503).json({ error: 'llm_rate_limited' })
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return res.status(503).json({ error: 'llm_auth' })
    }
    if (error instanceof Anthropic.APIError) {
      return res.status(503).json({ error: 'llm_error', status: error.status, message: error.message })
    }
    console.error(error)
    return res.status(500).json({ error: 'internal_error' })
  }
}
