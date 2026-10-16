/**
 * Сквозной прогон JanaMen в браузере по сценариям кейса: работник → руководитель → HR,
 * плюс мобильная версия. Делает скриншоты каждого шага в test-results/screenshots.
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   E2E_BASE_URL=http://localhost:5173 npm run test:e2e
 *
 * Перед прогоном сбросьте демо-данные (supabase/seed.sql): сценарий создаёт заявки.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Нужен пакет playwright: npm i --no-save playwright && npx playwright install chromium')
  process.exit(2)
}

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const OUT = path.resolve('test-results/screenshots')
mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {})
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  page.on('response', (r) => {
    // /api/ai-jana без ключа отвечает 503 (или 404 в vite dev) — клиент штатно переходит в режим базы знаний
    if (r.status() >= 400 && !r.url().includes('/api/ai-jana')) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`)
  })
  const shot = async (name) => {
    // экран ErrorBoundary = упавший раздел, даже если ошибка перехвачена
    if (await page.getByText('Не удалось открыть раздел').count()) errors.push(`ErrorBoundary на шаге ${name}: ${await page.locator('main').innerText()}`)
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false })
  }

  async function loginAs(id) {
    await page.goto(BASE)
    await page.getByTestId(`demo-${id}`).click()
    await page.waitForSelector('main', { timeout: 15000 })
    await page.waitForTimeout(1500)
  }
  async function logout() {
    await page.evaluate(() => localStorage.removeItem('janamen-auth'))
    await page.goto(BASE)
  }

  // 1. Логин
  await page.goto(BASE)
  await page.waitForSelector('[data-testid="demo-employee"]')
  await shot('01-login')
  log('login page ok')

  // 2. Работник: главная
  await loginAs('employee')
  await page.waitForSelector('[data-testid="vacation-available"]')
  await page.waitForTimeout(800)
  await shot('02-employee-home')
  log('employee home ok')

  // 3. Заявка на отпуск
  await page.getByTestId('quick-vacation').click()
  await page.waitForSelector('[data-testid="vac-start"]')
  const s = new Date(Date.now() + 30 * 86400000), e = new Date(Date.now() + 39 * 86400000)
  const iso = (d) => d.toISOString().slice(0, 10)
  await page.getByTestId('vac-start').fill(iso(s))
  await page.getByTestId('vac-end').fill(iso(e))
  await page.waitForTimeout(300)
  await shot('03-new-vacation')
  await page.getByTestId('request-submit').click()
  await page.waitForTimeout(1500)
  await shot('04-request-created')
  log('vacation created')
  // закрыть drawer
  await page.keyboard.press('Escape')

  // 3b. Аванс
  await page.goto(BASE + '/requests?new=advance')
  await page.waitForSelector('[data-testid="advance-amount"]')
  await page.getByTestId('advance-amount').fill('100000')
  await page.getByTestId('request-submit').click()
  await page.waitForTimeout(1500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await shot('05-my-requests')
  log('advance created')

  // 4. Jana Academy: курс по ИБ
  await page.goto(BASE + '/academy/infosec')
  await page.waitForSelector('[data-testid="lesson-view"]')
  await shot('06-course-lesson')
  for (let i = 0; i < 4; i++) {
    await page.getByTestId('lesson-next').click()
    await page.waitForTimeout(700)
  }
  await page.waitForSelector('[data-testid="quiz-view"]')
  const groups = await page.locator('[data-testid="quiz-view"] li').count()
  for (let i = 0; i < groups; i++) {
    await page.locator('[data-testid="quiz-view"] li').nth(i).locator('label').first().click()
  }
  await shot('07-quiz')
  await page.getByTestId('quiz-submit').click()
  await page.waitForSelector('[data-testid="quiz-score"]')
  await page.waitForTimeout(500)
  await shot('08-quiz-result')
  log('quiz done:', await page.getByTestId('quiz-score').innerText())

  // 5. AI Jana
  await page.goto(BASE + '/assistant')
  const ask = async (q) => {
    await page.getByLabel('Вопрос для AI Jana').fill(q)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2500)
  }
  await ask('Сколько у меня дней отпуска?')
  await ask('Как оформить аванс?')
  await ask('Когда корпоратив?')
  await ask('Какая зарплата у моего руководителя?')
  await shot('09-ai-jana')
  const esc = page.getByRole('button', { name: 'Задать вопрос HR' }).first()
  if (await esc.isVisible()) { await esc.click(); await page.waitForTimeout(1200) }
  await shot('10-ai-escalated')
  log('ai ok')

  // уведомления
  await page.getByTestId('notifications-bell').click()
  await page.waitForTimeout(500)
  await shot('11-notifications')
  await page.keyboard.press('Escape')

  // 6. Руководитель
  await logout()
  await loginAs('manager')
  await page.waitForTimeout(1500)
  await shot('12-manager-home')
  const approveBtns = page.locator('[data-testid^="approve-"]')
  const n = await approveBtns.count()
  log('manager pending approvals:', n)
  if (n > 0) { await approveBtns.first().click(); await page.waitForTimeout(1500) }
  await page.goto(BASE + '/approvals')
  await page.waitForTimeout(1200)
  await shot('13-manager-approvals')
  await page.goto(BASE + '/team')
  await page.waitForTimeout(1500)
  await shot('14-manager-team')
  await page.goto(BASE + '/analytics')
  await page.waitForTimeout(2000)
  await shot('15-manager-analytics')

  // 7. HR
  await logout()
  await loginAs('hr')
  await page.waitForTimeout(3000)
  await shot('16-hr-pulse') // KPI и вкладка «Зона внимания»
  await page.getByRole('tab', { name: /Графики/ }).click()
  await page.waitForTimeout(2000)
  await shot('17-hr-pulse-charts')
  await page.getByRole('tab', { name: /Слежу/ }).click()
  await page.waitForTimeout(800)
  await shot('18-hr-watchlist')
  await page.goto(BASE + '/approvals')
  await page.waitForTimeout(2000)
  await shot('19-hr-kanban')
  const proc = page.locator('[data-testid^="process-"]')
  log('hr kanban process buttons:', await proc.count())
  if (await proc.count()) { await proc.first().click(); await page.waitForTimeout(4500) }
  await shot('20-hr-kanban-after')
  await page.goto(BASE + '/employees')
  await page.waitForTimeout(2000)
  await shot('21-hr-employees')
  for (const tab of ['vacations', 'learning', 'requests', 'ai', 'logistics']) {
    await page.goto(BASE + '/analytics?tab=' + tab)
    await page.waitForTimeout(2200)
    await shot('22-analytics-' + tab)
  }
  await page.goto(BASE + '/tickets')
  await page.waitForTimeout(1500)
  await shot('23-hr-tickets')
  await page.goto(BASE + '/integrations')
  await page.waitForTimeout(1500)
  await shot('24-hr-integrations')
  await page.goto(BASE + '/assistant')
  await page.getByLabel('Вопрос для AI Jana').fill('Кто в отпуске на следующей неделе?')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  await page.getByLabel('Вопрос для AI Jana').fill('Какой отдел хуже проходит охрану труда?')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  await shot('25-hr-ai')

  // 8. Мобильная версия
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const m = await mctx.newPage()
  m.on('pageerror', (e) => errors.push('M PAGEERROR ' + e.message))
  await m.goto(BASE)
  await m.getByTestId('demo-employee').click()
  await m.waitForSelector('[data-testid="vacation-available"]')
  await m.waitForTimeout(1500)
  await m.screenshot({ path: path.join(OUT, '26-mobile-home.png') })
  await m.goto(BASE + '/requests')
  await m.waitForTimeout(1500)
  await m.screenshot({ path: path.join(OUT, '27-mobile-requests.png') })

  log('errors:', errors.length)
  for (const er of errors.slice(0, 30)) console.log('  ', er.slice(0, 400))
  if (errors.length) process.exitCode = 1
  else log('E2E OK — скриншоты в', OUT)
} finally {
  await browser.close()
}
