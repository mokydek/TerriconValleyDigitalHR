/* i18n-ignore-file: регулярные выражения распознают вопросы на всех языках интерфейса, русские названия статей и значения из базы */
/**
 * AI Jana: распознавание вопросов без LLM на языках интерфейса: ru, kk, en, ky, uz (латиница), tg, mn.
 *
 * Русские выражения перенесены из engine.ts и проверяются по строке q, как раньше (исправлено только
 * «заявок»: прежнее «заявк» не находило это слово).
 * Выражения других языков проверяются по строке f: в ней особые буквы казахского, кыргызского,
 * таджикского и монгольского алфавитов заменены похожими русскими (қ → к, ү → у, ҳ → х, ӣ → и …),
 * английские who’s, what’s… раскрыты в who is, what is…, а апострофы убраны (taʼtil → tatil,
 * didn’t → didnt). Так понимаются и вопросы, набранные на русской раскладке. Выражения пишутся
 * обычной орфографией, ml() приводит их к тому же виду.
 * Выражения других языков не должны совпадать с русским текстом: русские вопросы распознаются как прежде.
 * В тюркских языках и монгольском порядок слов свободнее, поэтому часть правил собрана из (?=.*…) условий.
 */

export interface Query {
  /** вопрос как есть */
  raw: string
  /** нижний регистр, ё → е, одинарные пробелы (как раньше) */
  q: string
  /** q без особых букв и апострофов: для выражений на других языках */
  f: string
}

const LETTERS: Record<string, string> = {
  ә: 'а', ғ: 'г', қ: 'к', ң: 'н', ө: 'о', ұ: 'у', ү: 'у', һ: 'х', і: 'и', ҷ: 'ч', ӣ: 'и', ӯ: 'у', ҳ: 'х', ё: 'е',
}
const fold = (s: string) => s.replace(/[әғқңөұүһіҷӣӯҳё]/g, (c) => LETTERS[c]).replace(/[ʻʼ'`´‘’]/g, '')

// who’s on vacation → who is on vacation: выражения ждут отдельное слово who
const EN_IS = /\b(who|what|where|when|how|which|there|that|it)['’]s\b/g

export function prepare(raw: string): Query {
  const q = raw.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
  return { raw, q, f: fold(q.replace(EN_IS, '$1 is')) }
}

/** Выражение для строки f: те же замены букв в самом выражении */
const ml = (re: RegExp) => new RegExp(fold(re.source), re.flags)
const some = (list: RegExp[], s: string) => list.some((re) => re.test(s))

/* ---------- Приветствие и вопросы о возможностях ---------- */

const GREETING_RU = /^(привет|здравств|добрый (день|вечер)|доброе утро|салем|сәлем|hello|hi\b)/
const ABOUT_RU = /(что|чем) (ты )?(умеешь|можешь помочь)|кто ты/

const GREETING = [
  /^(сәлем|сәлеметсіз|қайырлы (таң|күн|кеш)|армысыз|ассалаумағалейкум|амансыз ба)/, // kk
  /^(hello|hi|hey|hiya|greetings|good (morning|afternoon|evening|day))\b/, // en
  /^(салам|саламатсыз|кутман (таң|күн|кеч)|ассалому алейкум|ассаламу алейкум)/, // ky
  /^(salom|assalomu alaykum|assalom|xayrli (tong|kun|kech)|hayrli (tong|kun|kech))/, // uz
  /^(салом|ассалому алейкум|ассалом|дуруд|субҳ ба хайр|рӯз ба хайр|шом ба хайр|бегоҳ ба хайр)/, // tg
  /^(сайн байна уу|сайн байцгаана уу|сайн уу|өглөөний мэнд|өдрийн мэнд|оройн мэнд|мэнд хүргэе)/, // mn
].map(ml)

const ABOUT = [
  /(не істей аласың|не істей аласыз|немен көмектесе ал|сен кімсің|сіз кімсіз|не білесің|не білесіз)/, // kk
  /\b(what can you do|who are you|how can you help|what can you help|what are you able to|what are your (capabilities|features))\b/, // en
  /(эмне кыла аласың|эмне кыла аласыз|эмнеге жардам бере|кантип жардам бере|сен кимсиң|сиз кимсиз)/, // ky
  /(nima qila olasan|nima qila olasiz|nimaga yordam ber|qanday yordam ber|sen kimsan|siz kimsiz)/, // uz
  /(ту кистӣ|шумо кистед|чӣ кор карда метавон|чӣ ёрӣ дода метавон|чӣ кӯмак карда метавон)/, // tg
  /(чи хэн бэ|та хэн бэ|юу хийж чадах|юугаар туслах|юу чаддаг|яаж туслах)/, // mn
].map(ml)

export const isGreeting = (x: Query) => GREETING_RU.test(x.q) || ABOUT_RU.test(x.q) || some(GREETING, x.f) || some(ABOUT, x.f)

/* ---------- Защита: чужие персональные данные ---------- */

const SENSITIVE_RU = /(зарплат|заработн|оклад|(^|[^а-я])зп(?![а-я])|получает|иин|адрес|дат[аы] рождени|день рождени|паспорт|удостоверени|больничн|диагноз|болеет|телефон|премия|штраф|кредит)/
const OTHERS_RU = /(у (моего |моей |нашего |нашей )?(руководител|начальник|коллег|директор|сотрудник|друг|сосед)|других сотрудник|чуж|коллеги(?![а-я])|всех сотрудник|кто сколько)/
const NAME_REF_RU = /(?:у|про|о|об)\s+([А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]{2,})/

const SENSITIVE = [
  /(жалақ|айлық|еңбекақ|зарплат|жсн|иин|мекенжай|туған күн|төлқұжат|паспорт|куәлі|ауырып|ауру|диагноз|телефон|сыйақы|премия|айыппұл|несие|кредит)/, // kk
  /\b(salary|salaries|wages?|pay|paid|earns?|earning|earnings|income|bonus|bonuses|iin|address|birthday|birth date|date of birth|passport|id card|sick|illness|diagnosis|phone|fines|penalty|penalties|loan|credit)\b/, // en
  /(айлык|айлыг|маяна|эмгек акы|зарплат|инн|иин|дарек|дарег|туулган күн|паспорт|күбөлүк|ооруп|оорусу|бейтап|диагноз|телефон|сыйлык|премия|айып|насыя|кредит)/, // ky
  /(maosh|ish haqi|oylik|zarplata|jshshir|inn|stir|manzil|tugʻilgan kun|pasport|guvohnoma|kasal|tashxis|telefon|mukofot|bonus|premiya|jarima|kredit|qarz)/, // uz
  /(маош|музди меҳнат|зарплат|иин|суроға|рӯзи таваллуд|шиноснома|гувоҳнома|бемор|ташхис|телефон|мукофот|ҷарима|қарз|кредит)/, // tg
  /(цалин|орлого|зарплат|регистр|хаяг|төрсөн өдөр|паспорт|үнэмлэх|өвч|онош|утас|урамшуулал|шагнал|торгууль|зээл)/, // mn
].map(ml)

const OTHERS = [
  /(басшымның|бастығымның|басшының|бастықтың|әріптес(імнің|тің|тердің|терімнің)|әріптестер|басқа қызметкерлердің|барлық қызметкерлердің|кім қанша|біреудің|бөтен|басқалардың)/, // kk
  /\b(colleagues|coworkers|co-workers|teammates|my (colleague|coworker|co-worker|teammate)|other (employees|people|staff|workers|colleagues)|all (employees|staff|workers)|every employee|someone else|somebody else|anyone else|who earns|who gets paid|who is paid|(his|her) (salary|pay|wages?|income|address|phone|passport|birthday|bonus|diagnosis))\b/, // en
  /(жетекчимдин|жетекчинин|начальнигимдин|кесиптеш(имдин|тин|тердин|теримдин)|кесиптештер|башка кызматкерлердин|бардык кызматкерлердин|ким канча|бирөөнүн|бөтөн|башкалардын)/, // ky
  /(rahbarimning|rahbarning|boshligʻimning|boshliqning|hamkasb(imning|ning|larning|larimning)|hamkasblar|boshqa xodimlar|barcha xodimlar|hamma xodimlar|kim qancha|birovning|begona|boshqalarning)/, // uz
  /((маош|музд|суроға|телефон|шиноснома|мукофот)и (роҳбар|сардор|ҳамкор|дигарон)|ҳамкорон|дигар кормандон|кормандони дигар|ҳамаи кормандон|кӣ чанд|бегона|дигарон)/, // tg
  /(удирдагчийн|даргын|хамт ажиллагс|бусад ажилт|бүх ажилт|хэн хэдэн|бусдын|хэний)/, // mn
].map(ml)
// en: притяжательная форма с апострофом, проверяется по q
const OTHERS_EN_POSSESSIVE = /\b(manager|boss|supervisor|director|colleague|coworker|co-worker|teammate|everyone|everybody|someone|somebody)['’]s\b/

/**
 * Имя другого человека рядом с личными данными: «Айгерімнің жалақысы», «Aigerim’s salary», «маоши Айгерим».
 * Ищется по исходному тексту: имя пишется с заглавной буквы. next: что должно идти сразу после имени.
 */
const NAME_RULES: { re: RegExp; next?: RegExp }[] = [
  // kk: родительный падеж с ң / і, дальше слово о личных данных
  { re: /([А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]{2,}?)(?:ның|нің|дың|дің|тың|тің)(?![а-яёәғқңөұүһі])/g, next: ml(/^\s*(\S+\s+)?(жалақ|айлық|еңбекақ|зарплат|мекенжай|телефон|жсн|иин|туған күн|төлқұжат|паспорт|куәлі|диагноз|ауру|сыйақы|премия|айыппұл|несие|кредит)/) },
  // en: Aigerim’s salary / phone number
  { re: /\b([A-Z][a-z]{2,})['’]s\b/g, next: /^\s*(\S+\s+)?(salary|salaries|pay|wages?|income|bonus|address|phone|passport|birthday|date of birth|iin|diagnosis|sick|illness)/ },
  // en: how much does Aigerim earn
  { re: /\b(?:does|did)\s+([A-Z][a-z]{2,})\b/g, next: /^\s*(earn|make|get paid|get|receive)\b/ },
  // ky: Айгеримдин айлыгы (только кыргызские слова после имени)
  { re: /([А-ЯЁҢӨҮ][а-яёңөү]{2,}?)(?:нын|нин|нун|нүн|дын|дин|дун|дүн|тын|тин|тун|түн)(?![а-яёңөү])/g, next: ml(/^\s*(\S+\s+)?(айлы|маяна|эмгек акы|дарег|дарек|туулган|оорусу|бейтап|ден соолу|телефон номер|сыйлык)/) },
  // uz: Aigerimning maoshi
  { re: /\b([A-Z][a-z]{2,})ning\b/g, next: ml(/^\s*(\S+\s+)?(maosh|oylik|ish haqi|manzil|telefon|pasport|tugʻilgan|kasal|tashxis|mukofot|jarima|kredit)/) },
  // mn: Айгеримийн цалин (только монгольские слова после имени)
  { re: /([А-ЯЁӨҮ][а-яёөү]{2,}?)(?:гийн|ийн|ын|ний|ны|ий)(?![а-яёөү])/g, next: ml(/^\s*(\S+\s+)?(цалин|хаяг|утас|регистр|төрсөн|онош|өвч|урамшуулал|шагнал|орлого)/) },
]
// tg: изафет, слово о личных данных стоит перед именем: «маоши Айгерим»
const NAME_AFTER_TG = /(?:маош|музд|суроға|телефон|шиноснома|санаи таваллуд|ташхис|мукофот)[иӣ]\s+([^\s.,!?«»"]{3,})/gi
// Слова с заглавной буквы, которые не имена: местоимения и частые существительные в начале вопроса
const NOT_NAMES = /^(сиз|биз|сиздер|сиздерд|олар|компан|кызметкер|ажилт|басшы|бастык|болим|болум|команд|мекеме|уйым|казакстан|кыргызстан|жумыс|иш|менеджер|директор|адам|киши|хэлт|монгол|мин|чин|бидн|байгууллаг|хун|siz|biz|kompaniya|xodim|rahbar|odam|ish|jana|janamen|post|academy|claude|company|employee|employees|staff|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)/

function otherPersonNamed(raw: string, myFirstName: string): boolean {
  const me = fold(myFirstName.toLowerCase())
  const isOther = (name: string) => {
    const n = fold(name.toLowerCase())
    return name[0] !== name[0].toLowerCase() && n !== me && !NOT_NAMES.test(n)
  }
  for (const { re, next } of NAME_RULES) {
    for (const m of raw.matchAll(re)) {
      const rest = fold(raw.slice((m.index ?? 0) + m[0].length).toLowerCase())
      if ((!next || next.test(rest)) && isOther(m[1])) return true
    }
  }
  for (const m of raw.matchAll(NAME_AFTER_TG)) if (isOther(m[1])) return true
  return false
}

export function asksForOthersData(x: Query, myFirstName: string): boolean {
  if (SENSITIVE_RU.test(x.q)) {
    if (OTHERS_RU.test(x.q)) return true
    const m = x.raw.match(NAME_REF_RU)
    if (m && m[1].toLowerCase() !== myFirstName.toLowerCase()) return true
  }
  if (!some(SENSITIVE, x.f)) return false
  return some(OTHERS, x.f) || OTHERS_EN_POSSESSIVE.test(x.q) || otherPersonNamed(x.raw, myFirstName)
}

/* ---------- Личные данные ---------- */

const BALANCE_RU = /(сколько|остат|осталось|баланс|доступно).*(отпуск|дней отдыха|демалыс)|(отпуск|демалыс).*(осталось|остаток|сколько у меня|мне положено еще)/
const MY_REQUESTS_RU = /(статус|где|что с|как там).*(заявк|отпуск|аванс|справк)|(мои|моя|моих|моей) заяв(к|ок)/
const MY_COURSES_RU = /(мои|мой|мне назначен|назначенн).*(курс|обучени)|какие (у меня )?курсы|что (мне )?(нужно )?пройти|(дедлайн|срок)[а-я ]*(курс|обучени)/
const MY_MANAGER_RU = /(кто|мой|моя).*(руководител|начальник)/
const SALARY_RU = /зарплат|оклад/
const MY_HIRE_RU = /(когда|дата).*(принят|приема|трудоустро)|мой стаж|сколько я работаю/

// en: отпуск, но не больничный, декрет или праздники
const NOT_VACATION_EN = String.raw`^(?!.*\b(sick|maternity|paternity|parental|unpaid|study|medical|public holidays?|bank holidays?|national holidays?)\b)`
const VACATION_EN = '(vacation|holidays?|annual leave|time off|days off|pto|leave days|days of leave|leave balance|leave entitlement|leave do i|leave have i|leave i have|leave left|leave remaining)'

const BALANCE = [
  /(қанша|неше|қалды(?!р)|қалған|қалдығ).*демалыс|демалыс.*(қанша|неше|қалды(?!р)|қалған|қалдығ|баланс)|(қанша|неше) күн(ім)? қалды(?!р)/, // kk
  new RegExp(`${NOT_VACATION_EN}.*((how many|how much|remaining|left|balance|available|unused).*${VACATION_EN}|${VACATION_EN}.*(left|remaining|balance|available|do i have|have i got|i have))`), // en
  /(канча|(^|[^а-я])нече([^а-я]|$)|калды(?!р)|калган|калдыг|калдык).*(өргүү|эс алуу|отпуск)|(өргүү|эс алуу).*(канча|(^|[^а-я])нече([^а-я]|$)|калды(?!р)|калган|калдыг|калдык|баланс)/, // ky
  /(necha|qancha|qoldi(?!r)|qolgan|qoldiq).*taʼtil|taʼtil.*(necha|qancha|qoldi(?!r)|qolgan|qoldiq|balans)/, // uz
  /(чанд|боқӣ|бақия|мондааст).*рухсат|рухсат.*(чанд|боқӣ|бақия|мондааст|баланс)/, // tg
  /(хэдэн|хэд|үлд).*амралт|амралт.*(хэд|үлд|баланс)/, // mn
].map(ml)

const MY_REQUESTS = [
  /өтінім(ім|дерім)|менің өтінім|(мәртебе|күй|статус|қайда|не болды|жағдай).*(өтінім|демалыс|аванс|анықтама)|өтінім.*(мәртебе|күй(і|де)|статус|қайда|не болды|жағдай)/, // kk
  /\bmy (requests|applications)\b|\b(status|what about|what happened|where is|where are|how is|how are|track|update on)\b.*\bmy\b.*\b(requests?|applications?|vacation|leave|advance|certificate)\b/, // en
  /арыз(ым|дарым)|менин арыз|(статус|абал|кайда|эмне болду).*(арыз|өргүү|аванс|маалымкат)|арыз.*(статус|абал|кайда|эмне болду)/, // ky
  /ariza(m|larim)|mening ariza|(holat|status|qayerda|nima boʻldi).*(ariza|taʼtil|avans|maʼlumotnoma)|ariza.*(holat|status|qayerda|nima boʻldi)/, // uz
  /дархост(ҳои ман|и ман|ҳоям|ам)|(ҳолат|вазъ|статус|куҷо).*(дархост|рухсатӣ|пешпардохт|маълумотнома)|дархост.*(ҳолат|вазъ|статус|куҷо)/, // tg
  /миний хүсэлт|хүсэлт(үүд)? (маань|минь)|(төлөв|статус|хаана|юу болсон|явц).*(хүсэлт|амралт|урьдчилгаа|тодорхойлолт)|хүсэлт.*(төлөв|статус|хаана|юу болсон|явц)/, // mn
].map(ml)

const MY_COURSES = [
  /курстарым|менің (курс|оқу)|маған.*(курс|оқу|сабақ)|тағайындал.*(курс|оқу)|(курс|оқу).*тағайындал|қандай курс|не (өтуім|оқуым) керек|(өтуім|оқуым) керек/, // kk
  /\bmy (courses?|trainings?|learning|lessons?)\b|\b(courses?|training|lessons?)\b.*\b(assigned to me|do i have|i have to|i need to|should i)\b|\bassigned (courses|training)\b|\bwhat (courses|training)\b.*\b(i|me)\b|\bwhat (do|should) i (need to |have to )?(complete|take|study|finish)\b/, // en
  /курстарым|менин (курс|окуу)|(^|[^а-я])мага([^а-я]|$).*(курс|окуу|сабак)|дайындал.*(курс|окуу)|(курс|окуу).*дайындал|кандай курс|(өтүшүм|окушум) керек/, // ky
  /kurslarim|mening (kurs|oʻqish|taʼlim)|menga.*(kurs|oʻqish|dars)|tayinlan.*(kurs|oʻqish)|(kurs|oʻqish).*tayinlan|qaysi kurs|qanday kurs|(oʻtishim|oʻqishim) kerak/, // uz
  /курсҳои ман|курсҳоям|омӯзиши ман|ба ман.*(курс|омӯзиш|дарс)|таъин.*(курс|омӯзиш)|(курс|омӯзиш).*таъин|кадом курс|бояд (гузарам|хонам|омӯзам)/, // tg
  /миний (сургалт|курс|хичээл)|надад.*(сургалт|курс|хичээл)|оноогдсон (сургалт|курс)|(сургалт|курс).*(оноосон|оноогдсон)|ямар (сургалт|курс).*(би |надад|миний)|би ямар (сургалт|курс)/, // mn
].map(ml)

const MY_MANAGER = [
  /(менің|(^|[^а-я])кім([^а-я]|$)).*(басшы|бастық)|(басшы|бастық).*(^|[^а-я])кім([^а-я]|$)/, // kk
  /\bwho\b.*\b(manager|boss|supervisor|team lead|team leader)\b|\bmy (direct |line |immediate )?(manager|boss|supervisor)\s*\??$/, // en
  /(менин|(^|[^а-я])ким([^а-я]|$)).*(жетекчи|начальниг)|(жетекчи|начальниг).*(^|[^а-я])ким([^а-я]|$)/, // ky
  /(mening|kim).*(rahbar|boshliq|boshligʻ|menejer)|(rahbar|boshliq|boshligʻ|menejer).*kim/, // uz
  /(роҳбар|сардор|мудир)(и ман|ам|и бевоситаи ман)|(роҳбар|сардор|мудир).*кист|кист.*(роҳбар|сардор|мудир)/, // tg
  /(миний|хэн).*(удирдагч|дарга)|(удирдагч|дарга).*хэн/, // mn
].map(ml)
const SALARY = ml(/(жалақ|айлық|айлык|маяна|эмгек акы|зарплат|zarplata|maosh|oylik|ish haqi|маош|музд|цалин|\b(salary|salaries|pay|wages?|earn\w*)\b)/)

const MY_HIRE = [
  /(қашан|күн).*жұмысқа (қабылдан|орналас|кірдім|кірген|алын)|жұмысқа (қабылданған|кірген|орналасқан) күн|еңбек өтіл|менің өтіл|қанша (уақыт|жыл).*жұмыс (істеп|істедім|жасап)/, // kk
  /\bwhen (was i|did i get) hired\b|\bwhen did i (join|start working|start at)\b|\bmy (hire|hiring|employment|start) date\b|\b(hire|hiring|employment) date\b|\bdate of (hire|hiring|employment|joining)\b|\bhow long have i (been )?(work|employ)|\bmy (seniority|tenure|length of service)\b|\byears of service\b/, // en
  /(качан|күн).*ишке (кабыл алын|орношт|кирдим|кирген|алын)|ишке (кабыл алынган|кирген|орношкон) күн|эмгек стаж|менин стаж|канча (убакыт|жыл).*иште/, // ky
  /(qachon|sana).*ishga (qabul|kir)|ishga (qabul qilingan|kirgan) (sana|kun)|ish staj|mening staj|qancha (vaqt|yil).*ishla/, // uz
  /((^|[^а-я])кай|сана).*ба кор (қабул|даромад|омад)|санаи қабул|собиқаи кор|стажи (корӣ|ман)|чанд (сол|вақт).*кор мекунам/, // tg
  /(хэзээ|огноо).*ажилд орсон|ажилд орсон (огноо|өдөр)|миний (ажилласан|ажлын) (жил|хугацаа|стаж)|миний стаж|хэдэн жил ажилла/, // mn
].map(ml)

/* ---------- Задачи, проверка, праздники, новости ---------- */

// Вопрос про курсы отдаём разделу обучения, даже если в нём есть «дедлайн» или «что сделать»
const COURSE_WORD = ml(/курс|обучени|тест|оқу|окуу|kurs|omuzish|омӯзиш|сургалт|\b(course|courses|training|lesson|quiz)\b/)

const MY_TASKS_RU = /(мои|моих|мне|у меня|мой).*(задач|задани|поручени|дедлайн)|(какие|что за|сколько|покажи|список|ближайш|будущ|предстоящ|следующ)[а-я ]*(задач|задани|дедлайн|поручени)|дедлайн|что (мне )?(нужно|надо|осталось|важно) (сделать|доделать|успеть|закрыть)|что (горит|просрочено|срочно)|(задач|задани)[а-я]* на (сегодня|завтра|неделю|эт|следующ)|что у меня (сегодня|завтра|на (этой|следующей) неделе|на неделе)|план на (день|сегодня|завтра|неделю)|с чего (мне )?начать/
const MY_TASKS = [
  /тапсырма(лар)?(ым|ыңыз|ың)|менің тапсырма|қандай тапсырма|(не|нені) (істеуім|жасауым) керек|дедлайн|мерзімі (жақын|өткен) тапсырма/, // kk
  /\bmy (tasks?|to-?dos?|assignments?|deadlines?)\b|\bwhat (do|should) i (need to |have to )?do\b|\b(tasks?|deadlines?|to-?dos?)\b.*\b(today|tomorrow|this week|next week|due|upcoming|overdue|pending|open)\b|\bwhat is (due|overdue|urgent)\b|\bupcoming (tasks?|deadlines?)\b|\bwhere (do|should) i start\b|\bplan for (today|the day|tomorrow|the week)\b|\bhow many (open )?(tasks|to-?dos)\b|\b(tasks|to-?dos) (do i have|i have|for me)\b/, // en
  /тапшырма(лар)?(ым|ыңыз)|менин тапшырма|кандай тапшырма|эмне (кылышым|жасашым) керек|дедлайн/, // ky
  /vazifa(lar)?im|topshiriq(lar)?im|mening (vazifa|topshiriq)|qanday (vazifa|topshiriq)|nima qilishim kerak|dedlayn/, // uz
  /вазифа(ҳо)?(и ман|ям)|кадом вазифа|чӣ кор (кунам|бояд кунам)|дедлайн/, // tg
  /миний даалгавар|даалгавр(ууд)? (маань|минь)|ямар даалгавар|юу хийх (ёстой|хэрэгтэй)|дедлайн/, // mn
].map(ml)

const TO_REVIEW_RU = /(на проверк|жд(е|у)т (моей )?проверки|что (мне )?(нужно |надо )?проверить|кто сдал|сданн[а-я]* (отчет|результат|задач))/
const TO_REVIEW = [
  /тексеруге (жіберілген|тапсырылған)|тексеруді күтіп|не(ні)? тексеру(ім)? керек/, // kk
  /\b(to review|awaiting (my )?review|pending (my )?review|needs? my review|waiting for (my )?(review|approval of (the )?results?)|what should i (check|review)|who (has )?submitted)\b/, // en
  /текшерүүгө (жиберилген|тапшырылган)|текшерүүнү күтүп|эмнени текшерүү(м)? керек/, // ky
  /tekshiruvga (yuborilgan|topshirilgan)|tekshiruvni kut|nimani tekshirishim kerak/, // uz
  /барои санҷиш (фиристода|супурда)|чиро (санҷам|тафтиш кунам)/, // tg
  /шалгалтад (илгээсэн|тушаасан)|юуг шалгах (ёстой|хэрэгтэй)/, // mn
].map(ml)

const VACATION_WORD = ml(/отпуск|демалыс|өргүү|tatil|рухсат|\b(vacation|leave)\b/)
const HOLIDAY_RU = /(ближайш|следующ|когда|какой|какие|скоро|сколько)[а-я ]*(праздник|праздничн|выходн[а-я]* (дн|ден))|праздник[а-я]* (в|на) (этом|следующем|ближайш)|производственн[а-я]* календар|когда (отдыхаем|не работаем)/
const HOLIDAY = [
  /(жақын|келесі|қашан|қандай).*мереке|мереке(лік)? күн(дер)?|өндірістік күнтізбе/, // kk
  /\b(next|upcoming|nearest|coming) (public |bank |national )?holidays?\b|\bwhen is the next (public |national )?holiday\b|\bpublic holidays?\b|\bproduction calendar\b/, // en
  /(жакынкы|кийинки|качан|кандай).*майрам|майрам күн|өндүрүштүк календар/, // ky
  /(yaqin|keyingi|qachon|qanday).*bayram|bayram kun|ishlab chiqarish kalendar/, // uz
  /(наздиктарин|ояндаи|кай) (ид|ҷашн)|рӯзи ид|рӯзҳои ид|ҷашни (наздик|оянда)/, // tg
  /(ойрын|дараагийн|хэзээ).*баяр|баярын өдөр|үндэсний баяр/, // mn
].map(ml)

const NEWS_RU = /((какие|есть ли|покажи)[а-я ]*(объявлени|новост)|что нового|какие новости|последние (новости|объявлени)|новые объявлени|свежие (новости|объявлени)|что (происходит|случилось) в компании|важные объявлени)/
const NEWS = [
  /не жаңалық|қандай жаңалық|соңғы (жаңалық|хабарландыру)|жаңа хабарландыру/, // kk
  /\bwhat is new\b|\bwhats new\b|\b(latest|recent|new|fresh|important) (news|announcements?|updates)\b|\bany (news|announcements?)\b|\bcompany news\b/, // en
  /эмне жаңылык|кандай жаңылык|акыркы (жаңылык|кулактандыру)|жаңы кулактандыру/, // ky
  /qanday yangilik|nima yangilik|soʻnggi (yangilik|eʼlon)|yangi eʼlon/, // uz
  /чӣ нав|кадом хабар|охирин (хабар|эълон)|эълонҳои нав|хабарҳои нав/, // tg
  /юу шинэ|ямар мэдээ|сүүлийн (мэдээ|зарлал)|шинэ зарлал/, // mn
].map(ml)

// «Как сдать задачу», «что делать, если…»: это вопросы о правилах, на них отвечает база знаний
const HOWTO_RU = /^(как(?![а-я])|каким образом|можно ли|что делать|почему|зачем|кто должен|куда)|(^|[^а-я])(если|когда нужно)([^а-я]|$)/
const HOWTO = ml(/^(қалай|неге|не істеу керек)|^(how(?! many| much)|why|can i|could i|may i|is it possible)\b|\bwhat (should|do) i do (if|when|in case)\b|\bif\b|^(кантип|эмне үчүн)|^(qanday qilib|nega|nima uchun)|^(чӣ тавр|чаро)|^(яаж|яагаад)/)

export type PersonalIntent = 'balance' | 'requests' | 'courses' | 'manager' | 'hire' | 'tasks' | 'review' | 'holiday' | 'news'

export function personalIntent(x: Query): PersonalIntent | null {
  if (BALANCE_RU.test(x.q) || some(BALANCE, x.f)) return 'balance'
  if (MY_REQUESTS_RU.test(x.q) || some(MY_REQUESTS, x.f)) return 'requests'
  if (TO_REVIEW_RU.test(x.q) || some(TO_REVIEW, x.f)) return 'review'
  if (!COURSE_WORD.test(x.f) && !HOWTO_RU.test(x.q) && !HOWTO.test(x.f) && (MY_TASKS_RU.test(x.q) || some(MY_TASKS, x.f))) return 'tasks'
  if (MY_COURSES_RU.test(x.q) || some(MY_COURSES, x.f)) return 'courses'
  if ((MY_MANAGER_RU.test(x.q) && !SALARY_RU.test(x.q)) || (some(MY_MANAGER, x.f) && !SALARY.test(x.f))) return 'manager'
  if (MY_HIRE_RU.test(x.q) || some(MY_HIRE, x.f)) return 'hire'
  if (!VACATION_WORD.test(x.f) && (HOLIDAY_RU.test(x.q) || some(HOLIDAY, x.f))) return 'holiday'
  if (NEWS_RU.test(x.q) || some(NEWS, x.f)) return 'news'
  return null
}

/* ---------- Аналитика по роли ---------- */

const ON_VACATION_RU = /(кто|сколько).*(в отпуске|отдыха|отсутству|уходит в отпуск|будет в отпуске|уйдет в отпуск)/
const VACATION_OVER_RU = /(у кого|кто|сколько).*(больше|более|свыше|накопил|накоплен|много).*(дн|отпуск)/
const COURSE_DEPT_RU = /(как[а-я]* (отдел|подразделени)|в как[а-я]* (отдел|подразделени)|по отделам|по подразделениям).*(хуже|лучше|меньше|больше|отста|прош|проход|обучен|курс|охран)|(охран|безопасност|курс|обучени).*(отдел|подразделени)/
const REQUESTS_IN_WORK_RU = /(сколько|какие|покажи).*(заявк|заявок).*(в работе|висят|висит|на согласовании|ждут|завис|не оформлен)/
const OVERDUE_RU = /(просроч).*(курс|обучени)|(кто).*(не прош[её]л|не сдал).*(курс|обучени|тест)/
const HEADCOUNT_RU = /(сколько|численность).*(сотрудник|человек|штат)|численност/
const NEWCOMERS_RU = /(новичк|новые сотрудник|кто (недавно )?(пришел|вышел на работу)|принят[а-я]* недавно)/
const DEPARTMENT_RU = /отдел|подразделени/

const ON_VACATION = [
  /(кім|қанша|неше).*демалыс(та|қа шығ|қа кет)|демалыс(та|тағы).*(кім|қанша|неше)/, // kk
  /\b(who|how many|anyone|anybody)\b.*\b(on (vacation|leave|holiday|pto)|off work|away|absent|out of (the )?office|taking (a |their )?(vacation|leave|time off|days off)|go(es|ing)? on (vacation|leave|holiday))\b/, // en
  /((^|[^а-я])(ким|кимдер|нече)([^а-я]|$)|канча).*(өргүүдө|өргүүгө (чык|кет)|отпускта|эс алууда)|(өргүүдө|отпускта|эс алууда).*((^|[^а-я])(ким|кимдер|нече)([^а-я]|$)|канча)/, // ky
  /(kim|nechta|necha|qancha).*taʼtil(da|ga chiq|ga ket)|taʼtil(da|dagi).*(kim|nechta|necha|qancha)/, // uz
  /(^|[^а-я])(кӣ|киҳо|чанд нафар|чанд корманд|чанд кас)[^а-я].*(дар|ба) рухсат|(дар|ба) рухсат.*(кист|киҳо|киянд)/, // tg
  /(хэн|хэдэн хүн|хэдэн ажилтан).*(амралттай|амралтанд|амралтад|амралтаа ав|амрах|амарч)|(амралттай|амралтанд|амралтад).*(хэн|хэдэн)/, // mn
].map(ml)

const VACATION_OVER = [
  /^(?=.*(кім|қанша адам|неше адам))(?=.*(артық|(^|[^а-я])көп([^а-я]|$)|жиналған|жиналып|асатын|асады|астам))(?=.*((^|[^а-я])күн|демалыс))/, // kk
  /\b(who|which (employees|people|staff)|anyone|anybody)\b.*\b(more than|over|above|exceed\w*|accumulated|a lot of|lots of|too many|unused)\b(?! the\b).*\b(days?|vacation|leave|holiday)/, // en
  /^(?=.*((^|[^а-я])ким|канча адам|нече адам))(?=.*(ашык|(^|[^а-я])көп([^а-я]|$)|топтолгон|чогулган|ашкан))(?=.*((^|[^а-я])күн|өргүү|эс алуу))/, // ky
  /^(?=.*(kim|nechta xodim|nechta odam))(?=.*(ortiq|koʻp|yigʻilgan|oshgan|ziyod))(?=.*(kun|taʼtil))/, // uz
  /^(?=.*((^|[^а-я])(кӣ|киҳо)([^а-я]|$)|кадом корманд|чанд нафар))(?=.*(зиёда|беш аз|бештар|ҷамъ))(?=.*((^|[^а-я])рӯз|рухсат))/, // tg
  /^(?=.*(хэн|хэдэн хүн|хэдэн ажилтан))(?=.*(дээш|илүү|(^|[^а-я])их([^а-я]|$)|олон|хуримтлагд))(?=.*(хоног|өдөр|амралт))/, // mn
].map(ml)

const COURSE_DEPT = [
  /(қай|қандай) бөлім.*(нашар|жақсы|артта|кешік|өтп|өтуде|өтіп|оқу|курс|қорғау|қауіпсіз|аяқта)|бөлім(ше)?лер(де|ге)? бойынша|(еңбекті қорғау|еңбек қауіпсіздігі|қауіпсіздік|оқу|курс).*бөлімше/, // kk
  /\b(which|what) (departments?|units?|divisions?)\b.*\b(worse|worst|better|best|behind|lag\w*|complet\w*|pass\w*|training|course|safety|learning|least|most)\b|\b(by|per|across) (departments?|divisions?)\b|\b(safety|training|course|learning)\b.*\b(departments?|divisions?)\b/, // en
  /(кайсы|кандай) бөлүм.*(начар|жакшы|артта|кечик|өтпө|өтүп|окуу|окутуу|курс|коргоо|коопсуз|бүтүр)|бөлүмдөр(дө)? боюнча|(эмгекти коргоо|эмгек коопсуздугу|коопсуздук).*бөлүм/, // ky
  /(qaysi|qanday) boʻlim.*(yomon|yaxshi|orqada|kechik|oʻt|kurs|oʻqish|taʼlim|muhofaza|xavfsiz|tugat)|boʻlimlar(da)? boʻyicha|(mehnat muhofaza|xavfsizlik).*boʻlim/, // uz
  /(кадом|чӣ) шуъба.*(бад|беҳ|ақиб|таъхир|гузар|курс|омӯзиш|ҳифз|бехатар|тамом)|аз рӯи шуъбаҳо|шуъбаҳо.*(бад|беҳ|ақиб)|(ҳифзи меҳнат|бехатар|амният|курс|омӯзиш).*шуъба/, // tg
  /(аль|ямар) хэлт(эс|с).*(муу|сайн|хоцор|дуусга|давж|сургалт|курс|хамгаалал|аюулгүй|бага|их)|хэлтс(ээр|үүдээр)|хэлтэс тус бүр|(хөдөлмөр хамгаалал|аюулгүй|сургалт|курс).*хэлт(эс|с)/, // mn
].map(ml)

const REQUESTS_IN_WORK = [
  /^(?=.*(қанша|неше|қандай|көрсет))(?=.*өтінім)(?=.*(келісуде|күтіп|тұр([^а-я]|$)|тұрған|ілініп|рәсімделмеген|қаралуда|жұмыста|шешілмеген))/, // kk
  /^(?=.*\b(how many|which|show|list|count|number of)\b)(?=.*\b(requests?|applications?)\b)(?=.*\b(pending|in progress|awaiting|waiting|stuck|in work|under review|unprocessed|not (yet )?processed|hanging|open)\b)/, // en
  /^(?=.*(канча|нече|кайсы|кандай|көрсөт))(?=.*арыз)(?=.*(макулдашууда|күтүп|турат|илинип|тариздел(бе|ге)н|каралууда|иштелип|чечилбеген))/, // ky
  /^(?=.*(nechta|necha|qancha|qaysi|koʻrsat))(?=.*ariza)(?=.*(kelishuvda|kutmoqda|kutayotgan|kutib|turibdi|osilib|ishda|jarayonda|rasmiylashtirilmagan|koʻrib chiqil|hal qilinmagan))/, // uz
  /^(?=.*(чанд|кадом|нишон))(?=.*дархост)(?=.*(дар мувофиқа|мунтазир|интизор|дар ҷараён|дар кор|овезон|баррасӣ|ҳал нашуда|ба расмият дароварда нашуда))/, // tg
  /^(?=.*(хэдэн|хэд|ямар|аль|харуул))(?=.*хүсэлт)(?=.*(хянагдаж|хүлээж|хүлээгдэж|шийдвэрлэгдээгүй|шийдэгдээгүй|гацсан|ажил дээр|явцад|боловсруулагдаж|зөвшөөрөгдөөгүй))/, // mn
].map(ml)

const OVERDUE = [
  /(мерзімі өткен|мерзімі өтіп кеткен|кешіктірілген).*(курс|оқу|сабақ)|(курс|оқу).*(мерзімі өткен|мерзімі өтті|кешіктір)|^(?=.*кім)(?=.*(курс|оқу|тест|сабақ))(?=.*(өтпеді|өтпеген|аяқтамады|аяқтамаған|бітірмеді|бітірмеген|тапсырмады|тапсырмаған|үлгермеді|үлгермеген))/, // kk
  /\boverdue\b.*\b(courses?|training|learning|lessons?)\b|\b(courses?|training|learning)\b.*\boverdue\b|^(?=.*\bwho\b)(?=.*\b(courses?|training|learning|tests?|lessons?)\b)(?=.*\b(didnt|did not|hasnt|has not|havent|have not|not (yet )?(complete|completed|finished|passed)|missed|failed|behind|late)\b)/, // en
  /(мөөнөтү өткөн|кечиктирилген).*(курс|окуу|окутуу|сабак)|(курс|окуу|окутуу).*(мөөнөтү өткөн|мөөнөтү өттү|кечиктир)|^(?=.*ким)(?=.*(курс|окуу|окутуу|тест|сабак))(?=.*(өткөн жок|өтпөгөн|өтпөдү|бүтүргөн жок|бүтүрбөгөн|бүтпөгөн|тапшырган жок|тапшырбаган|үлгүргөн жок|үлгүрбөгөн))/, // ky
  /(muddati oʻtgan|kechiktirilgan).*(kurs|oʻqish|taʼlim|trening|dars)|(kurs|oʻqish|taʼlim).*(muddati oʻtgan|muddati oʻtdi|kechik)|^(?=.*kim)(?=.*(kurs|oʻqish|taʼlim|test|trening|dars))(?=.*(oʻtmadi|oʻtmagan|tugatmadi|tugatmagan|topshirmadi|topshirmagan|yakunlamadi|yakunlamagan|ulgurmadi|ulgurmagan))/, // uz
  /(мӯҳлаташ гузашта|мӯҳлати гузашта|бо таъхир).*(курс|омӯзиш|дарс)|(курс|омӯзиш).*(мӯҳлаташ гузашт|мӯҳлаташон гузашт|таъхир)|^(?=.*(^|[^а-я])(кӣ|киҳо)([^а-я]|$))(?=.*(курс|омӯзиш|тест|дарс))(?=.*(нагузашт|тамом накард|хатм накард|анҷом надод|насупурд|ба охир нарасонд|улгур накард))/, // tg
  /хугацаа(нь)? хэтэрсэн.*(сургалт|курс|хичээл)|(сургалт|курс).*хугацаа(нь)? хэтэрсэн|^(?=.*хэн)(?=.*(сургалт|курс|шалгалт|хичээл))(?=.*(дуусгаагүй|давж чадаагүй|тэнцээгүй|хоцорсон|хийгээгүй|гүйцээгээгүй|амжаагүй|өгөөгүй))/, // mn
].map(ml)

const HEADCOUNT = [
  /(қанша|неше) (қызметкер|адам|жұмысшы)|қызметкерлер(дің)? саны|штат саны|адам саны|жұмысшылар саны/, // kk
  /\bhead ?count\b|\bnumber of (employees|staff|people|workers)\b|\bstaff (count|size|numbers?)\b|\bhow many (employees|people|staff|workers)\b|\bteam size\b/, // en
  /(канча|нече) (кызматкер|адам|киши|жумушчу)|кызматкерлер(дин)? саны|штат(тын)? саны|адам саны/, // ky
  /(nechta|necha|qancha) (xodim|kishi|odam|ishchi)|xodimlar(ning)? soni|shtat soni|odamlar soni/, // uz
  /чанд (корманд|нафар|кас|коргар)|шумораи (кормандон|штат|коргарон|афрод)/, // tg
  /хэдэн (ажилтан|хүн|ажилчин)|ажилтн(ы|уудын) тоо|орон тоо|хүний тоо|ажилчдын тоо/, // mn
].map(ml)

const NEWCOMERS = [
  /жаңа (қызметкер|келген)|жақында (жұмысқа )?(келген|қабылдан|орналас|кірген)|кім жақында|жақында кім|жаңадан (келген|қабылдан)/, // kk
  /\bnewcomers?\b|\bnew (employees|hires|staff|joiners|starters|team members|colleagues)\b|\brecently (hired|joined)\b|\bwho (has |have )?(recently )?(joined|started)\b|\bjoined recently\b/, // en
  /жаңы (кызматкер|келген)|жакында.*(ишке|кабыл алын|келди|келген)|ким жакында|жаңыдан (келген|кабыл алын)/, // ky
  /yangi (xodim|kelgan|ishchi)|yaqinda.*(ishga|qabul qilin|kelgan|kirgan|kirdi)|kim yaqinda/, // uz
  /кормандони нав|корманди нав|навомада|ба наздикӣ.*(ба кор|қабул)|(^|[^а-я])кӣ.*ба наздикӣ/, // tg
  /шинэ ажилт|шинээр (орсон|ажилд)|саяхан.*ажилд орсон|саяхан орсон|шинэ хүмүүс/, // mn
].map(ml)

const DEPARTMENT = ml(/бөлімше|бөлім|\b(departments?|divisions?)\b|бөлүм|boʻlim|шуъба|хэлт(эс|с)/)

export type AnalyticsIntent = { onVacation: boolean; vacationOver: boolean; courseDept: boolean; requestsInWork: boolean; overdue: boolean; headcount: boolean; newcomers: boolean }

export function analyticsIntent(x: Query): AnalyticsIntent | null {
  const r: AnalyticsIntent = {
    onVacation: ON_VACATION_RU.test(x.q) || some(ON_VACATION, x.f),
    vacationOver: VACATION_OVER_RU.test(x.q) || some(VACATION_OVER, x.f),
    courseDept: COURSE_DEPT_RU.test(x.q) || some(COURSE_DEPT, x.f),
    requestsInWork: REQUESTS_IN_WORK_RU.test(x.q) || some(REQUESTS_IN_WORK, x.f),
    overdue: OVERDUE_RU.test(x.q) || some(OVERDUE, x.f),
    headcount: HEADCOUNT_RU.test(x.q) || some(HEADCOUNT, x.f),
    newcomers: NEWCOMERS_RU.test(x.q) || some(NEWCOMERS, x.f),
  }
  return Object.values(r).some(Boolean) ? r : null
}

/** Вопрос упоминает отдел (для «просроченного обучения по отделам») */
export const mentionsDepartment = (x: Query) => DEPARTMENT_RU.test(x.q) || DEPARTMENT.test(x.f)

/** Порог дней для «у кого больше N дней отпуска»: число перед словом «дней» на любом языке */
const THRESHOLD = ml(/(\d+)\s*-?\s*(?:[a-z]+ )?(days?|күн|kun|рӯз|хоног|өдөр|өдр|аас|ээс|оос|өөс)/)
export function vacationThreshold(x: Query): number | null {
  const m = x.q.match(/(\d+)\s*(дн|ден)/) ?? x.f.match(THRESHOLD)
  return m ? Number(m[1]) : null
}

/** Код курса для сравнения отделов: safety, infosec, welcome или пусто (все обязательные) */
export function courseCode(x: Query): 'safety' | 'infosec' | 'welcome' | '' {
  if (/охран|безопасност на склад|техник[а-я]* безопасн|(^|[^а-я])от(?![а-я])/.test(x.q) || SAFETY.test(x.f)) return 'safety'
  if (/информацион|(^|[^а-я])иб(?![а-я])|персональн/.test(x.q) || INFOSEC.test(x.f)) return 'infosec'
  if (/адаптац|добро пожаловать|онбординг/.test(x.q) || WELCOME.test(x.f)) return 'welcome'
  return ''
}
const SAFETY = ml(/еңбекті қорғау|еңбек қауіпсіздігі|қауіпсіздік техникасы|\b(occupational safety|health and safety|safety|ohs|osh|labou?r protection)\b|эмгекти коргоо|эмгек коопсуздугу|коопсуздук техникасы|mehnat muhofaza|mehnat xavfsizlig|texnika xavfsizlig|ҳифзи меҳнат|бехатарии меҳнат|техникаи бехатарӣ|хөдөлмөр хамгаал|хөдөлмөрийн аюулгүй|аюулгүй ажиллагаа/)
const INFOSEC = ml(/ақпараттық қауіпсіздік|дербес деректер|жеке деректер|\b(information security|infosec|cyber ?security|data protection|personal data|it security)\b|маалыматтык коопсуздук|жеке маалымат|персоналдык маалымат|axborot xavfsizlig|shaxsiy maʼlumot|kiberxavfsizlik|амнияти иттилоотӣ|маълумоти шахсӣ|мэдээллийн аюулгүй|хувийн мэдээлэл|кибер аюулгүй/)
const WELCOME = ml(/бейімделу|қош келдіңіз|онбординг|адаптация|\b(onboarding|welcome|adaptation|induction|orientation)\b|ыңгайлашуу|кош келиңиз|moslashuv|adaptatsiya|xush kelibsiz|мутобиқшавӣ|хуш омадед|адаптатсия|дасан зохицох|тавтай морил/)

/* ---------- Период из фразы ---------- */

export type PeriodKind = 'nextWeek' | 'thisWeek' | 'tomorrow' | 'nextMonth' | 'thisMonth' | 'today' | 'default'

const PERIODS: [Exclude<PeriodKind, 'default'>, RegExp, RegExp][] = [
  ['nextWeek', /следующ[а-я]* недел|след\.? недел|на неделе после/, ml(/келесі апта|\bnext week\b|(кийинки|келерки|келээрки) (жума|апта)|\b(kelasi|keyingi) hafta|ҳафтаи (оянда|дигар|навбатӣ)|(ирэх|дараа|дараагийн) долоо хоног/)],
  ['thisWeek', /эт[а-я]* недел|текущ[а-я]* недел/, ml(/(осы|бұл|ағымдағы) апта|\b(this|current) week\b|(ушул|бул|ушу) (жума|апта)|\b(shu|bu|joriy) hafta|(ҳамин|ин) ҳафта|ҳафтаи ҷорӣ|энэ долоо хоног/)],
  ['tomorrow', /завтра/, ml(/ертең|\btomorrow\b|эртең|\bertaga\b|фардо|маргааш/)],
  ['nextMonth', /следующ[а-я]* месяц/, ml(/келесі ай(да|ы)?([^а-я]|$)|\bnext month\b|(кийинки|келерки) ай(да|ы)?([^а-я]|$)|\b(kelasi|keyingi) oy(da|i)?\b|моҳи (оянда|дигар|навбатӣ)|(ирэх|дараа|дараагийн) сар/)],
  ['thisMonth', /эт[а-я]* месяц/, ml(/(осы|бұл|ағымдағы) ай(да|ы)?([^а-я]|$)|\b(this|current) month\b|(ушул|бул) ай(да|ы)?([^а-я]|$)|\b(shu|bu|joriy) oy(da|i)?\b|(ҳамин|ин) моҳ|моҳи ҷорӣ|энэ сар/)],
  ['today', /сегодня|сейчас|в данный момент/, ml(/бүгін|қазір|\b(today|now|right now|currently|at the moment)\b|бүгүн|азыр([^а-я]|$)|учурда|\b(bugun|hozir|hozirda|ayni paytda)\b|имрӯз|ҳозир|айни замон|(^|[^а-я])ҳоло([^а-я]|$)|өнөөдөр|(^|[^а-я])одоо/)],
]

export function periodKind(x: Query): PeriodKind {
  return PERIODS.find(([, ru, other]) => ru.test(x.q) || other.test(x.f))?.[0] ?? 'default'
}

/* ---------- База знаний: тема вопроса → русский запрос ---------- */

/**
 * Статьи базы знаний на русском, а поиск в базе русский полнотекстовый. Вопрос на другом языке
 * сопоставляется с темой, и поиск идёт по русскому запросу этой темы. Для тем из подсказок в чате
 * запрос совпадает с русской подсказкой, поэтому ответ тот же, что и на русском.
 * Порядок важен: сначала узкие темы, затем общие.
 */
// Отпуск, но не ежегодный: больничный, декрет, уход за ребёнком, отпуск без сохранения зарплаты
const NOT_ANNUAL = /\b(sick|maternity|paternity|parental|unpaid|study|childcare|child care)\b|бала күтім|декрет|бала багуу|bola parvarish|dekret|нигоҳубини кӯдак|хүүхэд асра|жирэмсн|уходу за ребенк/
const NOT_IN_ADVANCE = /\bin advance\b|\badvance notice\b/

const TOPICS: { query: string; re: RegExp[]; not?: RegExp }[] = [
  {
    query: 'Положена ли компенсация за проезд на ночную смену?',
    re: [
      /түнгі.*(жол|көлік|такси|өтемақы|өтеу|өтел)|(жол ақы|жол жүру|көлік|такси|өтемақы).*түнгі/, // kk
      /\bnight\b.*\b(travel|transport\w*|taxi|commut\w*|compensat\w*|reimburs\w*|fare|ride)\b|\b(travel|transport\w*|taxi|commut\w*|compensat\w*|reimburs\w*|fare)\b.*\bnight\b/, // en
      /түнкү.*(жол|унаа|транспорт|такси|компенсац|кире)|(жол кире|жол акы|унаа|транспорт|такси|компенсац).*түнкү/, // ky
      /tungi.*(yoʻl|transport|taksi|kompensats|qoplan)|(yoʻl haqi|yoʻl xarajat|transport|taksi|kompensats).*tungi/, // uz
      /шабона.*(роҳ|нақлиёт|такси|ҷуброн|кироя)|(роҳкиро|кироя|нақлиёт|такси|ҷуброн).*шаб/, // tg
      /шөнийн.*(унаа|тээвэр|такси|нөхөн|зардал)|(унаа|тээвр|такси|нөхөн олговор).*шөнө/, // mn
    ],
  },
  {
    query: 'Как оформить отпуск в 1С:ЗУП?',
    re: [/(1с|1c|зуп|zup).*(демалыс|vacation|leave|holiday|өргүү|отпуск|taʼtil|рухсат|амралт)|(демалыс|vacation|leave|holiday|өргүү|отпуск|taʼtil|рухсат|амралт).*(1с|1c|зуп|zup)/],
    not: NOT_ANNUAL,
  },
  {
    query: 'Ведомость выплаты аванса',
    re: [/(аванс|avans|пешпардохт|урьдчилгаа).*(ведомост|vedomost|тізім|тизме|qaydnoma|феҳрист|хүснэгт)|\badvances?\b.*\b(statement|payroll|ledger|register)\b|\b(statement|payroll|ledger|register)\b.*\badvances?\b/],
  },
  {
    query: 'Условия получения аванса',
    re: [
      /аванс.*(қанша|мөлшер|шек|шарт|пайыз|%|неше рет|лимит)|(қанша|мөлшер|шарт).*аванс/, // kk
      /\badvance\b.*\b(how much|limit|maximum|max|amount|conditions?|eligib\w*|percent|how often|how many times|rules)\b|\b(how much|limit|maximum|amount|conditions?|eligib\w*|how often)\b.*\badvance\b/, // en
      /аванс.*(канча|өлчөм|чек|шарт|пайыз|лимит|нече жолу)|(канча|шарт).*аванс/, // ky
      /avans.*(qancha|miqdor|chegara|shart|foiz|limit|necha marta)|(qancha|shart|miqdor).*avans/, // uz
      /(пешпардохт|аванс).*(чанд|андоза|ҳадд|шарт|фоиз|лимит)|(чанд|шарт|андоза).*(пешпардохт|аванс)/, // tg
      /урьдчилгаа.*(хэд|хэмжээ|хязгаар|нөхцөл|хувь|хэдэн удаа)|(хэд|хэмжээ|нөхцөл).*урьдчилгаа/, // mn
    ],
    not: NOT_IN_ADVANCE,
  },
  {
    query: 'Удержание аванса',
    re: [/аванс.*(ұстал|ұстап|шегер|кармал|кармап)|\badvance\b.*\b(deduct\w*|withh[eo]ld\w*|repa\w*|paid back|pay back)\b|avans.*(ushlab|ushlan|chegiril|qaytar)|(пешпардохт|аванс).*(нигоҳ|тарҳ|баргардон|ситон)|урьдчилгаа.*(суутга|хасагд|хасах|буцаа)/],
    not: NOT_IN_ADVANCE,
  },
  {
    query: 'Как оплачивается больничный?',
    re: [
      /(больничн|ауру|ауырып|еңбекке уақытша жарамсыз|бюллетень).*(төлен|ақы|төлем|қанша)|(төлен|ақы|төлем).*(больничн|ауру|ауырып)/, // kk
      /\bsick\b.*\b(pay|paid|payment|benefit|compensat\w*|allowance)\b|\b(pay|paid|payment|benefit)\b.*\bsick\b/, // en
      /(больничн|оору|ооруп|бейтап).*(төлөн|акы|төлөм|канча)|(төлөн|акы).*(больничн|оору)/, // ky
      /(kasal|betob|bemor|bolnichniy).*(toʻlan|haq|toʻlov|qancha|nafaqa)|(toʻlan|nafaqa).*(kasal|betob)/, // uz
      /(бемор|касал|варақаи беморӣ|бюллетен|больничн).*(пардохт|подош|музд|чанд|кумакпулӣ)|(пардохт|кумакпулӣ).*(бемор|касал)/, // tg
      /(өвч|эмнэлгийн хуудас|өвдсөн).*(төлө|олговор|тэтгэмж|цалин|хэд)|(тэтгэмж|олговор).*(өвч|эмнэлг)/, // mn
    ],
  },
  {
    query: 'Когда перечисляют отпускные?',
    re: [/демалыс (ақы|төлем|ақша)|демалыстық (ақы|төлем)|\b(vacation|holiday|leave) (pay|money|payment|allowance)\b|өргүү (акы|акча|төлөм)|өргүүлүк (акы|акча)|taʼtil (puli|haqi|toʻlov)|(пули|ҳаққи|пардохти) рухсат|амралтын (мөнгө|цалин|олговор|төлбөр)/],
    not: NOT_ANNUAL,
  },
  {
    query: 'За сколько дней подать заявку на отпуск?',
    re: [/\bhow (far|long|early|many days) (in advance|before|ahead)\b.*\b(vacation|leave|holidays?)\b|\b(vacation|leave|holidays?)\b.*\bin advance\b/],
    not: NOT_ANNUAL,
  },
  { query: 'Как оформить аванс?', re: [/аванс|avans|пешпардохт|урьдчилгаа|\b(salary |pay |cash )?advances?\b/], not: NOT_IN_ADVANCE },
  {
    query: 'Где взять расчётный листок?',
    re: [/есеп(тік)? пара|жалақы пара|\b(payslip|pay slip|pay stub|paystub|salary slip|payroll slip|wage slip)s?\b|эсеп(тик)? барак|айлык барак|hisob(-kitob)? varaq|ish haqi varaq|oylik varaq|варақаи (ҳисоб|музд|маош)|цалингийн (хуудас|тооцоо)|тооцооны хуудас/],
  },
  {
    query: 'Когда выплачивают зарплату?',
    re: [
      /(жалақ|айлық|еңбекақ|зарплат).*(қашан|қай күн|нешесі|күні|түсе|төлен|беріл)|(қашан|қай күн).*(жалақ|айлық|еңбекақ|зарплат)/, // kk
      /\b(salary|salaries|wages?|pay|paycheck|paid)\b.*\b(when|date|day|days|schedule|twice)\b|\bwhen\b.*\b(salary|salaries|wages?|paid|paycheck)\b|\bpay ?day\b/, // en
      /(айлык|айлыг|маяна|эмгек акы|зарплат).*(качан|кайсы күн|күнү|түш|төлөн|бери)|(качан|кайсы күн).*(айлык|маяна|эмгек акы|зарплат)/, // ky
      /(maosh|ish haqi|oylik|zarplata).*(qachon|qaysi kun|sana|tushadi|toʻlan|beril)|(qachon|qaysi kun).*(maosh|ish haqi|oylik|zarplata)/, // uz
      /(маош|музд|зарплат).*((^|[^а-я])кай([^а-я]|$)|кадом рӯз|сана|пардохт|дода|меояд)|((^|[^а-я])кай([^а-я]|$)|кадом рӯз).*(маош|музд|зарплат)/, // tg
      /цалин.*(хэзээ|хэдний|өдөр|буу|олго|тавигд)|(хэзээ|хэдний).*цалин/, // mn
    ],
  },
  {
    query: 'Как перенести отпуск?',
    re: [
      /демалыс.*(ауыстыр|кейінге қалдыр|кейін шегер|басқа күн|басқа уақыт|бөліп|бөлуге|бөлікке|болдырма|өзгерт|ұзарт)|(ауыстыр|кейінге қалдыр|шегер).*демалыс/, // kk
      /\b(reschedul\w*|move|moving|postpon\w*|transfer\w*|shift|chang\w*|carry (over|forward)|split\w*|divid\w*|cancel\w*|extend\w*)\b.*\b(vacation|holidays?|annual leave|leave|time off)\b|\b(vacation|holidays?|annual leave|time off)\b.*\b(reschedul\w*|postpon\w*|transfer\w*|carr\w*|split\w*|cancel\w*|another date|other dates|new dates|different dates)\b/, // en
      /(өргүү|эс алуу|отпуск).*(жылдыр|котор|кийинкиге калтыр|башка күн|башка убакыт|бөлүп|бөлүүгө|жокко чыгар|өзгөрт|узарт)|(жылдыр|котор|кийинкиге калтыр).*(өргүү|отпуск)/, // ky
      /taʼtil.*(koʻchir|oʻtkaz|kechiktir|boshqa sana|boshqa kun|boʻlib olish|qismlarga|bekor|oʻzgartir|uzaytir)|(koʻchir|oʻtkaz|kechiktir).*taʼtil/, // uz
      /рухсат.*(гузарон|интиқол|мавқуф|таъхир|вақти дигар|рӯзи дигар|тақсим|бекор|тағйир|дароз)|(гузарон|интиқол|мавқуф|таъхир).*рухсат/, // tg
      /амралт.*(хойшлуул|шилжүүл|өөрчл|хуваа|цуцл|сунга|өөр өдөр)|(хойшлуул|шилжүүл).*амралт/, // mn
    ],
    not: NOT_ANNUAL,
  },
  {
    query: 'Пиковые периоды и график отпусков',
    re: [/шарықтау|қарбалас|(^|[^а-я])пик|11\.11|\bpeak\b|\bblack friday\b|\b(high|busy|sales) season\b|кызуу мезгил|\bpik davr|qizgʻin (davr|mavsum)|авҷ|давраи серкор|оргил|ачаалал ихтэй/],
  },
  {
    query: 'Какой срок согласования заявок?',
    re: [
      /(келісу|мақұлда).*(мерзім|уақыт|қанша күн|sla)|(мерзім|қанша уақыт|қанша күн).*(келісі|келісу|мақұлда)/, // kk
      /\bapprov\w*\b.*\b(deadline|how long|time|timeframe|time frame|sla|days|period|duration|take)\b|\b(how long|deadline|sla|timeframe)\b.*\bapprov\w*/, // en
      /макулдаш.*(мөөнөт|убакыт|канча күн|sla)|(мөөнөт|канча убакыт|канча күн).*макулдаш/, // ky
      /(kelish|tasdiq).*(muddat|vaqt|necha kun|qancha vaqt|sla)|(muddat|necha kun|qancha vaqt).*(kelish|tasdiq)/, // uz
      /(мувофиқа|тасдиқ).*(мӯҳлат|вақт|чанд рӯз|муддат|sla)|(мӯҳлат|чанд рӯз|муддат).*(мувофиқа|тасдиқ)/, // tg
      /зөвшөөр.*(хугацаа|хэд хоног|хэдэн хоног|хэр удаан|sla)|(хугацаа|хэдэн хоног|хэр удаан).*зөвшөөр/, // mn
    ],
  },
  {
    query: 'На что смотреть при согласовании заявки?',
    re: [
      /(келіс|мақұлда).*(не қара|нені тексер|неге назар|бас тарт)|бас тарту себеб/, // kk
      /\b(what|how)\b.*\b(check|look at|consider|review)\b.*\bapprov\w*|\bhow (to|do i|should i) (reject|decline|refuse)\b.*\b(requests?|vacations?|applications?)\b/, // en
      /макулдаш.*(эмнени текшер|эмнеге көңүл|четке как)/, // ky
      /(kelish|tasdiq).*(nimani tekshir|nimaga eʼtibor|rad et)/, // uz
      /(мувофиқа|тасдиқ).*(чиро санҷ|ба чӣ диққат|рад кун)/, // tg
      /зөвшөөр.*(юуг шалга|юунд анхаар|татгалз)/, // mn
    ],
  },
  {
    query: 'Как пересдать тест?',
    re: [
      /тест.*(қайта|қайталап|балл|ұпай|өтпе)|(қайта тапсыр|балл|ұпай).*тест|сертификат/, // kk; «сертификат» и в ky, tg
      /\b(test|quiz|exam)\b.*\b(retake|re-take|again|fail\w*|pass\w*|score|attempts?|resit)\b|\b(retake|re-take|resit|passing score|pass mark|attempts?)\b.*\b(test|quiz|exam)\b|\b(course|training) certificate\b|\bcertificate\b.*\b(course|training|academy|test)\b/, // en
      /тест.*(кайра|балл|упай|өтпө|тапшыр)/, // ky
      /test.*(qayta|ball|oʻtolmad|topshir|urinish)|sertifikat/, // uz
      /(тест|санҷиш).*(дубора|такрор|бал|холл|нагузашт|супор)/, // tg
      /шалгалт.*(дахин|оноо|тэнцээгүй|өгөх|оролдлого)|гэрчилгээ/, // mn
    ],
  },
  {
    query: 'Курсы и тесты в Jana Academy',
    re: [
      /academy|академи/,
      /(міндетті|қандай) курс|курстар.*(қалай|қайда)|оқу.*(қалай|қайда)/, // kk
      /\b(mandatory|required|compulsory) (courses?|training)\b|\b(courses?|training|learning)\b.*\b(how|where|work)\b|\bhow (does|do) (the )?(training|courses|learning)\b/, // en
      /(милдеттүү|кандай) курс|курстар.*(кантип|кайда)|окуу.*(кантип|кайда)/, // ky
      /(majburiy|qanday) kurs|kurslar.*(qanday|qayerda)|(oʻqish|taʼlim).*(qanday|qayerda)/, // uz
      /(ҳатмӣ|кадом) курс|курсҳо.*(чӣ тавр|куҷо)|омӯзиш.*(чӣ тавр|куҷо)/, // tg
      /(заавал|ямар) (сургалт|курс)|сургалт.*(хэрхэн|хаана|яаж)/, // mn
    ],
  },
  {
    query: 'Как заказать справку с места работы?',
    re: [/анықтама|справк|\b(certificates?|reference letter|employment letter|letter of employment|proof of employment|employment verification)\b|маалымкат|маалым кат|maʼlumotnoma|spravka|маълумотнома|тодорхойлолт|лавлагаа/],
  },
  {
    query: 'Что делать, если я заболел?',
    re: [/ауырып қал|ауырсам|ауырдым|ауырып жатырмын|науқас|больничн|бюллетень|еңбекке уақытша жарамсыз|\b(sick|illness|unwell|medical leave|doctors note|fell ill|feel ill|i am ill|im ill|got ill|get ill)\b|ооруп калсам|оорусам|ооруп калдым|ооруп жатам|бейтап|kasal (boʻlsam|boʻlib qolsam|boʻldim|boʻlib qoldim)|kasallik varaqa|betob|bemor|bolnichniy|kasalman|бемор (шав|ҳастам|шуд)|касал (шав|шуд)|варақаи беморӣ|бюллетен|өвдвөл|өвдсөн|өвчтэй|өвчний чөлөө|эмнэлгийн хуудас|өвдөөд|өвчилсөн/],
  },
  {
    query: 'Как оформить командировку?',
    re: [/іссапар|командировк|қызметтік сапар|\bbusiness (trip|travel)s?\b|\bwork trips?\b|\bper diem\b|\btravel (expenses?|allowance|report)\b|\bexpense report\b|иш сапар|ишсапар|кызматтык сапар|xizmat safar|komandirovka|сафари (хизматӣ|корӣ)|томилолт|томилогдо/],
  },
  {
    query: 'Сколько длится испытательный срок?',
    re: [/сынақ (мерзім|кезең)|\bprobation\w*|\btrial period\b|сыноо (мөөнөт|мезгил)|sinov (muddat|davr)|(мӯҳлати|давраи) (озмоиш|санҷиш)|туршилтын (хугацаа|үе|ажил)/],
  },
  {
    query: 'Что делать, если опаздываю или не могу выйти на смену?',
    re: [/кешіг|кешіксем|(ауысымға|жұмысқа) шыға алмас|\b(late|lateness|running late|absent|absence)\b|\b(cant|cannot) (come|make it|work)\b|\bmiss (a |my )?shift\b|кечиг|кечиксем|(сменага|ишке) чыга алба|kechik|(smenaga|ishga) chiqa olma|дер (мемонам|монам|мондам|омадам)|ба (баст|кор) (баромада|омада) наметавон|хоцор|(ээлжиндээ гарч|ажилдаа ирж) чадахгүй/],
  },
  {
    query: 'Какой режим работы?',
    re: [/жұмыс (режим|кесте|уақыт|тәртіб)|ауысым кестесі|түскі (ас|үзіліс)|үзіліс|\b(work(ing)? (schedule|hours|time)|office hours|opening hours|business hours|shift (schedule|pattern|hours)|lunch( break)?|break time)\b|иш (режим|график|убакт|тартиб)|смена график|түшкү (тамак|тыныгуу)|тыныгуу|ish (vaqt|rejim|jadval|tartib)|smena jadval|tushlik|tanaffus|(реҷаи|ҷадвали|соатҳои|вақти) кор|танаффус|хӯроки нисфирӯзӣ|ажлын (цаг|хуваарь|горим)|цагийн хуваарь|ээлжийн хуваарь|завсарлага|үдийн (хоол|цай)/],
  },
  {
    query: 'За сколько дней предупреждать об увольнении?',
    re: [/жұмыстан (шығ|кет|босат)|өз еркім|\b(resign\w*|quit|quits|quitting|notice period|leave (the company|my job)|leaving the company|terminat\w* (my|the) (contract|employment)|hand in (my )?notice|give notice|last working day|clearance sheet)\b|жумуштан (кет|бошо|чыг)|иштен (кет|бошо|чыг)|өз каалоо|өз эрким|ishdan (ket|boʻsha|chiq)|oʻz xohish|isteʼfo|аз кор (рафт|озод|равам)|бо хоҳиши худ|истеъфо|ажлаас (гар|чөлөөлө)|өөрийн хүсэлтээр/],
  },
  {
    query: 'Какие льготы и ДМС есть у сотрудников?',
    re: [/жеңілдік|медициналық сақтандыру|сақтандыру|(^|[^а-я])(емс|дмс)([^а-я]|$)|әлеуметтік пакет|соцпакет|\b(benefits?|perks?|health insurance|medical insurance|insurance|social package|dms)\b|жеңилдик|медициналык камсыздандыруу|камсыздандыруу|социалдык пакет|imtiyoz|tibbiy sugʻurta|sugʻurta|ijtimoiy paket|имтиёз|суғурта|бастаи иҷтимоӣ|хөнгөлөлт|эрүүл мэндийн даатгал|даатгал|нийгмийн багц/],
  },
  {
    query: 'Как изменить персональные данные?',
    re: [
      /(деректер|тегі|тегім|фамилия|мекенжай|телефон|аты-жөн).*(өзгерт|ауыстыр|жаңарт|түзет)|(өзгерт|ауыстыр|жаңарт).*(деректер|тег|фамилия|мекенжай|телефон)/, // kk
      /\b(change|update|correct|edit|fix)\b.*\b(name|surname|last name|address|phone|personal (data|details|information)|my (data|details|information)|passport|email)\b|\bpersonal data\b|\bdata change\b/, // en
      /(маалымат|фамилия|дарек|телефон|аты-жөн).*(өзгөрт|алмаштыр|жаңырт|оңдо)|(өзгөрт|алмаштыр).*(маалымат|фамилия|дарек|телефон)/, // ky
      /(maʼlumot|familiya|manzil|telefon|ism).*(oʻzgartir|almashtir|yangila|tuzat)|(oʻzgartir|almashtir|yangila).*(maʼlumot|familiya|manzil|telefon)/, // uz
      /(маълумот|насаб|фамилия|суроға|телефон).*(иваз|тағйир|ислоҳ)|(иваз|тағйир).*(маълумот|насаб|суроға|телефон)/, // tg
      /(мэдээлэл|овог|хаяг|утас).*(өөрчл|солих|шинэчл|засах)|(өөрчл|солих|шинэчл).*(мэдээлэл|овог|хаяг|утас)/, // mn
    ],
  },
  {
    query: 'Ценности Jana Post',
    re: [/құндылық|\b(values|core values|code of (conduct|ethics)|ethics|corporate culture)\b|баалуулук|qadriyat|axloq kodeksi|арзишҳо|кодекси ахлоқ|үнэт зүйл|ёс зүй/],
  },
  { query: 'Откуда AI Jana берёт ответы?', re: [/\b(ai jana|jana ai)\b/] },
  {
    query: 'Как оформить отпуск?',
    re: [
      /демалыс.*(рәсімде|алу|аламын|алсам|алғым|шығу|шығам|өтінім)|(рәсімде|өтінім).*демалыс/, // kk
      /\b(apply|request|book|take|get|submit|plan|arrange|process)\w*\b.*\b(vacation|holidays?|annual leave|time off|days off|pto|leave)\b|\b(vacation|annual leave|time off)\b.*\b(apply|request|book|submit|process)\w*/, // en
      /(өргүү|эс алуу|отпуск).*(тариздө|алуу|алам|алсам|чыгу|чыгам|арыз)|(тариздө|арыз).*(өргүү|отпуск)/, // ky
      /taʼtil.*(rasmiylashtir|olish|olaman|olsam|chiqish|chiqaman|ariza)|(rasmiylashtir|ariza).*taʼtil/, // uz
      /рухсат.*(ба расмият|гирифтан|гирам|бигирам|рафтан|равам|дархост)|(ба расмият|дархост).*рухсат/, // tg
      /амралт.*(бүрдүүл|авах|авъя|авмаар|гарах|хүсэлт)|(бүрдүүл|хүсэлт).*амралт/, // mn
    ],
    not: NOT_ANNUAL,
  },
].map((tp) => ({ ...tp, re: tp.re.map(ml), not: tp.not && ml(tp.not) }))

/** Русский поисковый запрос для темы вопроса на другом языке */
export function kbTopicQuery(x: Query): string | null {
  return TOPICS.find((tp) => some(tp.re, x.f) && !tp.not?.test(x.f))?.query ?? null
}

export const hasCyrillic = (s: string) => /[а-яёәғқңөұүһіҷӣӯҳ]/i.test(s)

/* ---------- Русские значения из базы ---------- */

/** Кнопка под статьёй базы знаний: по русскому названию статьи */
export function articleAction(title: string): 'vacation' | 'advance' | 'certificate' | null {
  return /отпуск/i.test(title) ? 'vacation' : /аванс/i.test(title) ? 'advance' : /справк/i.test(title) ? 'certificate' : null
}

/** request_type_label() отдаёт тип заявки по-русски: возвращаем код типа */
const REQUEST_TYPES: Record<string, 'vacation' | 'advance' | 'certificate' | 'data_change'> = {
  Отпуск: 'vacation',
  Аванс: 'advance',
  'Справка с места работы': 'certificate',
  'Изменение данных': 'data_change',
}
export const requestTypeCode = (label: string) => REQUEST_TYPES[label] ?? null

/** Подпись базы для сотрудников без подразделения */
export const NO_DEPARTMENT = 'Без подразделения'

/** Статья «Как работает AI Jana»: источник приветствия и отказа. Заголовок раздела нужен для ссылки на статью */
export const aiJanaSource = (section: 'about' | 'limits') => ({
  kind: 'kb' as const,
  title: 'Как работает AI Jana',
  slug: 'ai-jana',
  heading: section === 'about' ? 'Откуда AI Jana берёт ответы' : 'Чего AI Jana не делает',
  source_title: 'Политика использования AI Jana (демо)',
})
