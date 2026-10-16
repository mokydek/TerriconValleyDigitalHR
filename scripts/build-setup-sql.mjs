#!/usr/bin/env node
/**
 * Собирает supabase/setup.sql — все миграции + демо-данные одним файлом.
 * Его можно вставить в Supabase → SQL Editor и выполнить за один запуск
 * (альтернатива `supabase db push --include-seed`).
 *
 *   npm run db:setup-sql
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'supabase', 'migrations')
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const parts = [
  `-- =====================================================================
-- JanaMen — полная установка базы данных (схема + RLS + функции + демо-данные)
--
-- Сгенерировано scripts/build-setup-sql.mjs — не редактируйте вручную,
-- правьте файлы в supabase/migrations и supabase/seed.sql.
--
-- Как применить: Supabase Dashboard → SQL Editor → New query → вставить
-- файл целиком → Run. Скрипт можно запускать повторно: схема обновится,
-- демо-данные пересоздадутся (тестовые аккаунты *@jana.test, пароль Jana2026!).
-- =====================================================================
`,
]

for (const f of migrations) {
  parts.push(`\n-- ─────────────────────────────────────────────────────────────────────\n-- migration: ${f}\n-- ─────────────────────────────────────────────────────────────────────\n`)
  parts.push(readFileSync(join(dir, f), 'utf8').trim() + '\n')
}

parts.push(`\n-- ─────────────────────────────────────────────────────────────────────\n-- seed: supabase/seed.sql\n-- ─────────────────────────────────────────────────────────────────────\n`)
parts.push(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8').trim() + '\n')

const out = join(root, 'supabase', 'setup.sql')
writeFileSync(out, parts.join(''))
console.log(`supabase/setup.sql: ${migrations.length} миграций + seed, ${(Buffer.byteLength(parts.join('')) / 1024).toFixed(0)} КБ`)
