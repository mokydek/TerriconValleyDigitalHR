/**
 * Браузерная проверка развёрнутого стенда «только просмотр»: входит под каждой ролью кнопками
 * демо-входа и открывает основные разделы, ничего не создавая и не меняя. Ловит ошибки JS,
 * экран ErrorBoundary, неудачные запросы и проверяет подключение Realtime.
 *
 *   E2E_BASE_URL=https://janamen.onrender.com node tests/browser-smoke.mjs [--serve]
 */
import http from 'node:http'

let pw
try {
  pw = await import('playwright')
} catch {
  console.error('Нужен пакет playwright')
  process.exit(2)
}

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const ROUTES = {
  employee: ['/', '/?tab=learning', '/profile', '/requests', '/academy', '/knowledge', '/notifications', '/tasks', '/announcements', '/assistant', '/messages'],
  manager: ['/', '/?tab=overview', '/approvals', '/team', '/analytics', '/requests', '/messages'],
  hr: ['/', '/?tab=charts', '/approvals', '/employees', '/analytics', '/analytics?tab=learning', '/analytics?tab=logistics', '/tickets', '/integrations', '/messages'],
}
const lines = []
let failed = 0
const out = (ok, name, detail = '') => {
  if (!ok) failed++
  const line = `${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`
  lines.push(line)
  console.log(line)
}

// BROWSERS=chromium,webkit — WebKit = движок Safari; в нём работник проверяется на профиле iPhone
const BROWSERS = (process.env.BROWSERS ?? 'chromium').split(',').map((b) => b.trim()).filter(Boolean)

async function run() {
  for (const engine of BROWSERS) await runEngine(engine)
  const summary = failed === 0 ? 'ИТОГ: в браузере всё работает' : `ИТОГ: ошибок — ${failed}`
  lines.push(summary)
  console.log(summary)
}

/**
 * Шире ли страница экрана телефона: iPhone в этом случае уменьшает её целиком и справа остаётся пустое место.
 * Проверяет и ширину документа, и элементы, вылезающие за правый край (кроме прокручиваемых областей).
 */
function widerThanScreen() {
  const vw = window.innerWidth
  const sw = document.documentElement.scrollWidth
  let worst = null
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.right <= vw + 1) continue
    let p = el.parentElement
    let scrolls = false
    while (p && p.tagName !== 'MAIN') {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) {
        scrolls = true
        break
      }
      p = p.parentElement
    }
    if (!scrolls && (!worst || r.right > worst.right)) worst = { right: Math.round(r.right), el: el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 60) }
  }
  if (sw <= vw + 1 && !worst) return null
  return `документ ${sw} px при экране ${vw} px${worst ? ` · за краем: ${worst.el} (до ${worst.right} px)` : ''}`
}

/** Текст заглушки загрузки из index.html, если приложение ещё не запустилось */
const bootText = (page) => page.evaluate(() => document.getElementById('boot')?.innerText.replace(/\s+/g, ' ').trim() ?? '')

async function runEngine(engine) {
  const browser = await pw[engine].launch(engine === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {})
  // профиль iPhone с масштабом 1: на слабой машине программная отрисовка в 3x искажает время, а не поведение
  const iphone = { ...(pw.devices['iPhone 15 Pro'] ?? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true }), deviceScaleFactor: 1 }
  try {
    for (const [role, routes] of Object.entries(ROUTES)) {
      const mobile = role === 'employee'
      const ctx = await browser.newContext(
        mobile
          ? engine === 'webkit'
            ? { ...iphone, locale: 'ru-RU' }
            : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' }
          : { viewport: { width: 1440, height: 900 }, locale: 'ru-RU' },
      )
      const page = await ctx.newPage()
      const problems = []
      const deepLink404 = []
      let aborted = 0
      let navigatedAt = 0
      let realtime = 'нет'
      const watch = (tab) => {
        tab.on('pageerror', (e) => {
          // WebKit сообщает о запросах, прерванных переходом на другую страницу, как об ошибке доступа
          if (/access control checks/.test(e.message) && Date.now() - navigatedAt < 5000) return void aborted++
          problems.push(`JS: ${e.message}`)
          console.log(`[${engine}] pageerror: ${e.message}`)
        })
        tab.on('console', (m) => {
          if (m.type() === 'error') console.log(`[${engine}] console.error: ${m.text().slice(0, 300)}`)
        })
        tab.on('response', (r) => {
          if (r.status() < 400 || r.url().includes('/api/ai-jana') || r.url().endsWith('/favicon.ico')) return
          // хостинг без правил переписывания отдаёт маршрут SPA с кодом 404, но страница работает
          if (r.request().resourceType() === 'document' && r.url().startsWith(BASE)) deepLink404.push(new URL(r.url()).pathname)
          else problems.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`)
        })
        tab.on('websocket', (ws) => {
          if (ws.url().includes('/realtime/')) {
            realtime = 'подключено'
            ws.on('socketerror', (e) => (realtime = `ошибка: ${e}`))
          }
        })
      }
      watch(page)
      const started = Date.now()
      await page.goto(BASE)
      try {
        // приложение запустилось, когда React заменил заглушку #boot страницей входа
        await page.getByTestId(`demo-${role}`).waitFor({ timeout: 60_000 })
        lines.push(`INFO | [${engine}] ${role}: страница входа через ${((Date.now() - started) / 1000).toFixed(1)} с`)
        await page.getByTestId(`demo-${role}`).click({ timeout: 30_000 })
        await page.waitForSelector('main', { timeout: 30_000 })
      } catch (error) {
        const boot = await bootText(page).catch(() => '')
        const body = (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 200).replace(/\s+/g, ' ')
        out(false, `[${engine}] ${role}: вход`, `${error.message.split('\n')[0]} · заглушка: «${boot}» · экран: «${body}» · ${problems.slice(0, 3).join(' ; ')}`)
        await ctx.close()
        continue
      }
      // каждый раздел открывается в новой вкладке, прежняя закрывается: WebKit держит пройденные страницы
      // в памяти (кэш «назад»), и на машине с 512 МБ к концу длинного прогона разделы перестают отрисовываться
      await page.close()
      for (const route of routes) {
        const page = await ctx.newPage()
        watch(page)
        navigatedAt = Date.now()
        await page.goto(BASE + route)
        // ждём, пока раздел покажет содержимое (на слабой машине WebKit заметно медленнее Chromium)
        await page
          .waitForFunction(() => (document.querySelector('main')?.textContent ?? '').trim().length > 0, null, { timeout: 20_000 })
          .catch(() => {})
        await page.waitForTimeout(1000)
        const crashed = await page.getByText(/Не удалось открыть раздел|Произошла ошибка|Не удалось запустить/).count()
        const text = (await page.locator('main').innerText().catch(() => '')).slice(0, 80).replace(/\s+/g, ' ')
        out(!crashed && text.length > 0, `[${engine}] ${role} ${route}${mobile ? ' (телефон)' : ''}`, crashed ? 'экран ошибки' : text || `пусто · заглушка: «${await bootText(page).catch(() => '')}»`)
        if (mobile) {
          const wide = await page.evaluate(widerThanScreen)
          if (wide) out(false, `[${engine}] ${role} ${route}: шире экрана`, wide)
        }
        await page.close()
      }
      out(problems.length === 0, `[${engine}] ${role}: ошибки JS и запросов`, problems.slice(0, 5).join(' ; '))
      if (aborted) lines.push(`NOTE | [${engine}] ${role}: запросов, прерванных переходом между страницами, — ${aborted}`)
      if (deepLink404.length) lines.push(`NOTE | ${role}: прямые ссылки отдаются с кодом 404 (страница при этом работает): ${[...new Set(deepLink404)].join(', ')}`)
      out(realtime === 'подключено', `[${engine}] ${role}: Realtime`, realtime)
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
}

try {
  await run()
} catch (error) {
  out(false, 'прогон', error.message)
}

if (process.argv.includes('--serve')) {
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(lines.join('\n') + '\n')
    })
    .listen(Number(process.env.PORT ?? 10000))
} else if (failed) {
  process.exitCode = 1
}
