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
  employee: ['/', '/profile', '/requests', '/academy', '/knowledge', '/notifications', '/tasks', '/announcements', '/assistant'],
  manager: ['/', '/approvals', '/team', '/analytics', '/requests'],
  hr: ['/', '/approvals', '/employees', '/analytics', '/analytics?tab=learning', '/analytics?tab=logistics', '/tickets', '/integrations'],
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

async function runEngine(engine) {
  const browser = await pw[engine].launch(engine === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {})
  const iphone = pw.devices['iPhone 15 Pro'] ?? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true }
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
      let realtime = 'нет'
      page.on('pageerror', (e) => {
        problems.push(`JS: ${e.message}`)
        console.log(`[${engine}] pageerror: ${e.message}`)
      })
      page.on('console', (m) => {
        if (m.type() === 'error') console.log(`[${engine}] console.error: ${m.text().slice(0, 300)}`)
      })
      page.on('response', (r) => {
        if (r.status() < 400 || r.url().includes('/api/ai-jana') || r.url().endsWith('/favicon.ico')) return
        // хостинг без правил переписывания отдаёт маршрут SPA с кодом 404, но страница работает
        if (r.request().resourceType() === 'document' && r.url().startsWith(BASE)) deepLink404.push(new URL(r.url()).pathname)
        else problems.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`)
      })
      page.on('websocket', (ws) => {
        if (ws.url().includes('/realtime/')) {
          realtime = 'подключено'
          ws.on('socketerror', (e) => (realtime = `ошибка: ${e}`))
        }
      })
      await page.goto(BASE)
      try {
        await page.getByTestId(`demo-${role}`).click({ timeout: 20_000 })
        await page.waitForSelector('main', { timeout: 20_000 })
      } catch (error) {
        const html = (await page.content()).slice(0, 300).replace(/\s+/g, ' ')
        out(false, `[${engine}] ${role}: вход`, `${error.message.split('\n')[0]} · ${problems.slice(0, 3).join(' ; ')} · ${html}`)
        await ctx.close()
        continue
      }
      for (const route of routes) {
        await page.goto(BASE + route)
        await page.waitForTimeout(2500)
        const crashed = await page.getByText('Не удалось открыть раздел').count()
        const text = (await page.locator('main').innerText().catch(() => '')).slice(0, 80).replace(/\s+/g, ' ')
        out(!crashed && text.length > 0, `[${engine}] ${role} ${route}${mobile ? ' (телефон)' : ''}`, crashed ? 'экран ошибки' : text)
      }
      out(problems.length === 0, `[${engine}] ${role}: ошибки JS и запросов`, problems.slice(0, 5).join(' ; '))
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
