#!/usr/bin/env node
/**
 * Проверка развёрнутого стенда JanaМен «только чтение»: входит под каждым тестовым
 * аккаунтом и читает данные через публичный API Supabase — ничего не меняет.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> npm run check:stand
 *   --serve   держать HTTP-страницу с результатом на $PORT (для запуска на PaaS)
 */
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Jana2026!' // публичный пароль тестовых аккаунтов (см. README)

const lines = []
let failed = 0
const out = (ok, name, detail = '') => {
  if (!ok) failed++
  const line = `${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`
  lines.push(line)
  console.log(line)
}

// Те же запросы со связями, что делает интерфейс (src/lib/api.ts, src/lib/auth.tsx)
const EMPLOYEE_SELECT =
  '*, department:departments!employees_department_fk(id,name), location:locations!employees_location_fk(id,name,city,country), manager:manager(id,first_name,last_name,position,email,phone)'
const REQUEST_SELECT =
  '*, employee:employees!requests_employee_fk(id,first_name,last_name,position,manager_id,department_id,department:departments!employees_department_fk(name)), approver:employees!requests_approver_fk(id,first_name,last_name,role)'
const TASK_SELECT =
  '*, assignee:employees!tasks_assignee_fk(id,first_name,last_name,position), creator:employees!tasks_creator_fk(id,first_name,last_name,position)'

async function appQueries(sb, me, role, email) {
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
  const checks = [
    ['профиль со связями', () => sb.from('employees').select(EMPLOYEE_SELECT).eq('id', me.id).maybeSingle()],
    ['заявки со связями', () => sb.from('requests').select(REQUEST_SELECT).order('created_at', { ascending: false }).limit(50)],
    ['история заявки', async () => {
      const { data } = await sb.from('requests').select('id').limit(1)
      return data?.[0] ? sb.from('request_events').select('*, actor:employees!request_events_actor_fk(first_name,last_name,position)').eq('request_id', data[0].id) : { data: [], error: null }
    }],
    ['обучение', () => sb.from('course_assignments').select('*, course:courses(*)').eq('employee_id', me.id)],
    ['курсы и уроки', () => sb.from('course_lessons').select('course_id')],
    ['задачи', () => sb.from('tasks').select(TASK_SELECT).limit(50)],
    ['объявления', () => sb.from('announcements').select('*, author:employees!announcements_author_fk(first_name,last_name,position), department:departments!announcements_department_fk(name)')],
    ['уведомления', () => sb.from('notifications').select('*').eq('employee_id', me.id).limit(60)],
    ['праздники', () => sb.from('holidays').select('day,name')],
    ['база знаний', () => sb.from('kb_articles').select('*')],
    ['контекст AI Jana', () => sb.rpc('assistant_context')],
  ]
  if (role !== 'employee') {
    checks.push(
      ['отсутствия команды', () => sb.rpc('team_absences', { p_from: today, p_to: in30 })],
      ['сотрудники (таблица)', () => sb.rpc('people_overview')],
      ['графики', () => sb.rpc('hr_charts')],
      ['зона внимания', () => sb.rpc('attention_zone')],
    )
  }
  if (role === 'hr') {
    checks.push(
      ['обращения в HR', () => sb.from('hr_tickets').select('*, employee:employees!hr_tickets_employee_fk(first_name,last_name,position,department:departments!employees_department_fk(name))')],
      ['интеграции: изменения 1С', () => sb.rpc('zup_pending_changes')],
      ['логистика', () => sb.rpc('logistics_overview', { p_days: 30, p_horizon: 45 })],
      ['время этапов', () => sb.rpc('request_stage_times')],
      ['вопросы AI Jana', () => sb.rpc('ai_insights')],
      ['журнал интеграций', () => sb.from('integration_events').select('*').order('created_at', { ascending: false }).limit(20)],
    )
  }
  const failedNames = []
  for (const [name, run] of checks) {
    const { error } = await run()
    if (error) failedNames.push(`${name}: ${error.message}`)
  }
  out(failedNames.length === 0, `запросы интерфейса ${email} (${checks.length})`, failedNames.join(' ; '))
}

async function asUser(email, role) {
  const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: auth, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
  out(!error, `вход ${email}`, error?.message ?? '')
  if (error) return
  const { data: me, error: meErr } = await sb.from('employees').select('id, first_name, last_name, role, position').eq('user_id', auth.user.id).maybeSingle()
  out(!meErr && me?.role === role, `профиль ${email}`, meErr?.message ?? `${me?.first_name} ${me?.last_name} · ${me?.position} · роль ${me?.role}`)
  if (!me) return
  const { data: bal, error: balErr } = await sb.rpc('vacation_balance', { p_employee: me.id })
  out(!balErr, `остаток отпуска ${email}`, balErr?.message ?? `${bal?.[0]?.available} дн.`)
  const { count, error: reqErr } = await sb.from('requests').select('id', { count: 'exact', head: true })
  out(!reqErr, `видимые заявки ${email}`, reqErr?.message ?? `${count}`)
  if (role === 'hr') {
    const { data: dash, error: dashErr } = await sb.rpc('hr_dashboard')
    out(!dashErr && dash?.headcount > 0, 'аналитика HR', dashErr?.message ?? `численность ${dash?.headcount}`)
  }
  await appQueries(sb, me, role, email)
  if (role === 'employee' && email.startsWith('employee')) {
    const { data: kb, error: kbErr } = await sb.rpc('kb_search', { p_query: 'Как оформить аванс?' })
    out(!kbErr && kb?.[0]?.slug === 'advance', 'AI Jana: поиск по базе знаний', kbErr?.message ?? `${kb?.[0]?.title} → «${kb?.[0]?.heading}»`)
    const { error: anaErr } = await sb.rpc('hr_dashboard')
    out(Boolean(anaErr), 'работнику аналитика компании недоступна', anaErr?.message ?? 'ДОСТУПНА — ошибка прав')
  }
  await sb.auth.signOut()
}

const info = (line) => {
  lines.push(line)
  console.log(line)
}

/** Доступность страниц сайта (SPA-маршруты должны отдавать index.html) */
async function web(site) {
  for (const p of ['/', '/requests', '/academy/infosec', '/config.js']) {
    try {
      const res = await fetch(site + p)
      const body = await res.text()
      const spa = body.includes('<div id="root">')
      const moved = res.url !== site + p ? ` → ${new URL(res.url).pathname}` : ''
      out(res.status === 200 && (p === '/config.js' || spa), `страница ${p}`, `${res.status}${moved} · ${res.headers.get('content-type')} · cache-control: ${res.headers.get('cache-control')} · ${spa ? 'SPA' : body.slice(0, 60).replace(/\s+/g, ' ')}`)
      if (p === '/' && spa) {
        // основной скрипт и стили, на которые ссылается текущий index.html
        for (const asset of body.match(/\/assets\/[^"']+\.(js|css)/g) ?? []) {
          const r = await fetch(site + asset)
          out(r.ok, `ресурс ${asset}`, `${r.status} · ${r.headers.get('content-type')} · cache-control: ${r.headers.get('cache-control')}`)
        }
      }
    } catch (error) {
      out(false, `страница ${p}`, error.message)
    }
  }
}

/** Что делали посетители стенда (только чтение, от имени HR) */
async function activity() {
  const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await sb.auth.signInWithPassword({ email: 'hr@jana.test', password: PASSWORD })
  if (error) return info(`активность: вход HR не удался — ${error.message}`)
  const since = new Date(Date.now() - Number(process.env.ACTIVITY_HOURS ?? 12) * 3600_000).toISOString()
  const { data: reqs } = await sb
    .from('requests')
    .select('number, type, status, start_date, end_date, amount, created_at, employee:employees!requests_employee_fk(last_name, first_name)')
    .gte('created_at', since)
    .order('created_at')
  info(`АКТИВНОСТЬ с ${since}: новых заявок — ${reqs?.length ?? 0}`)
  for (const r of reqs ?? []) {
    info(`  №${r.number} ${r.type} ${r.status} · ${r.employee?.last_name} ${r.employee?.first_name} · ${r.start_date ?? ''}–${r.end_date ?? ''} ${r.amount ?? ''} · ${r.created_at}`)
  }
  const { data: ai } = await sb.from('ai_queries').select('question, status, mode, created_at').gte('created_at', since).order('created_at')
  info(`вопросов AI Jana — ${ai?.length ?? 0}`)
  for (const q of ai ?? []) info(`  [${q.status}/${q.mode}] ${q.question}`)
  const { data: tickets } = await sb.from('hr_tickets').select('question, status').gte('created_at', since)
  info(`обращений в HR — ${tickets?.length ?? 0}`)
  const { data: att } = await sb.from('course_attempts').select('score, passed').gte('created_at', since)
  info(`попыток тестов — ${att?.length ?? 0}`)
  const { data: people } = await sb.from('employees').select('id, last_name, zup_id').in('zup_id', ['JP-0013', 'JP-0018', 'JP-0012', 'JP-0002'])
  for (const p of people ?? []) {
    const { data: b } = await sb.rpc('vacation_balance', { p_employee: p.id })
    info(`  остаток отпуска ${p.last_name}: ${b?.[0]?.available} (в работе ${b?.[0]?.reserved})`)
  }
  await sb.auth.signOut()
}

async function main() {
  if (!URL || !KEY) {
    out(false, 'конфигурация', 'задайте SUPABASE_URL и SUPABASE_ANON_KEY')
    return
  }
  lines.push(`Стенд: ${URL}`)
  if (process.env.SITE_URL) await web(process.env.SITE_URL.replace(/\/$/, ''))
  await asUser('employee@jana.test', 'employee')
  await asUser('manager@jana.test', 'manager')
  await asUser('hr@jana.test', 'hr')
  await asUser('newbie@jana.test', 'employee')
  const summary = failed === 0 ? 'ИТОГ: стенд работает' : `ИТОГ: ошибок — ${failed}`
  lines.push(summary)
  console.log(summary)
  if (process.env.ACTIVITY === '1') await activity()
}

try {
  await main()
} catch (error) {
  out(false, 'проверка', error.message)
}

if (process.argv.includes('--serve')) {
  const port = Number(process.env.PORT ?? 10000)
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(lines.join('\n') + '\n')
    })
    .listen(port, () => console.log(`результат на порту ${port}`))
} else if (failed) {
  process.exitCode = 1
}
