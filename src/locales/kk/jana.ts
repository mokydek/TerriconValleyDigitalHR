import type ru from '../ru/jana'

export default {
  'jana.greeting':
    'Сәлеметсіз бе! Мен AI Jana, JanaMen HR көмекшісімін. Демалысты, авансты немесе анықтаманы қалай рәсімдеуге болатынын, қанша күн демалысыңыз бар екенін және өтінімдеріңіздің күйін, қандай тапсырмаларыңыз бен мерзімдеріңіз бар екенін, Jana Academy-де нені өту керегін, ең жақын мереке қашан екенін және компанияда қандай жаңалықтар бар екенін айтып беремін. Тек HR білім қоры мен сіздің деректеріңіз бойынша жауап беремін және әрқашан дереккөзін көрсетемін.',
  'jana.greetingLead': 'Командаңыз бойынша сандарды да көрсете аламын: кім демалыста, кімде демалыс жиналып қалды, оқу қалай жүріп жатыр.',
  'jana.refusedOthers':
    'Мен басқа қызметкерлердің дербес деректерін ашпаймын: жалақысын, ЖСН-ін, мекенжайын, денсаулығы туралы мәліметтерді. Бұл құпиялылық саясатымен және JanaMen қол жеткізу құқықтарымен қорғалған.',
  'jana.noAnswer': 'Білім қорында бұл сұраққа сенімді жауап жоқ. Мен болжам жасамаймын, бірақ сұрақты HR-ге жібере аламын, жауап сізге хабарламада келеді.',
  'jana.llmRefused': 'Бұл сұраққа жауап бере алмаймын. Егер ол жұмысқа қатысты болса, оны HR-ге қойыңыз: төмендегі батырма.',
  'jana.kbInRussian': 'Білім қорының мақалалары әзірге орыс тілінде, сондықтан төмендегі жауап орыс тілінде.',

  'jana.src.profile': 'JanaMen жеке кабинеті · 1С:ЗУП деректері',
  'jana.src.analytics': 'JanaMen аналитикасы, {date} жағдайы бойынша',

  'jana.scope.company': 'компания бойынша',
  'jana.scope.team': 'командаңыз бойынша',
  'jana.period.nextWeek': 'келесі аптада',
  'jana.period.thisWeek': 'осы аптада',
  'jana.period.tomorrow': 'ертең',
  'jana.period.nextMonth': 'келесі айда',
  'jana.period.thisMonth': 'осы айда',
  'jana.period.today': 'бүгін',
  'jana.period.default': 'алдағы 7 күнде',

  'jana.analyticsDenied': 'Қызметкерлер бойынша жиынтық деректер басшы мен HR-ге қолжетімді. Өз деректеріңіз туралы айта аламын, мысалы, демалыс қалдығы немесе өтінімдердің күйі туралы.',
  'jana.vacationOver': '{scope} демалыс қалдығы {threshold} күннен асатындар: {n} адам. Шаршап-шалдығу қаупін азайту үшін оларға демалысты алдын ала жоспарлаған дұрыс.',
  'jana.vacationOverNone': '{scope} демалыс қалдығы {threshold} күннен асатын қызметкерлер жоқ.',
  'jana.courseNone': 'Бұл курс бойынша әзірге тағайындау жоқ.',
  'jana.courseWorst': '«{department}» {what} бәрінен нашар өтуде: {assigned} адамнан {completed} ({pct}%){overdue}. Төменде {scope} барлық бөлімшелер көрсетілген.',
  'jana.courseWhat': '«{course}» курсын',
  'jana.courseWhatAll': 'міндетті оқуды',
  'jana.courseOverdue': ', мерзімі өткені {n}',
  'jana.onVacation': '{period} ({range}) {scope} демалыста {n} адам.',
  'jana.onVacationNone': '{period} {scope} ешкім демалыста емес.',
  'jana.overdue': '{scope} мерзімі өткен оқу: {n}.',
  'jana.overdueNone': '{scope} мерзімі өткен оқу жоқ.',
  'jana.inWork': '{scope} жұмыста {n} өтінім бар. Ең ескісі {days} күннен бері күтіп тұр.',
  'jana.inWorkNone': '{scope} жұмыста өтінім жоқ.',
  'jana.newcomers': '{scope} соңғы 90 күндегі жаңа қызметкерлер: {n}.',
  'jana.newcomersNone': '{scope} соңғы 90 күнде жаңа қызметкерлер жоқ.',
  'jana.headcount': '{scope} қызметкерлер саны: {n} адам.',

  'jana.balance':
    'Сізде {year} жылға **{available} күн** демалыс бар: берілетіні {entitled}{carryover}, рәсімделгені {used}, келісуде {reserved}. Мереке күндері демалысқа есептелмейді.',
  'jana.balanceCarryover': ' + өткен жылдан ауыстырылғаны {n}',
  'jana.noRequests': 'Сізде әзірге өтінім жоқ.',
  'jana.myRequests': 'Соңғы өтінімдеріңіз:',
  'jana.noCourses': 'Тағайындалған курстар жоқ. Jana Academy каталогына кіріп көріңіз.',
  'jana.myCourses': 'Jana Academy-дегі оқуыңыз:',
  'jana.manager': 'Тікелей басшыңыз: **{name}**. Демалыс пен аванс өтінімдеріңізді алдымен сол кісі келіседі.',
  'jana.managerNone': '1С:ЗУП-та тікелей басшыңыз көрсетілмеген, сондықтан өтінімдер бірден HR-ге түседі.',
  'jana.hired': 'Сіз {company} компаниясына {date} «{position}» лауазымына қабылдандыңыз.',

  'jana.col.balance': 'Қалдық, күн',
  'jana.col.due': 'Мерзімі',
  'jana.col.progress': 'Барысы',
  'jana.col.stage': 'Кезең',
  'jana.col.waitHours': 'Күтуде, сағ',

  'jana.act.attention': '«Назар аймағын» ашу',
  'jana.act.learning': 'Оқу аналитикасы',
  'jana.act.approvals': 'Өтінімдерді ашу',
  'jana.act.academy': 'Jana Academy ашу',
} satisfies Record<keyof typeof ru, string>
