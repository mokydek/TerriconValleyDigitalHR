/**
 * Мессенджер в браузере: всё, что умеет чат как в Telegram, проходится руками пользователя.
 * Работник: упоминание, ответ, реакция, правка, альбом фото, PDF, голосовое, контакт, опрос, пересылка
 * в «Избранное», закреп, поиск, удаление, новая группа, добавление участника, выход; канал только для чтения.
 * Руководитель получает уведомление об упоминании, HR публикует в канале. Плюс телефон 390 px.
 *
 *   E2E_BASE_URL=http://localhost:8080 node tests/messenger.mjs
 *   STUB_EXTERNAL_IMAGES=1 — подменить фото Unsplash локальной картинкой (песочница без интернета)
 *
 * Тест пишет в базу: после прогона выполните supabase/seed.sql.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Нужен пакет playwright: npm i --no-save playwright && npx playwright install chromium')
  process.exit(2)
}

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const OUT = path.resolve('test-results/messenger')
mkdirSync(OUT, { recursive: true })
let failed = 0
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' · ' + extra : ''}`)
  if (!ok) failed++
}
const photo = (n) => ({ name: n, mimeType: 'image/jpeg', buffer: readFileSync(path.resolve('docs/screenshots', n)) })
// маленький настоящий PDF
const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 40 100 Td (Grafik smen) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
})

async function session(who, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ru-RU', permissions: ['microphone', 'clipboard-read', 'clipboard-write'] })
  if (process.env.STUB_EXTERNAL_IMAGES) await ctx.route(/images\.unsplash\.com|i\.ytimg\.com/, (r) => r.fulfill({ path: path.resolve('docs/screenshots/02-employee-home.jpg'), contentType: 'image/jpeg' }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => r.status() >= 400 && !/ai-jana|unsplash|ytimg|youtube/.test(r.url()) && errors.push(`HTTP ${r.status()} ${r.url()}`))
  await page.goto(BASE)
  await page.getByTestId(`demo-${who}`).click()
  await page.getByTestId('profile-menu').waitFor()
  await page.goto(BASE + '/messages')
  await page.getByTestId('chat-row').first().waitFor()
  return { ctx, page, errors }
}
const openChat = async (page, name) => {
  await page.getByTestId('chat-row').filter({ hasText: name }).first().click()
  await page.getByTestId('chat-messages').waitFor()
  await page.waitForTimeout(700)
}
const lastMine = (page) => page.getByTestId('chat-message-mine').last()
const menuOn = async (page, item) => {
  await item.hover()
  await item.getByTestId('chat-actions').click()
}
const send = async (page, text) => {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-input').press('Enter')
  await page.waitForTimeout(600)
}

try {
  // ---------- Работник ----------
  const { ctx, page, errors } = await session('employee')
  check((await page.getByTestId('chat-row').count()) >= 5, 'список чатов: личные, группа, канал, «Избранное»')
  await page.screenshot({ path: path.join(OUT, '01-list.png') })

  await openChat(page, 'Смена А')
  check((await page.getByTestId('chat-pinned-bar').count()) === 1, 'группа: закреплённое сообщение сверху')
  check((await page.getByTestId('chat-poll').count()) >= 1 && (await page.getByTestId('chat-media').count()) >= 2, 'в группе опрос и альбом фото')
  check((await page.getByTestId('chat-file').count()) >= 1 && (await page.getByTestId('reaction-chip').count()) >= 3, 'файл PDF и реакции на сообщениях')

  // упоминание: «@Ер» → подсказка → Enter вставляет имя
  await page.getByTestId('chat-input').fill('')
  await page.getByTestId('chat-input').pressSequentially('@Ер')
  await page.getByTestId('mention-list').waitFor()
  await page.getByTestId('chat-input').press('Enter')
  await page.getByTestId('chat-input').pressSequentially('посмотри фото зоны C, пожалуйста')
  check((await page.getByTestId('chat-input').inputValue()).startsWith('@Ерлан Сапаров '), 'упоминание подставляет имя участника')
  await page.getByTestId('chat-input').press('Enter')
  await page.waitForTimeout(800)
  check((await lastMine(page).innerText()).includes('посмотри фото зоны C'), 'сообщение с упоминанием отправлено')

  // ответ на сообщение
  const timur = page.getByTestId('chat-message').filter({ hasText: 'Подскажите, где взять листы' }).last()
  await timur.hover()
  await timur.getByTestId('chat-reply').click()
  await page.getByTestId('chat-reply-preview').waitFor()
  await send(page, 'Лежат на стойке, я подписала зону B.')
  check((await lastMine(page).innerText()).includes('Подскажите, где взять листы'), 'ответ показывает цитату')

  // реакция и правка своего сообщения
  await menuOn(page, lastMine(page))
  await page.getByTestId('react-heart').click()
  await page.waitForTimeout(600)
  check((await lastMine(page).getByTestId('reaction-chip').count()) === 1, 'реакция из меню сообщения')
  await menuOn(page, lastMine(page))
  await page.getByTestId('menu-edit').click()
  await page.getByTestId('chat-edit-preview').waitFor()
  await page.getByTestId('chat-input').fill('Лежат на стойке у старшего смены, я подписала зону B.')
  await page.getByTestId('chat-input').press('Enter')
  await page.waitForTimeout(700)
  check((await lastMine(page).innerText()).includes('изменено'), 'правка: метка «изменено»')

  // альбом из двух фото с подписью
  await page.getByTestId('chat-photo-input').setInputFiles([photo('02-employee-home.jpg'), photo('03-vacation-request.jpg')])
  await page.getByTestId('chat-pending').locator('img').nth(1).waitFor()
  await send(page, 'Как выглядит заявка на отпуск в JanaMen')
  await page.waitForTimeout(800)
  check((await lastMine(page).getByTestId('chat-media').count()) === 2, 'альбом из двух фото с подписью')
  await page.screenshot({ path: path.join(OUT, '02-group.png') })

  // PDF
  await page.getByTestId('chat-file-input').setInputFiles({ name: 'График смен.pdf', mimeType: 'application/pdf', buffer: pdf })
  await page.getByTestId('chat-pending').waitFor()
  await page.getByTestId('chat-send').click()
  await page.waitForTimeout(900)
  check((await lastMine(page).getByTestId('chat-file').innerText()).includes('График смен.pdf'), 'файл отправлен карточкой')

  // голосовое (фейковый микрофон Chromium)
  await page.getByTestId('voice-record').click()
  await page.getByTestId('voice-recording').waitFor()
  await page.waitForTimeout(1800)
  await page.getByTestId('voice-send').click()
  await page.waitForTimeout(1500)
  check((await lastMine(page).getByTestId('chat-voice').count()) === 1, 'голосовое с волной и плеером')

  // контакт коллеги
  await page.getByTestId('chat-attach').click()
  await page.getByTestId('attach-contact').click()
  await page.getByTestId('chat-person').filter({ hasText: 'Ким' }).first().click()
  await page.getByTestId('contact-send').click()
  await page.waitForTimeout(900)
  check((await lastMine(page).getByTestId('chat-contact').innerText()).includes('Ким'), 'карточка контакта коллеги')

  // опрос и голос
  await page.getByTestId('chat-attach').click()
  await page.getByTestId('attach-poll').click()
  await page.getByTestId('poll-question').fill('Кто сможет выйти в воскресенье на 4 часа?')
  await page.getByTestId('poll-option-input').nth(0).fill('Смогу с утра')
  await page.getByTestId('poll-option-input').nth(1).fill('Смогу после обеда')
  await page.getByTestId('poll-add-option').click()
  await page.getByTestId('poll-option-input').nth(2).fill('Не смогу')
  await page.getByTestId('poll-create').click()
  await page.waitForTimeout(1000)
  const myPoll = lastMine(page)
  await myPoll.getByTestId('poll-option').first().click()
  await page.waitForTimeout(1200)
  check((await myPoll.getByTestId('chat-poll').innerText()).includes('100%'), 'опрос создан, голос учтён')

  // пересылка в «Избранное»
  const album = page.getByTestId('chat-message-mine').filter({ hasText: 'Как выглядит заявка' }).last()
  await menuOn(page, album)
  await page.getByTestId('menu-forward').click()
  await page.getByTestId('forward-target').filter({ hasText: 'Избранное' }).click()
  await page.getByTestId('forward-send').click()
  await page.waitForTimeout(900)

  // закреп и поиск
  await menuOn(page, album)
  await page.getByTestId('menu-pin').click()
  await page.waitForTimeout(900)
  check((await page.getByTestId('chat-pinned-bar').innerText()).includes('Как выглядит заявка'), 'закреп нового сообщения')
  await page.getByTestId('chat-search-toggle').click()
  await page.getByTestId('chat-search').fill('стойке')
  await page.waitForTimeout(500)
  check((await page.locator('mark').count()) >= 1, 'поиск по чату подсвечивает совпадения')
  await page.getByTestId('chat-search-toggle').click()

  // удаление своего сообщения
  const before = await page.getByTestId('chat-message-mine').count()
  await menuOn(page, page.getByTestId('chat-message-mine').filter({ hasText: 'График смен.pdf' }).last())
  await page.getByTestId('menu-delete').click()
  await page.getByTestId('delete-confirm').click()
  await page.waitForTimeout(900)
  check((await page.getByTestId('chat-message-mine').count()) === before - 1, 'удаление своего сообщения')

  // информация о чате: роли и медиа
  await page.getByTestId('chat-info-toggle').click()
  await page.getByTestId('chat-info').waitFor()
  check((await page.getByTestId('chat-member').count()) === 5, 'участники группы с ролями')
  await page.getByTestId('info-tab-media').click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(OUT, '03-info.png') })
  await page.getByTestId('chat-info-toggle').click()

  // «Избранное»: пересланное сообщение
  await openChat(page, 'Избранное')
  check((await page.getByTestId('chat-forwarded').count()) >= 2, '«Избранное»: пересланные сообщения с подписью автора')

  // новая группа → добавить участника → выйти
  await page.getByTestId('chat-new').click()
  await page.getByTestId('new-group').click()
  await page.getByTestId('chat-group-title').fill('Пересчёт зоны B')
  await page.getByTestId('chat-person').filter({ hasText: 'Ахметов' }).first().click()
  await page.getByTestId('chat-person').filter({ hasText: 'Жаксылыков' }).first().click()
  await page.getByTestId('chat-start').click()
  await page.getByTestId('chat-system').first().waitFor()
  check((await page.getByTestId('chat-system').first().innerText()).includes('создал(а) группу'), 'новая группа: служебное событие')
  await page.getByTestId('chat-info-toggle').click()
  await page.getByTestId('chat-add-members').click()
  await page.getByTestId('chat-person').filter({ hasText: 'Кенжебаев' }).first().click()
  await page.getByTestId('add-members-confirm').click()
  await page.waitForTimeout(900)
  check((await page.getByTestId('chat-member').count()) === 4, 'добавление участника в группу')
  await page.getByTestId('chat-leave').click()
  await page.getByTestId('chat-leave-confirm').click()
  await page.waitForTimeout(900)
  check((await page.getByTestId('chat-row').filter({ hasText: 'Пересчёт зоны B' }).count()) === 0, 'выход из группы')

  // канал: писать нельзя, можно выключить звук
  await openChat(page, 'HR-новости')
  check((await page.getByTestId('channel-readonly').count()) === 1, 'канал: подписчик не пишет')
  await page.getByTestId('channel-readonly').getByRole('button').click()
  await page.waitForTimeout(700)
  check((await page.getByTestId('chat-row').filter({ hasText: 'HR-новости' }).getByLabel('Без звука').count()) === 1, 'канал без звука в списке')
  await page.screenshot({ path: path.join(OUT, '04-channel.png') })
  check(errors.length === 0, 'работник: без ошибок JS и запросов', errors.slice(0, 3).join(' | '))
  await ctx.close()

  // ---------- Руководитель: уведомление об упоминании ----------
  const m = await session('manager')
  await m.page.goto(BASE + '/notifications')
  await m.page.waitForTimeout(1200)
  check((await m.page.getByText('Вас упомянули в чате «Смена А · склад»').count()) >= 1, 'руководитель получил уведомление об упоминании')
  check(m.errors.length === 0, 'руководитель: без ошибок', m.errors.slice(0, 3).join(' | '))
  await m.ctx.close()

  // ---------- HR публикует в канале ----------
  const h = await session('hr')
  await openChat(h.page, 'HR-новости')
  await send(h.page, 'Тест канала: опрос о корпоративе открыт до пятницы.')
  check((await lastMine(h.page).innerText()).includes('Тест канала'), 'HR публикует в канале')
  check(h.errors.length === 0, 'HR: без ошибок', h.errors.slice(0, 3).join(' | '))
  await h.ctx.close()

  // ---------- Телефон ----------
  const p = await session('employee', { width: 390, height: 844 })
  await openChat(p.page, 'Смена А')
  check((await p.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, 'телефон: без горизонтальной прокрутки')
  await p.page.screenshot({ path: path.join(OUT, '05-phone.png') })
  await p.ctx.close()
} finally {
  await browser.close()
}
console.log(failed ? `\n${failed} проверок не прошли` : '\nМессенджер: все проверки прошли')
process.exit(failed ? 1 : 0)
