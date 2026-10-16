#!/usr/bin/env node
/**
 * CDN хостинга (Render) ещё до 5 минут после обновления может отдавать прежнюю index.html, а её скрипты
 * в новой сборке уже удалены — посетитель видит пустую страницу. Скрипт докладывает в dist/assets файлы
 * сборки, которая сейчас работает на сайте, и прежняя страница открывается, пока CDN не обновится.
 *
 * Работает только при заданном KEEP_ASSETS_FROM (адрес сайта); сбой сети сборку не останавливает.
 */
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const site = (process.env.KEEP_ASSETS_FROM ?? '').replace(/\/$/, '')
if (!site) process.exit(0)

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets')
// чанки Vite ссылаются друг на друга как assets/x.js (предзагрузка) и ./x.js (динамический импорт)
const REF = /(?:assets\/|\.\/)([\w.-]+\.(?:js|css))/g

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res
}

try {
  // ?_r= — мимо кэша CDN, чтобы взять действительно текущую сборку
  const html = await (await get(`${site}/?_r=${Date.now()}`)).text()
  const seen = new Set()
  const queue = []
  const enqueue = (text) => {
    for (const [, name] of text.matchAll(REF)) {
      if (seen.has(name)) continue
      seen.add(name)
      queue.push(name)
    }
  }
  enqueue(html)
  let added = 0
  let skipped = 0
  while (queue.length) {
    const name = queue.shift()
    const file = path.join(assets, name)
    // строка вида ./x.js в коде библиотеки может оказаться не файлом сборки — такие пропускаем
    const body = await get(`${site}/assets/${name}`)
      .then(async (res) => Buffer.from(await res.arrayBuffer()))
      .catch(() => null)
    if (!body) {
      skipped++
      continue
    }
    if (!existsSync(file)) {
      writeFileSync(file, body)
      added++
    }
    if (name.endsWith('.js')) enqueue(body.toString('utf8'))
  }
  console.log(`Прежняя сборка ${site}: файлов ${seen.size - skipped}, добавлено в dist/assets ${added}`)
} catch (error) {
  console.warn(`Файлы прежней сборки не сохранены: ${error.message}`)
}
