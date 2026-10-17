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

  // профиль справа сверху: своё фото (рисуем нейтральную картинку, реальных фото в проекте нет)
  const avatarPng = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, 512, 512)
    grad.addColorStop(0, '#2fb52a')
    grad.addColorStop(1, '#0e6b0b')
    g.fillStyle = grad
    g.fillRect(0, 0, 512, 512)
    g.fillStyle = 'rgba(255,255,255,0.92)'
    g.beginPath()
    g.arc(256, 205, 95, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.ellipse(256, 480, 175, 160, 0, Math.PI, 0)
    g.fill()
    return c.toDataURL('image/png').split(',')[1]
  })
  await page.getByTestId('avatar-input').first().setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(avatarPng, 'base64') })
  await page.waitForTimeout(1500)
  await page.getByTestId('profile-menu').click()
  await page.waitForTimeout(400)
  await shot('28-profile-menu')
  await page.keyboard.press('Escape')
  log('photo ok')

  // языки: глобус в шапке, все семь языков по очереди, затем снова русский
  const LANGS = ['en', 'kk', 'ky', 'uz', 'tg', 'mn', 'ru']
  await page.goto(BASE)
  await page.waitForSelector('[data-testid="vacation-available"]')
  for (const lang of LANGS) {
    await page.getByTestId('lang-menu').click()
    if (lang === 'en') await shot('32-language-menu')
    await page.getByTestId(`lang-${lang}`).click()
    await page.waitForFunction((l) => document.documentElement.lang === l, lang, { timeout: 8000 }).catch(() => errors.push(`язык ${lang} не включился`))
    await page.waitForSelector('[data-testid="vacation-available"]')
    await page.waitForTimeout(700)
    if (lang !== 'ru') await shot(`33-home-${lang}`)
  }
  const navProfile = await page.locator('aside nav a[href="/profile"]').count()
  if (navProfile) errors.push('в левом меню осталась ссылка «Мой профиль»')
  log('languages ok')

  // сообщения: работник пишет руководителю
  await page.getByTestId('chat-button').click()
  await page.waitForSelector('[data-testid="chat-row"]')
  await page.getByTestId('chat-row').filter({ hasText: 'Ерлан Сапаров' }).first().click()
  await page.getByTestId('chat-input').fill('Ерлан, подала заявку на отпуск, посмотрите, пожалуйста.')
  await page.getByTestId('chat-input').press('Enter')
  await page.waitForTimeout(1200)
  await shot('29-messages')
  log('chat sent')

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
  // руководитель видит новое сообщение и отвечает на него
  log('manager chat badge:', (await page.getByTestId('chat-button').innerText()).trim() || '0')
  await page.getByTestId('chat-button').click()
  await page.waitForSelector('[data-testid="chat-row"]')
  await page.getByTestId('chat-row').filter({ hasText: 'Дана Жумабекова' }).first().click()
  const last = page.getByTestId('chat-bubble').filter({ hasText: 'подала заявку на отпуск' }).last()
  await last.hover()
  await page.locator('li', { has: last }).getByTestId('chat-reply').click()
  await page.getByTestId('chat-input').fill('Вижу, согласовал. Хорошего отдыха!')
  await page.getByTestId('chat-send').click()
  await page.waitForTimeout(1200)
  await shot('30-manager-chat')
  log('manager replied')

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
  await m.goto(BASE + '/messages')
  await m.waitForSelector('[data-testid="chat-row"]')
  await m.getByTestId('chat-row').filter({ hasText: 'Ерлан Сапаров' }).first().click()
  await m.waitForTimeout(1500)
  await m.screenshot({ path: path.join(OUT, '31-mobile-chat.png') })
  await m.goto(BASE)
  await m.waitForSelector('[data-testid="vacation-available"]')
  await m.getByTestId('lang-menu').click()
  await m.getByTestId('lang-en').click()
  await m.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 8000 }).catch(() => errors.push('мобильная версия: английский не включился'))
  await m.waitForTimeout(1200)
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 1) errors.push(`мобильная версия на английском шире экрана на ${overflow}px`)
  await m.screenshot({ path: path.join(OUT, '34-mobile-english.png') })

  log('errors:', errors.length)
  for (const er of errors.slice(0, 30)) console.log('  ', er.slice(0, 400))
  if (errors.length) process.exitCode = 1
  else log('E2E OK — скриншоты в', OUT)
} finally {
  await browser.close()
}
