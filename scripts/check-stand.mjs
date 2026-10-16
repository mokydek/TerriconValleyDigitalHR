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

async function main() {
  if (!URL || !KEY) {
    out(false, 'конфигурация', 'задайте SUPABASE_URL и SUPABASE_ANON_KEY')
    return
  }
  lines.push(`Стенд: ${URL}`)
  await asUser('employee@jana.test', 'employee')
  await asUser('manager@jana.test', 'manager')
  await asUser('hr@jana.test', 'hr')
  await asUser('newbie@jana.test', 'employee')
  const summary = failed === 0 ? 'ИТОГ: стенд работает' : `ИТОГ: ошибок — ${failed}`
  lines.push(summary)
  console.log(summary)
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
