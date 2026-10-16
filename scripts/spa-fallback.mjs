#!/usr/bin/env node
/**
 * После сборки кладёт index.html в каталоги маршрутов SPA (dist/requests/index.html и т. д.) и 404.html,
 * чтобы прямые ссылки открывались с кодом 200 на любом статическом хостинге без правил переписывания
 * (Render static, GitHub Pages). На Vercel и в Docker-шлюзе есть свои правила — копии им не мешают.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const index = path.join(dist, 'index.html')
if (!existsSync(index)) {
  console.error('dist/index.html не найден — сначала vite build')
  process.exit(1)
}

const routes = [
  'login', 'profile', 'requests', 'academy', 'assistant', 'knowledge', 'notifications', 'tasks', 'announcements',
  'approvals', 'team', 'employees', 'analytics', 'tickets', 'integrations',
]
// Курсы и статьи базы знаний из демо-данных: на них чаще всего дают прямые ссылки
const seed = readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8')
for (const slug of ['welcome', 'safety', 'infosec', 'service']) routes.push(`academy/${slug}`)
const kb = seed.slice(seed.indexOf('insert into public.kb_articles'))
for (const m of kb.matchAll(/^\s*\('([a-z0-9-]+)',/gm)) routes.push(`knowledge/${m[1]}`)

copyFileSync(index, path.join(dist, '404.html'))
for (const route of new Set(routes)) {
  const dir = path.join(dist, route)
  mkdirSync(dir, { recursive: true })
  copyFileSync(index, path.join(dir, 'index.html'))
}
console.log(`SPA: index.html скопирован в ${new Set(routes).size} маршрутов + 404.html`)
