/**
 * Смоук-тест бэкенда JanaMen: роли, RLS, сквозной сценарий заявки, обучение,
 * база знаний, аналитика, интеграции. Работает через публичный API Supabase
 * от имени тестовых пользователей — ровно с теми правами, что и браузер.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> npm run test:api
 *
 * ВНИМАНИЕ: тест создаёт заявки, обращения и задачи. После прогона верните
 * стенд в исходное состояние — выполните supabase/seed.sql.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('Задайте SUPABASE_URL и SUPABASE_ANON_KEY (или VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
  process.exit(2)
}
const client = () => createClient(URL, KEY, { auth: { persistSession: false } })
const results = []
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); }

async function login(email) {
  const c = client()
  const { data, error } = await c.auth.signInWithPassword({ email, password: 'Jana2026!' })
  if (error) throw new Error(email + ': ' + error.message)
  return c
}

const emp = await login('employee@jana.test')
const mgr = await login('manager@jana.test')
const hr = await login('hr@jana.test')

// --- профиль
const { data: me } = await emp.from('employees').select('id, first_name, role, manager:manager(first_name)').eq('user_id', (await emp.auth.getUser()).data.user.id).single()
ok('employee profile loads', me?.first_name === 'Дана', JSON.stringify(me))
const { data: bal } = await emp.rpc('vacation_balance', { p_employee: me.id })
ok('vacation balance', bal?.[0]?.available > 0, JSON.stringify(bal?.[0]))

// --- RLS: сотрудник не видит чужие заявки / приватные данные
const { data: allReq } = await emp.from('requests').select('id, employee_id')
ok('employee sees only own requests', allReq.every(r => r.employee_id === me.id), `count=${allReq.length}`)
const { data: privAll } = await emp.from('employee_private').select('employee_id, salary')
ok('employee sees only own private row', privAll.length === 1 && privAll[0].employee_id === me.id, `count=${privAll.length}`)
await emp.from('employees').update({ position: 'CEO' }).eq('id', me.id)
const { data: posCheck } = await emp.from('employees').select('position').eq('id', me.id).single()
ok('employee cannot change official HR data', posCheck.position === 'Старший оператор сортировки', posCheck.position)
const { error: anaErr } = await emp.rpc('hr_dashboard')
ok('employee cannot read analytics', !!anaErr, anaErr?.message)
const { data: answerKeys, error: akErr } = await emp.from('course_answer_keys').select('*')
ok('answer keys hidden', (answerKeys ?? []).length === 0, akErr?.message ?? 'empty')
const { data: otherBal, error: otherBalErr } = await emp.rpc('vacation_balance', { p_employee: (await hr.from('employees').select('id').eq('zup_id','JP-0017').single()).data.id })
ok('employee cannot read other balance', !!otherBalErr, otherBalErr?.message)

// --- создание заявки на отпуск
const start = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10)
const end = new Date(Date.now() + 49 * 86400000).toISOString().slice(0, 10)
const { data: vac, error: vacErr } = await emp.from('requests').insert({ employee_id: me.id, type: 'vacation', start_date: start, end_date: end, comment: 'тест' }).select('*').single()
ok('create vacation', !vacErr && vac.status === 'pending' && vac.days === 10, vacErr?.message ?? `days=${vac?.days} approver=${vac?.approver_id}`)
// превышение баланса
const { error: bigErr } = await emp.from('requests').insert({ employee_id: me.id, type: 'vacation', start_date: '2027-02-01', end_date: '2027-03-31' }).select().single()
ok('vacation over balance rejected', !!bigErr, bigErr?.message)
// аванс сверх лимита
const { error: advErr } = await emp.from('requests').insert({ employee_id: me.id, type: 'advance', amount: 999999 }).select().single()
ok('advance over 50% rejected', !!advErr, advErr?.message)
const { data: adv, error: advErr2 } = await emp.from('requests').insert({ employee_id: me.id, type: 'advance', amount: 100000 }).select().single()
ok('advance created', !advErr2 && adv?.status === 'pending', advErr2?.message)
const { error: adv2Err } = await emp.from('requests').insert({ employee_id: me.id, type: 'advance', amount: 1000 }).select().single()
ok('second advance in month rejected', !!adv2Err, adv2Err?.message)

// --- руководитель согласует
const { data: mgrView } = await mgr.from('requests').select('id, employee_id').eq('id', vac.id)
ok('manager sees team request', mgrView.length === 1)
const { data: foreign } = await mgr.from('requests').select('id, employee:employees!requests_employee_fk(department_id)')
const mgrDept = (await mgr.from('employees').select('department_id').eq('id', (await hr.from('employees').select('id').eq('zup_id','JP-0012').single()).data.id).single()).data.department_id
ok('manager sees only own team requests', foreign.every(r => r.employee.department_id === mgrDept), `count=${foreign.length}`)
const { data: mgrPriv } = await mgr.from('employee_private').select('employee_id, salary')
ok('manager cannot see salaries of team', mgrPriv.length === 1, `rows=${mgrPriv.length}`)
const { error: apprErr } = await mgr.rpc('decide_request', { p_request_id: vac.id, p_action: 'approve', p_comment: 'ок' })
ok('manager approves', !apprErr, apprErr?.message)
const { error: procErrMgr } = await mgr.rpc('decide_request', { p_request_id: vac.id, p_action: 'process' })
ok('manager cannot process (HR only)', !!procErrMgr, procErrMgr?.message)

// --- HR оформляет → 1С
const { error: procErr } = await hr.rpc('decide_request', { p_request_id: vac.id, p_action: 'process' })
ok('hr processes', !procErr, procErr?.message)
const { data: st1 } = await hr.from('requests').select('status').eq('id', vac.id).single()
ok('status processing', st1.status === 'processing', st1.status)
const { data: workerN, error: wErr } = await hr.rpc('run_integration_worker')
ok('worker runs', !wErr, wErr?.message ?? `n=${workerN}`)
const { data: st2 } = await emp.from('requests').select('status, integration').eq('id', vac.id).single()
ok('status done with docs', st2.status === 'done' && st2.integration?.zup?.document, JSON.stringify(st2.integration))
const { data: ev } = await emp.from('request_events').select('action').eq('request_id', vac.id).order('created_at')
ok('history events', ev.map(e => e.action).join(',') === 'created,approved,processed,integration,integration,completed', ev.map(e => e.action).join(','))
const { data: notes } = await emp.from('notifications').select('title').order('created_at', { ascending: false }).limit(5)
ok('employee notified', notes.some(n => n.title.includes('оформлена')), notes.map(n=>n.title).join(' | '))

// --- обучение: статьи, видео, микротесты «Проверь себя» и итоговый тест
const { data: course } = await emp.from('courses').select('id, slug').eq('slug', 'infosec').single()
const { data: lessons } = await emp.from('course_lessons').select('id, kind').eq('course_id', course.id).order('sort')
ok('course has video and practice', lessons.some(l => l.kind === 'video') && lessons.some(l => l.kind === 'practice'), lessons.map(l => l.kind).join(','))
const { data: leakedKeys } = await emp.from('lesson_check_keys').select('*').limit(1)
ok('practice answer keys hidden', !leakedKeys?.length, `rows=${leakedKeys?.length}`)
let a
let practiceGuard = false
for (const l of lessons) {
  if (l.kind === 'practice') {
    const early = await emp.rpc('complete_lesson', { p_lesson: l.id })
    if (early.error && /проверки/.test(early.error.message)) practiceGuard = true
    const { data: checks } = await emp.from('lesson_checks').select('id').eq('lesson_id', l.id).order('sort')
    for (const c of checks) {
      let res
      let i = 0
      do { res = (await emp.rpc('answer_lesson_check', { p_check: c.id, p_index: i++ })).data } while (!res?.correct && i < 4)
      if (!res?.correct) ok('practice answer', false, JSON.stringify(res))
    }
  }
  const r = await emp.rpc('complete_lesson', { p_lesson: l.id })
  a = r.data
  if (r.error) ok('lesson', false, r.error.message)
}
ok('practice lesson needs correct answers', practiceGuard)
const expected = Math.round((100 * lessons.length) / (lessons.length + 1))
ok('lessons progress', a?.progress === expected, `progress=${a?.progress}, expected=${expected}`)
const { data: qs } = await emp.from('course_questions').select('id').eq('course_id', course.id).order('sort')
// Ключи итогового теста клиенту недоступны: пробуем варианты по порядку, сервер говорит только «верно / неверно»
const answers = Object.fromEntries(qs.map(q => [q.id, 0]))
const { data: r1 } = await emp.rpc('submit_quiz', { p_course: course.id, p_answers: answers })
ok('quiz fail', r1?.passed === false, JSON.stringify({ s: r1?.score }))
let r2 = r1
for (let attempt = 0; attempt < 4 && !(r2?.passed && r2.score === 100); attempt++) {
  for (const x of r2?.results ?? []) if (!x.correct) answers[x.question_id] += 1
  r2 = (await emp.rpc('submit_quiz', { p_course: course.id, p_answers: answers })).data
}
ok('quiz pass', r2?.passed === true && r2.score === 100, JSON.stringify({ s: r2?.score, attempts: r2?.attempts }))

// --- база знаний
const { data: kb } = await emp.rpc('kb_search', { p_query: 'Сколько дней отпуска положено?' })
ok('kb search vacation', kb?.[0]?.slug === 'vacation-annual', JSON.stringify(kb?.slice(0,2).map(k => [k.slug, k.heading, k.matched, k.total_terms])))
const { data: kb2 } = await emp.rpc('kb_search', { p_query: 'Как оформить аванс?' })
ok('kb search advance', kb2?.[0]?.slug === 'advance', JSON.stringify(kb2?.slice(0,2).map(k => [k.slug, k.heading, k.matched, k.total_terms])))
const { data: kb3 } = await emp.rpc('kb_search', { p_query: 'Когда корпоратив?' })
ok('kb search no answer', (kb3 ?? []).length === 0 || kb3[0].matched / kb3[0].total_terms < 0.5, JSON.stringify(kb3?.slice(0,2).map(k => [k.slug, k.heading, k.matched, k.total_terms])))
const { data: kbHrOnly } = await emp.from('kb_articles').select('slug').eq('visibility', 'hr')
ok('hr-only articles hidden from employee', kbHrOnly.length === 0)
const { data: ctx, error: ctxErr } = await emp.rpc('assistant_context')
ok('assistant context', !ctxErr && ctx.profile.full_name.includes('Жумабекова'), ctxErr?.message)

// --- HR аналитика
for (const fn of ['hr_dashboard', 'hr_charts', 'people_overview', 'attention_zone', 'vacation_heatmap', 'learning_funnel', 'learning_forecast', 'request_stage_times', 'ai_insights', 'zup_pending_changes']) {
  const { data, error } = await hr.rpc(fn)
  ok(`hr rpc ${fn}`, !error, error?.message ?? (Array.isArray(data) ? `rows=${data.length}` : Object.keys(data ?? {}).slice(0,6).join(',')))
}
const { data: logi, error: logiErr } = await hr.rpc('logistics_overview', { p_days: 30, p_horizon: 45 })
ok('logistics', !logiErr && logi.forecast.length === 45, logiErr?.message ?? JSON.stringify(logi.summary))
const { data: az } = await hr.rpc('attention_zone')
ok('attention zone kinds', ['vacation','course','request','onboarding'].every(k => az.some(i => i.kind === k)), az.map(i => i.kind + ':' + i.full_name).join('; '))
const { data: q1, error: q1e } = await hr.rpc('analytics_query', { p_kind: 'vacation_over', p_params: { threshold: 30 } })
ok('analytics vacation_over', !q1e && q1.rows.length >= 2, q1e?.message ?? JSON.stringify(q1.rows))
const { data: q2, error: q2e } = await hr.rpc('analytics_query', { p_kind: 'course_by_department', p_params: { course: 'safety' } })
ok('analytics course_by_department', !q2e && q2.rows.length > 0, q2e?.message ?? JSON.stringify(q2.rows[0]))
const { data: mgrPeople } = await mgr.rpc('people_overview')
ok('manager people only team', mgrPeople.length === 6, `rows=${mgrPeople.length}`)
// sync
const { data: sync, error: syncErr } = await hr.rpc('sync_from_zup')
ok('zup sync', !syncErr && sync.inserted === 1 && sync.updated === 1, syncErr?.message ?? JSON.stringify(sync))
const { error: syncEmpErr } = await emp.rpc('sync_from_zup')
ok('employee cannot sync', !!syncEmpErr, syncEmpErr?.message)
// attention action
const sau = az.find(i => i.kind === 'onboarding')
const { data: act, error: actErr } = await hr.rpc('attention_action', { p_action: sau.action, p_employee: sau.employee_id, p_ref: sau.ref_id })
ok('attention action assign course', !actErr, actErr?.message ?? act)
// follow
const mirasId = (await hr.from('employees').select('id').eq('zup_id','JP-0013').single()).data.id
const hrMe = (await hr.from('employees').select('id').eq('zup_id','JP-0002').single()).data.id
const { error: fErr } = await hr.from('watchlist').insert({ employee_id: me.id, added_by: hrMe })
ok('hr follows employee', !fErr, fErr?.message)
// ticket
const { data: tk, error: tkErr } = await emp.from('hr_tickets').insert({ employee_id: me.id, question: 'Положена ли компенсация за проезд на ночную смену?' }).select().single()
ok('ticket created', !tkErr, tkErr?.message)
const { error: ansErr } = await hr.rpc('answer_ticket', { p_ticket: tk.id, p_answer: 'Да, для ночной смены компенсируется такси до 3000 ₸ по чеку.', p_add_to_kb: true, p_kb_title: 'Компенсация проезда на ночную смену' })
ok('ticket answered + KB', !ansErr, ansErr?.message)
const { data: kb4 } = await emp.rpc('kb_search', { p_query: 'Положена ли компенсация за проезд на ночную смену?' })
ok('kb learned new answer', kb4?.[0]?.slug === 'faq-' + tk.number, JSON.stringify(kb4?.slice(0,2).map(k => [k.slug, k.matched, k.total_terms])))
// tasks
const { data: nTasks, error: tErr } = await mgr.rpc('assign_tasks', { p_title: 'Тест задачи', p_description: '', p_priority: 'high', p_category: 'warehouse', p_due: start, p_assignees: [me.id] })
ok('manager assigns task', !tErr && nTasks === 1, tErr?.message)
const { data: myTasks } = await emp.from('tasks').select('id,title,status').eq('title', 'Тест задачи')
const { error: tUpdErr } = await emp.from('tasks').update({ title: 'hack' }).eq('id', myTasks[0].id)
ok('assignee cannot rename task', !!tUpdErr, tUpdErr?.message)
const { error: tUpd2 } = await emp.from('tasks').update({ status: 'done' }).eq('id', myTasks[0].id)
ok('assignee completes task', !tUpd2, tUpd2?.message)

// --- задачи v2: отчёт с результатом и проверкой, чек-лист, задача «пройти курс», дедлайн со временем
const dueAt = new Date(Date.now() + 2 * 86400000).toISOString()
const { error: rtErr } = await mgr.rpc('assign_tasks', { p_title: 'Тест: отчёт по смене', p_description: 'Приложите фото', p_priority: 'urgent', p_category: 'warehouse', p_due: null, p_due_at: dueAt, p_assignees: [me.id], p_kind: 'report' })
ok('manager assigns report task with deadline time', !rtErr, rtErr?.message)
const { data: rt } = await emp.from('tasks').select('id, status, due_at, due_date').eq('title', 'Тест: отчёт по смене').single()
ok('deadline stored with time, date derived', rt?.due_at && rt.due_date, JSON.stringify(rt))
const { error: noResErr } = await emp.from('tasks').update({ status: 'review' }).eq('id', rt.id)
ok('report needs a result before review', !!noResErr, noResErr?.message)
const { error: selfDoneErr } = await emp.from('tasks').update({ status: 'done', result_note: 'Готово' }).eq('id', rt.id)
ok('assignee cannot close report task himself', !!selfDoneErr, selfDoneErr?.message)
const { error: subErr } = await emp.from('tasks').update({ status: 'review', result_note: 'Смена закрыта, расхождений нет' }).eq('id', rt.id)
ok('assignee submits report for review', !subErr, subErr?.message)
const { error: foreignReviewErr } = await emp.rpc('review_task', { p_task: rt.id, p_accept: true, p_comment: null })
ok('assignee cannot accept own report', !!foreignReviewErr, foreignReviewErr?.message)
const { error: backErr } = await mgr.rpc('review_task', { p_task: rt.id, p_accept: false, p_comment: 'Добавьте фото ячеек' })
ok('manager returns report with comment', !backErr, backErr?.message)
const { data: rtBack } = await emp.from('tasks').select('status, review_comment').eq('id', rt.id).single()
ok('returned report is back in progress', rtBack?.status === 'in_progress' && rtBack.review_comment === 'Добавьте фото ячеек', JSON.stringify(rtBack))
await emp.from('tasks').update({ status: 'review' }).eq('id', rt.id)
const { error: accErr } = await mgr.rpc('review_task', { p_task: rt.id, p_accept: true, p_comment: null })
const { data: rtDone } = await emp.from('tasks').select('status').eq('id', rt.id).single()
ok('manager accepts report', !accErr && rtDone?.status === 'done', accErr?.message ?? rtDone?.status)

const steps = [{ text: 'Шаг 1', done: false }, { text: 'Шаг 2', done: false }]
await mgr.rpc('assign_tasks', { p_title: 'Тест: чек-лист', p_description: '', p_priority: 'medium', p_category: 'general', p_due: null, p_due_at: dueAt, p_assignees: [me.id], p_kind: 'checklist', p_checklist: steps })
const { data: ct } = await emp.from('tasks').select('id, checklist').eq('title', 'Тест: чек-лист').single()
const { error: ctEarly } = await emp.from('tasks').update({ status: 'done' }).eq('id', ct.id)
ok('checklist cannot be closed with open steps', !!ctEarly, ctEarly?.message)
const { error: ctStep } = await emp.from('tasks').update({ checklist: [{ text: 'Шаг 1', done: true }, { text: 'Шаг 2', done: false }] }).eq('id', ct.id)
const { data: ctMid } = await emp.from('tasks').select('status').eq('id', ct.id).single()
ok('first checked step starts the task', !ctStep && ctMid?.status === 'in_progress', ctStep?.message ?? ctMid?.status)
const { error: ctHack } = await emp.from('tasks').update({ checklist: [{ text: 'Другой шаг', done: true }, { text: 'Шаг 2', done: true }] }).eq('id', ct.id)
ok('assignee cannot rewrite checklist steps', !!ctHack, ctHack?.message)
await emp.from('tasks').update({ checklist: [{ text: 'Шаг 1', done: true }, { text: 'Шаг 2', done: true }] }).eq('id', ct.id)
const { error: ctDone } = await emp.from('tasks').update({ status: 'done' }).eq('id', ct.id)
ok('checklist closes when all steps are done', !ctDone, ctDone?.message)

const { data: service } = await emp.from('courses').select('id').eq('slug', 'service').single()
const { error: ctaErr } = await mgr.rpc('assign_tasks', { p_title: 'Пройти курс «Стандарты клиентского сервиса»', p_description: '', p_priority: 'high', p_category: 'training', p_due: null, p_due_at: dueAt, p_assignees: [me.id], p_kind: 'course', p_course: service.id })
const { data: courseTask } = await emp.from('tasks').select('id, kind, course:courses!tasks_course_fk(slug)').eq('kind', 'course').eq('course_id', service.id).maybeSingle()
ok('course task links to the course', !ctaErr && courseTask?.course?.slug === 'service', ctaErr?.message ?? JSON.stringify(courseTask))
const { data: svcAssign } = await emp.from('course_assignments').select('status').eq('course_id', service.id).eq('employee_id', me.id).maybeSingle()
ok('course task also assigns the course', !!svcAssign, JSON.stringify(svcAssign))
const { error: ctManual } = await emp.from('tasks').update({ status: 'done' }).eq('id', courseTask.id)
ok('course task closes only by passing the course', !!ctManual, ctManual?.message)

// --- AI Jana видит свои задачи с дедлайнами, праздники и объявления
const { data: actx } = await emp.rpc('assistant_context')
ok('assistant context has tasks, holidays, news', Array.isArray(actx?.tasks) && actx.tasks.length > 0 && Array.isArray(actx.holidays) && Array.isArray(actx.news), `tasks=${actx?.tasks?.length} holidays=${actx?.holidays?.length} news=${actx?.news?.length}`)
ok('assistant context only own tasks', actx?.tasks?.every(x => x.from !== undefined), '')

// --- напоминания: HR всем, руководитель своей команде, работник никому
const { data: remSent, error: remErr } = await hr.rpc('send_reminder', { p_employees: [me.id], p_title: 'Тест напоминания', p_body: 'Проверьте профиль', p_link: '/profile' })
ok('hr sends reminder', !remErr && remSent === 1, remErr?.message)
const { error: empRemErr } = await emp.rpc('send_reminder', { p_employees: [hrMe], p_title: 'Спам', p_body: '', p_link: null })
ok('employee cannot send reminders', !!empRemErr, empRemErr?.message)

// --- фото профиля: видят все, меняет только владелец
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const { error: avErr } = await emp.from('employee_avatars').upsert({ employee_id: me.id, image: pixel })
ok('employee sets own photo', !avErr, avErr?.message)
const { data: avSeen } = await mgr.from('employee_avatars').select('employee_id').eq('employee_id', me.id)
ok('colleagues see the photo', avSeen?.length === 1, `rows=${avSeen?.length}`)
const { error: avForeignErr } = await emp.from('employee_avatars').upsert({ employee_id: hrMe, image: pixel })
ok('cannot set another employee photo', !!avForeignErr, avForeignErr?.message)
const { error: avBadErr } = await emp.from('employee_avatars').upsert({ employee_id: me.id, image: 'javascript:alert(1)' })
ok('photo must be an image', !!avBadErr, avBadErr?.message)
const { error: avDelErr } = await emp.from('employee_avatars').delete().eq('employee_id', me.id)
ok('employee removes own photo', !avDelErr, avDelErr?.message)

// --- сообщения: переписку видят и пишут только участники
const mgrId = (await hr.from('employees').select('id').eq('zup_id', 'JP-0012').single()).data.id
const { data: chatId, error: dcErr } = await emp.rpc('open_direct_chat', { p_employee: mgrId })
ok('open direct chat', !dcErr && !!chatId, dcErr?.message)
const { data: chatAgain } = await emp.rpc('open_direct_chat', { p_employee: mgrId })
ok('direct chat is reused', chatAgain === chatId, `${chatAgain} vs ${chatId}`)
const { data: sent, error: sendErr } = await emp.rpc('send_message', { p_chat: chatId, p_body: 'Тест: можно уйти пораньше в пятницу?' })
ok('send message', !sendErr && sent?.author_id === me.id, sendErr?.message)
const mgrChat = (await mgr.rpc('chat_list')).data?.find((c) => c.id === chatId)
ok('recipient sees unread', mgrChat?.unread >= 1, JSON.stringify(mgrChat))
const { error: replyErr } = await mgr.rpc('send_message', { p_chat: chatId, p_body: 'Да, оформи отгул.', p_reply_to: sent?.id })
ok('reply to message', !replyErr, replyErr?.message)
await mgr.rpc('mark_chat_read', { p_chat: chatId })
const mgrChat2 = (await mgr.rpc('chat_list')).data?.find((c) => c.id === chatId)
ok('mark chat read', mgrChat2?.unread === 0, JSON.stringify(mgrChat2))
const { data: hrSees } = await hr.from('chat_messages').select('id').eq('chat_id', chatId)
ok('outsiders cannot read the chat, even HR', (hrSees ?? []).length === 0, `rows=${hrSees?.length}`)
const { error: hrSendErr } = await hr.rpc('send_message', { p_chat: chatId, p_body: 'чужой' })
ok('outsiders cannot write to the chat', !!hrSendErr, hrSendErr?.message)
const { error: directInsErr } = await emp.from('chat_messages').insert({ chat_id: chatId, author_id: mgrId, body: 'подмена автора' })
ok('messages only through send_message', !!directInsErr, directInsErr?.message)
const { error: emptyErr } = await emp.rpc('send_message', { p_chat: chatId, p_body: '   ' })
ok('empty message rejected', !!emptyErr, emptyErr?.message)
const { data: grp, error: grpErr } = await mgr.rpc('create_group_chat', { p_title: 'Тест группы', p_members: [me.id, hrMe] })
ok('create group chat', !grpErr && !!grp, grpErr?.message)
const empGroups = (await emp.rpc('chat_list')).data?.filter((c) => c.id === grp)
ok('group members see the group', empGroups?.length === 1 && empGroups[0].member_count === 3, JSON.stringify(empGroups))

// --- объявления с видео: ролики из сида на месте, в базу пишется только корректный id YouTube
const { data: withVideo } = await emp.from('announcements').select('title, video').not('video', 'is', null)
ok('seeded announcements carry YouTube videos', (withVideo ?? []).length >= 5 && withVideo.every((a) => /^[A-Za-z0-9_-]{11}$/.test(a.video)), JSON.stringify((withVideo ?? []).map((a) => a.video)))
const hrId = (await hr.from('employees').select('id').eq('user_id', (await hr.auth.getUser()).data.user.id).single()).data.id
const { error: badVideoErr } = await hr.from('announcements').insert({ title: 'Тест: битое видео', body: 'текст', category: 'news', author_id: hrId, video: 'https://youtu.be/x' })
ok('announcement rejects a malformed video id', !!badVideoErr, badVideoErr?.message)
const { data: vidAnn, error: vidErr } = await hr.from('announcements').insert({ title: 'Тест: объявление с видео', body: 'текст', category: 'news', author_id: hrId, video: 'wln_JddiqUA' }).select('id, video').single()
ok('HR publishes an announcement with a video', !vidErr && vidAnn?.video === 'wln_JddiqUA', vidErr?.message)
const { error: empVidErr } = await emp.from('announcements').insert({ title: 'Тест: работник', body: 'текст', category: 'news', video: 'wln_JddiqUA' })
ok('employee cannot publish announcements', !!empVidErr, empVidErr?.message)

for (const r of results) console.log(r[0], '|', r[1], '|', String(r[2]).slice(0, 220))
const passed = results.filter((r) => r[0] === 'PASS').length
console.log('\nTOTAL', passed, '/', results.length)
process.exit(passed === results.length ? 0 : 1)
