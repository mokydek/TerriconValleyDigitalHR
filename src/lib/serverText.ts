/* i18n-ignore-file: шаблоны ниже распознают русские тексты, которые формирует база */
import { getLang, t, type I18nKey } from './i18n'

/**
 * Уведомления, журнал заявок, ответы интеграций и ошибки приходят из базы на русском.
 * Здесь они сопоставляются с ключами перевода: именованные группы шаблона становятся
 * переменными перевода ({n} и т. п.). Незнакомый текст показывается как есть.
 */

// Части шаблонов. Захваченные значения тоже проходят через serverText: так переводятся
// тип заявки, название системы, документ внутри сообщения, даты и суммы.
const rx = (s: TemplateStringsArray, ...v: string[]) => new RegExp(String.raw(s, ...v))
/** Тип заявки, как его пишет request_type_label() */
const T = '(?<type>Отпуск|Аванс|Справка с места работы|Изменение данных)'
const DM = String.raw`\d\d\.\d\d`
const DMY = String.raw`\d\d\.\d\d\.\d{4}`
/** Число из numeric-поля: «14.0» → 14, «14.5» остаётся как есть */
const num = (name: string) => String.raw`(?<${name}>-?\d+(?:\.\d*[1-9])?)(?:\.0+)?`
/** Сумма из fmt_money(): «150 000» */
const amount = (name: string) => String.raw`(?<${name}>\d{1,3}(?:[ \u00a0]\d{3})*)`
/** Диапазон дат отпуска «07.11–20.11.2026»: части отдельно, порядок задаёт перевод */
const RANGE = String.raw`(?<fd>\d\d)\.(?<fm>\d\d)–(?<td>\d\d)\.(?<tm>\d\d)\.(?<ty>\d{4})`

// Порядок важен: сначала точные и конкретные шаблоны, общие («Тип: комментарий» и т. п.) в конце
const RULES: [RegExp, I18nKey][] = [
  // ---------- Ошибки (raise exception) ----------
  [/^Официальные кадровые данные меняются только через 1С:ЗУП\. Оформите заявку «Изменение данных»\.$/, 'srv.err.officialData'],
  [/^Роль доступа может менять только HR$/, 'srv.err.roleOnlyHr'],
  [/^ИИН, дата рождения и оклад меняются только через 1С:ЗУП$/, 'srv.err.privateData'],
  [/^Сотрудник не найден$/, 'srv.err.employeeNotFound'],
  [/^Нет доступа к балансу отпуска другого сотрудника$/, 'srv.err.balanceAccess'],
  [/^Укажите даты отпуска$/, 'srv.err.vacationDates'],
  [/^Дата окончания раньше даты начала$/, 'srv.err.endBeforeStart'],
  [/^В выбранном периоде только праздничные дни$/, 'srv.err.onlyHolidays'],
  [/^Нельзя оформить отпуск задним числом$/, 'srv.err.vacationPast'],
  [/^Отпуск можно запланировать не более чем на год вперёд$/, 'srv.err.vacationTooFar'],
  [rx`^Даты пересекаются с заявкой №(?<n>\d+) \((?<from>${DMY}) – (?<to>${DMY})\)$`, 'srv.err.vacationOverlap'],
  [rx`^Недостаточно дней отпуска: доступно ${num('available')}, запрошено ${num('requested')}$`, 'srv.err.notEnoughDays'],
  [/^Укажите сумму аванса$/, 'srv.err.advanceAmount'],
  [rx`^Аванс не может превышать 50% оклада, максимум ${amount('max')} ₸$`, 'srv.err.advanceMax'],
  [/^Аванс можно запросить один раз в месяц, заявка в этом месяце уже есть$/, 'srv.err.advanceMonthly'],
  [/^Укажите, какие данные изменить и новое значение$/, 'srv.err.dataChangeFields'],
  [/^Заявка не найдена$/, 'srv.err.requestNotFound'],
  [/^Нет прав на эту заявку$/, 'srv.err.requestForbidden'],
  [/^Нельзя согласовать собственную заявку$/, 'srv.err.ownRequest'],
  [/^Заявка уже обработана$/, 'srv.err.requestHandled'],
  [/^У сотрудника недостаточно дней отпуска$/, 'srv.err.employeeNotEnoughDays'],
  [/^Оформление выполняет HR$/, 'srv.err.processByHr'],
  [/^Заявка ещё не согласована руководителем$/, 'srv.err.notApprovedYet'],
  [/^Заявка уже закрыта$/, 'srv.err.requestClosed'],
  [/^Укажите причину отказа$/, 'srv.err.rejectReason'],
  [/^Неизвестное действие:? (?<action>.+)$/, 'srv.err.unknownAction'],
  [/^Оформленную или закрытую заявку отменить нельзя, обратитесь в HR$/, 'srv.err.cancelClosed'],
  [/^Только для HR$/, 'srv.err.hrOnly'],
  [/^Заявка не ждёт решения$/, 'srv.err.notAwaiting'],
  [/^Нет доступа$/, 'srv.err.noAccess'],
  [/^Нет прав$/, 'err.forbidden'],
  [/^Урок не найден$/, 'srv.err.lessonNotFound'],
  [/^Курс не найден$/, 'srv.err.courseNotFound'],
  [/^Сначала изучите все уроки курса$/, 'srv.err.lessonsFirst'],
  [/^Отвечает HR$/, 'srv.err.answerByHr'],
  [/^Введите ответ$/, 'srv.err.enterAnswer'],
  [/^Обращение не найдено$/, 'srv.err.ticketNotFound'],
  [/^Исполнитель может менять только статус задачи$/, 'srv.err.taskStatusOnly'],
  [/^Укажите название задачи$/, 'srv.err.taskTitle'],
  [/^Нет прав ставить задачи выбранным сотрудникам$/, 'srv.err.taskForbidden'],
  [/^Аналитика доступна руководителю и HR$/, 'srv.err.analyticsAccess'],
  [/^Неизвестный запрос (?<kind>.+)$/, 'srv.err.unknownQuery'],
  [/^Синхронизацию запускает HR$/, 'srv.err.syncByHr'],
  [/^Выберите коллегу$/, 'srv.err.pickColleague'],
  [/^Укажите название группы$/, 'srv.err.groupTitle'],
  [/^Для группы выберите хотя бы двух коллег$/, 'srv.err.groupMin'],
  [/^В группе может быть не больше 100 человек$/, 'srv.err.groupMax'],
  [/^Чат не найден$/, 'srv.err.chatNotFound'],
  [/^Сообщение пустое$/, 'srv.err.messageEmpty'],
  [/^Сообщение длиннее 4000 символов$/, 'srv.err.messageTooLong'],
  [/^Сообщение для ответа не найдено$/, 'srv.err.replyNotFound'],
  [/^В канале публикуют только администраторы$/, 'srv.err.channelPost'],
  [/^Не больше 10 вложений в одном сообщении$/, 'srv.err.attachMax'],
  [/^Неизвестный тип вложения$/, 'srv.err.attachKind'],
  [/^Файл не прочитан, приложите его ещё раз$/, 'srv.err.attachRead'],
  [/^Файл больше 5 МБ$/, 'srv.err.attachSize'],
  [/^Вложения в одном сообщении больше 15 МБ$/, 'srv.err.attachTotal'],
  [/^Сообщение не найдено$/, 'srv.err.messageNotFound'],
  [/^Изменить можно только своё сообщение$/, 'srv.err.editOwn'],
  [/^Удалить можно только своё сообщение$/, 'srv.err.deleteOwn'],
  [/^Неизвестная реакция$/, 'srv.err.reaction'],
  [/^Выберите сообщения$/, 'srv.err.pickMessages'],
  [/^Можно переслать не больше 50 сообщений за раз$/, 'srv.err.forwardMax'],
  [/^Закреплять сообщения могут владелец и администраторы$/, 'srv.err.pinRights'],
  [/^Неизвестный тип чата$/, 'srv.err.chatKind'],
  [/^Выберите хотя бы одного коллегу$/, 'srv.err.pickOne'],
  [/^В группе может быть не больше 300 человек$/, 'srv.err.groupMax300'],
  [/^Менять группу могут владелец и администраторы$/, 'srv.err.editGroupRights'],
  [/^В личный чат нельзя добавить участников$/, 'srv.err.directAdd'],
  [/^Добавлять в канал могут владелец и администраторы$/, 'srv.err.channelAdd'],
  [/^Чтобы выйти, нажмите «Покинуть группу»$/, 'srv.err.removeSelf'],
  [/^Недостаточно прав в этой группе$/, 'srv.err.groupRights'],
  [/^Покинуть можно только группу или канал$/, 'srv.err.leaveKind'],
  [/^Назначать администраторов может только владелец$/, 'srv.err.ownerOnly'],
  [/^Неизвестная роль$/, 'srv.err.roleUnknown'],
  [/^Нельзя изменить свою роль$/, 'srv.err.roleSelf'],
  [/^Опрос можно создать в группе или канале$/, 'srv.err.pollWhere'],
  [/^Укажите вопрос опроса$/, 'srv.err.pollQuestion'],
  [/^В опросе нужно хотя бы два варианта$/, 'srv.err.pollMin'],
  [/^В опросе может быть не больше 10 вариантов$/, 'srv.err.pollMax'],
  [/^Опрос не найден$/, 'srv.err.pollNotFound'],
  [/^Опрос уже завершён$/, 'srv.err.pollClosed'],
  [/^В этом опросе можно выбрать только один вариант$/, 'srv.err.pollSingle'],
  [/^Нет такого варианта$/, 'srv.err.pollOption'],
  [/^Завершить опрос может автор или администратор$/, 'srv.err.pollCloseRights'],
  [/^Вас упомянули в чате «(?<title>[\s\S]+)»$/, 'srv.chat.mention'],

  // ---------- Заявки: уведомления и история ----------
  [/^№(?<n>\d+)$/, 'srv.num'],
  [/^Новая заявка: (?<type>.+)$/, 'srv.req.new'],
  [rx`^(?<name>.+?) · №(?<n>\d+) · ${RANGE} \(${num('days')} дн\.\)$`, 'srv.req.newBodyVacation'],
  [rx`^(?<name>.+?) · №(?<n>\d+) · ${amount('amount')} ₸$`, 'srv.req.newBodyAdvance'],
  [/^(?<name>.+?) · №(?<n>\d+)$/, 'srv.req.newBody'],
  [/^Заявка №(?<n>\d+) согласована$/, 'srv.req.approved'],
  [rx`^${T}: согласовано руководителем, передано в HR на оформление$`, 'srv.req.approvedBody'],
  [/^Оформите заявку №(?<n>\d+)$/, 'srv.req.toProcess'],
  [rx`^(?<name>.+?) · ${T}: согласовано руководителем$`, 'srv.req.toProcessBody'],
  [/^Заявка №(?<n>\d+) передана на оформление$/, 'srv.req.processing'],
  [rx`^${T}: HR передал заявку в (?<system>1С:ЗУП|Documentolog)$`, 'srv.req.processingBody'],
  [/^Заявка №(?<n>\d+) отклонена$/, 'srv.req.rejected'],
  [/^Заявка №(?<n>\d+) отозвана$/, 'srv.req.withdrawn'],
  [/^(?<name>.+?) отменил\(а\) заявку: (?<type>отпуск|аванс|справка с места работы|изменение данных)$/, 'srv.req.withdrawnBody'],
  [/^⏰ Заявка №(?<n>\d+) ждёт вашего решения$/, 'srv.req.nudge'],
  [rx`^(?<name>.+?) · ${T}: висит (?<h>\d+) ч\. HR просит рассмотреть сегодня$`, 'srv.req.nudgeBody'],
  [/^Заявка №(?<n>\d+) оформлена(?: ✅)?$/, 'srv.req.done'],
  [/^Отпуск оформлен: (?<doc>.+)\. Ознакомьтесь с приказом в Documentolog$/, 'srv.req.doneVacation'],
  [rx`^Аванс ${amount('amount')} ₸ передан на выплату \((?<doc>.+)\)\. Зачисление до 3 рабочих дней$`, 'srv.req.doneAdvance'],
  [/^Справка готова: (?<doc>.+)$/, 'srv.req.doneCertificate'],
  [/^Изменения переданы в 1С:ЗУП: (?<doc>.*)$/, 'srv.req.doneDataChange'],
  [/^Передано в 1С:ЗУП$/, 'srv.event.toZup'],
  [/^Передано в Documentolog$/, 'srv.event.toDocumentolog'],
  [/^HR напомнил согласующему: (?<name>.+)$/, 'srv.event.nudged'],
  [/^1С:ЗУП: (?<doc>.+)$/, 'srv.event.zupDoc'],
  [/^Documentolog: (?<doc>.+)$/, 'srv.event.dlDoc'],

  // ---------- «Слежу»: «Слежу · Имя: событие» (старые записи начинались со значка глаза) ----------
  [/^(?:👁|Слежу ·) (?<name>[^:]+): (?<title>[\s\S]+)$/, 'srv.follow.title'],
  [/^новая заявка «(?<type>.+)»$/, 'srv.follow.newRequest'],
  [/^заявка №(?<n>\d+) согласована руководителем$/, 'srv.follow.approved'],
  [/^заявка №(?<n>\d+) отклонена$/, 'srv.follow.rejected'],
  [/^заявка №(?<n>\d+) оформлена$/, 'srv.follow.done'],
  [/^назначен курс «(?<title>.+)»$/, 'srv.follow.courseAssigned'],
  [rx`^до (?<date>${DMY})$`, 'srv.follow.courseDue'],
  [/^сдал\(а\) тест «(?<title>.+)»$/, 'srv.follow.quizPassed'],
  [/^не сдал\(а\) тест «(?<title>.+)»$/, 'srv.follow.quizFailed'],
  [/^Результат: (?<score>\d+)%$/, 'srv.follow.quizScore'],
  [/^просрочен курс «(?<title>.+)»$/, 'srv.follow.courseOverdue'],
  [/^просрочена задача №(?<n>\d+)$/, 'srv.follow.taskOverdue'],
  [rx`^Срок: (?<date>${DMY})$`, 'srv.follow.dueDate'],

  // ---------- Интеграции: 1С:ЗУП и Documentolog ----------
  [/^1С:ЗУП$/, 'srv.sys.zup'],
  [rx`^Приказ о предоставлении отпуска № (?<no>\S+) от (?<date>${DMY})$`, 'srv.doc.vacationOrder'],
  [/^Ведомость на выплату аванса № (?<no>\S+)$/, 'srv.doc.advancePayment'],
  [/^Заявление на изменение данных № (?<no>\S+)$/, 'srv.doc.dataChange'],
  [/^Документ № (?<no>\S+)$/, 'srv.doc.genericNo'],
  [/^Лист ознакомления с приказом (?<no>\S+)$/, 'srv.doc.acquaintance'],
  [/^Справка с места работы (?<no>DL-\S+)$/, 'srv.doc.certificate'],
  [/^Документ (?<no>DL-\S+)$/, 'srv.doc.generic'],
  [/^приказ сформирован$/, 'srv.doc.orderCreated'],
  [/^Ознакомление работника$/, 'srv.route.acquaintance'],
  [/^Подписание HR → выдача работнику$/, 'srv.route.certificate'],
  [/^должность$/, 'srv.zup.fieldPosition'],

  // ---------- Jana Academy ----------
  [/^Назначен курс: (?<title>.+)$/, 'srv.course.assigned'],
  [rx`^Jana Academy · пройти до (?<date>${DMY})$`, 'srv.course.assignedBody'],
  [/^Курс пройден: (?<title>.+)$/, 'srv.course.passed'],
  [/^Результат теста: (?<score>\d+)%\. Сертификат доступен в Jana Academy$/, 'srv.course.passedBody'],
  [/^Курс завершён$/, 'srv.course.completed'],
  [/^(?<name>.+?) прошёл\(ла\) «(?<title>.+)»: (?<score>\d+)%$/, 'srv.course.completedBody'],

  // ---------- Задачи, объявления, обращения в HR ----------
  [/^Новая задача №(?<n>\d+)$/, 'srv.task.new'],
  [/^Вам назначена задача №(?<n>\d+)$/, 'srv.task.assigned'],
  [/^Задача №(?<n>\d+) выполнена$/, 'srv.task.done'],
  [/^Задача №(?<n>\d+) на проверке$/, 'srv.task.review'],
  [/^Срочное объявление$/, 'srv.ann.urgent'],
  [/^Важное объявление$/, 'srv.ann.important'],
  [/^Новое обращение №(?<n>\d+)$/, 'srv.ticket.new'],
  [/^HR ответил на обращение №(?<n>\d+)$/, 'srv.ticket.answered'],
  [rx`^Ответ HR на обращение №(?<n>\d+) от (?<date>${DMY})$`, 'srv.kb.faqSource'],

  // ---------- «Зона внимания» ----------
  [rx`^Накоплено ${num('days')} дн\. отпуска$`, 'srv.att.vacationTitle'],
  [/^Риск выгорания и «сгорания» дней, предложите запланировать отпуск$/, 'srv.att.vacationDetails'],
  [/^Просрочен курс «(?<title>.+)»$/, 'srv.att.courseTitle'],
  [rx`^Срок был (?<date>${DM}) \(${num('days')} дн\. назад\), прогресс (?<progress>\d+)%$`, 'srv.att.courseDetails'],
  [/^Заявка №(?<n>\d+) висит у руководителя (?<h>\d+) ч$/, 'srv.att.requestTitle'],
  [rx`^${T} · согласующий: (?<name>.+)$`, 'srv.att.requestDetails'],
  [/^Новичок без онбординга$/, 'srv.att.onboardingTitle'],
  [rx`^В компании ${num('days')} дн\., адаптационный курс не назначен$`, 'srv.att.onboardingDetails'],
  [/^Запланируйте отпуск(?: 🌴)?$/, 'srv.att.vacationNotif'],
  [rx`^У вас накоплено ${num('days')} дн\. отпуска\. Оформите заявку в JanaMen и подберите даты вместе с руководителем\.$`, 'srv.att.vacationNotifBody'],
  [/^Напоминание: курс «(?<title>.+)»$/, 'srv.att.courseNotif'],
  [rx`^Срок прохождения истёк (?<date>${DMY})\. Пройдите курс в Jana Academy, это займёт около (?<min>\d+) минут\.$`, 'srv.att.courseNotifBody'],
  [/^Напоминание об отпуске отправлено$/, 'srv.att.vacationSent'],
  [/^Напоминание о курсе отправлено$/, 'srv.att.courseSent'],
  [/^Руководителю отправлено напоминание$/, 'srv.att.nudgeSent'],
  [/^Курс «(?<title>.+)» назначен$/, 'srv.att.courseAssigned'],

  // ---------- Аналитика ----------
  [/^Без подразделения$/, 'srv.an.noDepartment'],
  [/^Дописать положение: «(?<q>[\s\S]+)»$/, 'srv.an.kbSuggestion'],
  [/^(?<m>янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек) (?<yy>\d\d)$/, 'srv.an.monthYear'],
  [/^янв$/i, 'srv.month.jan'],
  [/^фев$/i, 'srv.month.feb'],
  [/^мар$/i, 'srv.month.mar'],
  [/^апр$/i, 'srv.month.apr'],
  [/^май$/i, 'srv.month.may'],
  [/^июн$/i, 'srv.month.jun'],
  [/^июл$/i, 'srv.month.jul'],
  [/^авг$/i, 'srv.month.aug'],
  [/^сен$/i, 'srv.month.sep'],
  [/^окт$/i, 'srv.month.oct'],
  [/^ноя$/i, 'srv.month.nov'],
  [/^дек$/i, 'srv.month.dec'],

  // ---------- Праздники (таблица holidays) ----------
  [/^Новый год$/, 'srv.hol.newYear'],
  [/^Рождество Христово$/, 'srv.hol.christmas'],
  [/^Международный женский день$/, 'srv.hol.womensDay'],
  [/^Наурыз мейрамы$/, 'srv.hol.nauryz'],
  [/^Праздник единства народа Казахстана$/, 'srv.hol.unity'],
  [/^День защитника Отечества$/, 'srv.hol.defender'],
  [/^День Победы$/, 'srv.hol.victory'],
  [/^Курбан айт$/, 'srv.hol.kurban'],
  [/^День Столицы$/, 'srv.hol.capital'],
  [/^День Конституции$/, 'srv.hol.constitution'],
  [/^День Республики$/, 'srv.hol.republic'],
  [/^День Независимости$/, 'srv.hol.independence'],
  [/^Перенос выходного дня \((?<holiday>.+)\)$/, 'srv.hol.transfer'],

  // ---------- Демо-уведомления из seed.sql ----------
  [/^Оформите заявку$/, 'srv.seed.toProcess'],
  [/^Заявка оформлена$/, 'srv.seed.done'],
  [/^Справка готова, см\. карточку заявки$/, 'srv.seed.certReady'],
  [/^Новое обращение$/, 'srv.seed.ticketNew'],
  [/^Добро пожаловать в Jana Post!(?: 👋)?$/, 'srv.seed.welcome'],
  [/^Начните с курса «(?<title>.+)» в Jana Academy$/, 'srv.seed.welcomeBody'],

  // ---------- Типы заявок (в том числе со строчной буквы: «отменил(а) заявку: отпуск») ----------
  [/^Отпуск$/i, 'type.vacation'],
  [/^Аванс$/i, 'type.advance'],
  [/^Справка с места работы$/i, 'type.certificate'],
  [/^Изменение данных$/i, 'type.data_change'],

  // ---------- Общие шаблоны: постоянная часть вокруг пользовательского текста ----------
  [rx`^${T}: (?<comment>[\s\S]+)$`, 'srv.req.rejectedBody'],
  [/^(?<name>[^:«»\n]+): «(?<q>[\s\S]+)»$/, 'srv.ticket.newBody'],
  [rx`^(?<title>[\s\S]+) · до (?<date>${DM})$`, 'srv.task.newBody'],
  [rx`^(?<name>[^·:\n]+) · ${RANGE}$`, 'srv.seed.vacationBody'],
  [rx`^(?<name>[^·:\n]+) · ${amount('amount')} ₸$`, 'srv.seed.advanceBody'],

  // ---------- Даты и суммы внутри текстов ----------
  [/^(?<d>\d\d)\.(?<m>\d\d)\.(?<y>\d{4})$/, 'srv.fmt.date'],
  [/^(?<d>\d\d)\.(?<m>\d\d)$/, 'srv.fmt.dayMonth'],
  [/^(?<a>\d{1,3})[ \u00a0](?<b>\d{3})$/, 'srv.fmt.num2'],
  [/^(?<a>\d{1,3})[ \u00a0](?<b>\d{3})[ \u00a0](?<c>\d{3})$/, 'srv.fmt.num3'],
]

export function serverText(text: string | null | undefined): string {
  if (!text) return ''
  if (getLang() === 'ru') return text
  for (const [re, key] of RULES) {
    const m = re.exec(text)
    if (m) {
      const vars: Record<string, string> = {}
      for (const [k, v] of Object.entries(m.groups ?? {})) if (v !== undefined) vars[k] = serverText(v)
      return t(key, vars)
    }
  }
  return text
}
