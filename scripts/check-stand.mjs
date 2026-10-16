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
      const res = await fetch(site + p, { redirect: 'manual' })
      const body = await res.text()
      const spa = body.includes('<div id="root">')
      out(res.status === 200 && (p === '/config.js' || spa), `страница ${p}`, `${res.status} · ${res.headers.get('content-type')} · ${spa ? 'SPA' : body.slice(0, 60).replace(/\s+/g, ' ')}`)
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
