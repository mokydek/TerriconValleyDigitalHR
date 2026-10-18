/**
 * Вход по вкладкам: три вкладки одного браузера держат три разные роли и не мешают друг другу.
 * Проверяет: новая вкладка стартует с последнего входа; «Выйти» в вкладке, где аккаунт открыт ещё где-то,
 * отвязывает только её; роли переживают перезагрузку и переключение вкладок; полный выход не задевает соседей.
 *
 *   E2E_BASE_URL=http://localhost:8080 node tests/multi-tab.mjs
 */
let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Нужен пакет playwright: npm i --no-save playwright && npx playwright install chromium')
  process.exit(2)
}

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {})
let failed = 0
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failed++
}

/** Роль в шапке вкладки или 'login', если показан экран входа */
async function roleOf(page) {
  await page.bringToFront()
  const menu = page.getByTestId('profile-menu')
  const login = page.getByTestId('demo-employee')
  await Promise.race([menu.waitFor({ timeout: 15000 }), login.waitFor({ timeout: 15000 })]).catch(() => {})
  if (await menu.count()) return menu.getAttribute('data-role')
  return (await login.count()) ? 'login' : 'unknown'
}
async function open(ctx) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => check(false, 'pageerror: ' + e.message))
  await page.goto(BASE)
  return page
}
async function signIn(page, who) {
  await page.getByTestId(`demo-${who}`).click()
  await page.getByTestId('profile-menu').waitFor({ timeout: 15000 })
}
async function signOut(page) {
  await page.bringToFront()
  await page.getByTestId('profile-menu').click()
  await page.getByRole('menuitem', { name: 'Выйти' }).click()
  await page.getByTestId('demo-employee').waitFor({ timeout: 15000 })
}
async function reload(page) {
  await page.reload()
  return roleOf(page)
}

try {
  // Сценарий из жалобы: открыли три новые вкладки и в каждой зашли под своей ролью
  {
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' })
    const tabs = [await open(fresh), await open(fresh), await open(fresh)]
    const who = ['employee', 'manager', 'hr']
    for (let i = 0; i < 3; i++) await signIn(tabs[i], who[i])
    const now = []
    for (const p of tabs) now.push(await roleOf(p))
    check(now.join(',') === who.join(','), `три новые вкладки, вход в каждой: ${now.join(', ')}`)
    for (let i = 0; i < 3; i++) check((await reload(tabs[i])) === who[i], `после перезагрузки вкладка ${i + 1} осталась ${who[i]}`)
    await fresh.close()
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' })

  const a = await open(ctx)
  check((await roleOf(a)) === 'login', 'первая вкладка: экран входа')
  await signIn(a, 'employee')
  check((await roleOf(a)) === 'employee', 'вкладка A: работник')

  const b = await open(ctx)
  check((await roleOf(b)) === 'employee', 'новая вкладка B стартует с последнего входа (работник)')
  await signOut(b)
  check((await roleOf(a)) === 'employee', 'выход в B (аккаунт открыт в A) не выкинул A')
  await signIn(b, 'manager')
  check((await roleOf(b)) === 'manager', 'вкладка B: руководитель')
  check((await roleOf(a)) === 'employee', 'вход руководителя в B не переключил A')

  const c = await open(ctx)
  check((await roleOf(c)) === 'manager', 'новая вкладка C стартует с последнего входа (руководитель)')
  await signOut(c)
  await signIn(c, 'hr')
  check((await roleOf(c)) === 'hr', 'вкладка C: HR')

  const roles = async () => [await roleOf(a), await roleOf(b), await roleOf(c)].join(',')
  check((await roles()) === 'employee,manager,hr', 'три вкладки одновременно: работник, руководитель, HR')
  for (const [p, r] of [[a, 'employee'], [b, 'manager'], [c, 'hr']]) check((await reload(p)) === r, `перезагрузка сохраняет роль ${r}`)

  // права в каждой вкладке свои: раздел «Сотрудники» открыт только HR
  const denied = (p) => p.getByText('Раздел недоступен для вашей роли').count()
  await c.goto(BASE + '/employees')
  check((await roleOf(c)) === 'hr' && (await denied(c)) === 0, 'HR во вкладке C открывает «Сотрудники»')
  await a.goto(BASE + '/employees')
  check((await roleOf(a)) === 'employee' && (await denied(a)) > 0, 'работнику во вкладке A «Сотрудники» недоступны')
  await a.goto(BASE)

  // полный выход: HR открыт только в C, после выхода вход не возвращается; A и B живы
  await signOut(c)
  check((await reload(c)) === 'login', 'C после выхода и перезагрузки остаётся на экране входа')
  check((await reload(a)) === 'employee' && (await reload(b)) === 'manager', 'полный выход HR не задел A и B')

  const d = await open(ctx)
  check((await roleOf(d)) === 'manager', 'новая вкладка D стартует с последнего живого входа (руководитель)')
  await d.close()

  // выход руководителя в B, когда он открыт только там: сессия завершена, вкладка A жива
  await signOut(b)
  check((await reload(b)) === 'login' && (await reload(a)) === 'employee', 'выход руководителя в B не задел A')

  await ctx.close()
} finally {
  await browser.close()
}
console.log(failed ? `\n${failed} проверок не прошли` : '\nВсе проверки вкладок прошли')
process.exit(failed ? 1 : 0)
