#!/usr/bin/env node
/**
 * Применяет схему JanaMen (supabase/migrations) и демо-данные (supabase/seed.sql)
 * к базе Supabase напрямую по протоколу Postgres — альтернатива SQL Editor и `supabase db push`.
 *
 *   SUPABASE_DB_URL="postgresql://postgres.<ref>:<пароль>@<хост-пулера>:5432/postgres" npm run db:apply
 *   SUPABASE_PROJECT_REF=<ref> SUPABASE_DB_PASSWORD=<пароль> npm run db:apply
 *     (во втором варианте хост пулера Supavisor находится автоматически по региону проекта)
 *
 * Необязательно:
 *   SKIP_SEED=1        только миграции, без демо-данных
 *   APPLY_ONCE=1       ничего не делать, если демо-данные уже загружены
 *   SUPABASE_REGION    регион проекта, например eu-central-1 (ускоряет поиск пулера)
 *   SUPABASE_CA_CERT   PEM-сертификат Supabase для проверки сервера; без него соединение
 *                      шифруется без проверки сертификата (как sslmode=require в libpq)
 *   --serve            после выполнения держать HTTP-статус на $PORT (для запуска на PaaS, например Render)
 */
import { readdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGIONS = [
  'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1',
]

const status = { state: 'starting', log: [] }
function log(message) {
  const line = `${new Date().toISOString()} ${message}`
  status.log.push(line)
  console.log(line)
}

const tls = () => (process.env.SUPABASE_CA_CERT ? { ca: process.env.SUPABASE_CA_CERT } : { rejectUnauthorized: false })

async function tryConnect(config) {
  const client = new pg.Client({ ...config, connectionTimeoutMillis: 10_000 })
  client.on('notice', () => {}) // NOTICE от миграций не нужны в логе
  try {
    await client.connect()
    return client
  } catch (error) {
    await client.end().catch(() => {})
    throw error
  }
}

async function connect() {
  const url = process.env.SUPABASE_DB_URL
  if (url) {
    const parsed = new URL(url)
    const local = ['localhost', '127.0.0.1', 'db'].includes(parsed.hostname) || parsed.searchParams.get('sslmode') === 'disable'
    parsed.searchParams.delete('sslmode')
    const client = await tryConnect({ connectionString: parsed.toString(), ssl: local ? false : tls() })
    log(`подключено к ${parsed.hostname}`)
    return client
  }

  const ref = process.env.SUPABASE_PROJECT_REF
  const password = process.env.SUPABASE_DB_PASSWORD
  if (!ref || !password) throw new Error('Задайте SUPABASE_DB_URL или SUPABASE_PROJECT_REF и SUPABASE_DB_PASSWORD')
  const regions = process.env.SUPABASE_REGION ? [process.env.SUPABASE_REGION] : REGIONS
  for (const prefix of ['aws-0', 'aws-1']) {
    for (const region of regions) {
      const host = `${prefix}-${region}.pooler.supabase.com`
      try {
        // Сессионный режим пулера (порт 5432): нужен для временных таблиц и функций в seed.sql
        const client = await tryConnect({ host, port: 5432, user: `postgres.${ref}`, password, database: 'postgres', ssl: tls() })
        log(`подключено к ${host}`)
        return client
      } catch (error) {
        // Неверный пароль — останавливаемся сразу, чтобы не получить блокировку за повторные попытки
        if (error.code === '28P01' || /password authentication failed/i.test(error.message)) {
          throw new Error(`неверный пароль базы данных для проекта ${ref} (${host})`)
        }
        log(`${host}: ${error.message}`) // «Tenant or user not found» — другой регион, пробуем дальше
      }
    }
  }
  throw new Error('пулер проекта не найден — укажите SUPABASE_REGION или полный SUPABASE_DB_URL')
}

async function alreadySeeded(client) {
  const { rows } = await client.query(`select to_regclass('public.employees') is not null as present`)
  if (!rows[0].present) return false
  const count = await client.query('select count(*)::int as n from public.employees')
  return count.rows[0].n > 0
}

async function apply(client) {
  await client.query('set statement_timeout = 0')
  if (process.env.APPLY_ONCE === '1' && (await alreadySeeded(client))) {
    log('демо-данные уже загружены — пропускаю (APPLY_ONCE=1)')
    return
  }
  const dir = path.join(root, 'supabase', 'migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    log(`миграция ${file}`)
    await client.query(readFileSync(path.join(dir, file), 'utf8'))
  }
  if (process.env.SKIP_SEED !== '1') {
    log('демо-данные: supabase/seed.sql')
    await client.query(readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8'))
  }
  await client.query(`notify pgrst, 'reload schema'`)
  const { rows } = await client.query(
    `select (select count(*) from public.employees)::int as employees,
            (select count(*) from auth.users where email like '%@jana.test')::int as accounts`,
  )
  log(`готово: сотрудников — ${rows[0].employees}, тестовых учётных записей — ${rows[0].accounts}`)
}

const serveMode = process.argv.includes('--serve')
if (serveMode) {
  const port = Number(process.env.PORT ?? 10000)
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`state: ${status.state}\n\n${status.log.join('\n')}\n`)
    })
    .listen(port, () => console.log(`статус на порту ${port}`))
}

try {
  if (!process.env.SUPABASE_DB_URL && !process.env.SUPABASE_DB_PASSWORD) {
    status.state = 'idle'
    log('учётные данные базы не заданы — ничего не делаю')
  } else {
    const client = await connect()
    try {
      await apply(client)
      status.state = 'done'
    } finally {
      await client.end()
    }
  }
} catch (error) {
  status.state = 'error'
  log(`ОШИБКА: ${error.message}`)
  if (!serveMode) process.exitCode = 1
}
