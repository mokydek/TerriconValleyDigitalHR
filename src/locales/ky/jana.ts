import type ru from '../ru/jana'

export default {
  'jana.greeting':
    'Саламатсызбы! Мен AI Jana, JanaMen HR жардамчысымын. Өргүүнү, авансты же маалымкатты кантип тариздөөнү, канча күн өргүүңүз бар экенин жана арыздарыңыздын абалын, Jana Academyде эмнени өтүш керектигин айтып берем. Бир гана HR билим базасы боюнча жооп берем жана ар дайым булагын көрсөтөм.',
  'jana.greetingLead': 'Командаңыз боюнча сандарды да көрсөтө алам: ким өргүүдө, кимде өргүү топтолуп калды, окутуу кандай жүрүп жатат.',
  'jana.refusedOthers':
    'Мен башка кызматкерлердин жеке маалыматтарын ачыкка чыгарбайм: айлыгын, ИИНин, дарегин, ден соолугу тууралуу маалыматты. Бул купуялуулук саясаты жана JanaMen кирүү укуктары менен корголгон.',
  'jana.noAnswer': 'Билим базасында бул суроого ишенимдүү жооп жок. Мен божомолдобойм, бирок суроону HRга жөнөтө алам, жооп сизге билдирмелерге келет.',
  'jana.llmRefused': 'Бул суроого жооп бере албайм. Эгер ал ишке тиешелүү болсо, аны HRга бериңиз: төмөндөгү баскыч.',
  'jana.kbInRussian': 'Билим базасынын макалалары азырынча орус тилинде, ошондуктан төмөндөгү жооп орус тилинде.',

  'jana.src.profile': 'JanaMen жеке кабинети · 1С:ЗУП маалыматтары',
  'jana.src.analytics': 'JanaMen аналитикасы, {date} карата',

  'jana.scope.company': 'компания боюнча',
  'jana.scope.team': 'командаңыз боюнча',
  'jana.period.nextWeek': 'кийинки жумада',
  'jana.period.thisWeek': 'ушул жумада',
  'jana.period.tomorrow': 'эртең',
  'jana.period.nextMonth': 'кийинки айда',
  'jana.period.thisMonth': 'ушул айда',
  'jana.period.today': 'бүгүн',
  'jana.period.default': 'жакынкы 7 күндө',

  'jana.analyticsDenied': 'Кызматкерлер боюнча жыйынтык маалыматтар жетекчиге жана HRга жеткиликтүү. Өзүңүздүн маалыматтарыңыз тууралуу айтып бере алам, мисалы, өргүү калдыгы же арыздардын абалы тууралуу.',
  'jana.vacationOver': '{scope} өргүү калдыгы {threshold} күндөн ашкандар: {n} адам. Чарчап-чаалыгуу коркунучун азайтуу үчүн аларга өргүүнү алдын ала пландаган жакшы.',
  'jana.vacationOverNone': '{scope} өргүү калдыгы {threshold} күндөн ашкан кызматкерлер жок.',
  'jana.courseNone': 'Бул курс боюнча азырынча дайындоолор жок.',
  'jana.courseWorst': '«{department}» {what} баарынан начар өтүп жатат: {assigned} адамдан {completed} ({pct}%){overdue}. Төмөндө {scope} бардык бөлүмдөр көрсөтүлгөн.',
  'jana.courseWhat': '«{course}» курсун',
  'jana.courseWhatAll': 'милдеттүү окутууну',
  'jana.courseOverdue': ', мөөнөтү өткөнү {n}',
  'jana.onVacation': '{period} ({range}) {scope} өргүүдө {n} адам.',
  'jana.onVacationNone': '{period} {scope} эч ким өргүүдө эмес.',
  'jana.overdue': '{scope} мөөнөтү өткөн окутуу: {n}.',
  'jana.overdueNone': '{scope} мөөнөтү өткөн окутуу жок. 👏',
  'jana.inWork': '{scope} иштелип жаткан {n} арыз бар. Эң эскиси {days} күндөн бери күтүп жатат.',
  'jana.inWorkNone': '{scope} иштелип жаткан арыз жок.',
  'jana.newcomers': '{scope} акыркы 90 күндөгү жаңы кызматкерлер: {n}.',
  'jana.newcomersNone': '{scope} акыркы 90 күндө жаңы кызматкерлер жок.',
  'jana.headcount': '{scope} кызматкерлердин саны: {n} адам.',

  'jana.balance':
    'Сизде {year}-жылга **{available} күн** өргүү бар: берилгени {entitled}{carryover}, таризделгени {used}, макулдашууда {reserved}. Майрам күндөрү өргүүгө эсептелбейт.',
  'jana.balanceCarryover': ' + өткөн жылдан которулганы {n}',
  'jana.noRequests': 'Сизде азырынча арыз жок.',
  'jana.myRequests': 'Акыркы арыздарыңыз:',
  'jana.noCourses': 'Дайындалган курстар жок. Jana Academy каталогун карап көрүңүз.',
  'jana.myCourses': 'Jana Academyдеги окууңуз:',
  'jana.manager': 'Түз жетекчиңиз: **{name}**. Өргүү жана аванс боюнча арыздарыңызды биринчи ушул киши макулдашат.',
  'jana.managerNone': '1С:ЗУПта түз жетекчиңиз көрсөтүлгөн эмес, ошондуктан арыздар дароо HRга түшөт.',
  'jana.hired': 'Сиз {company} компаниясына {date} «{position}» кызматына кабыл алынгансыз.',

  'jana.col.balance': 'Калдык, күн',
  'jana.col.due': 'Мөөнөтү',
  'jana.col.progress': 'Жүрүшү',
  'jana.col.stage': 'Этап',
  'jana.col.waitHours': 'Күтүүдө, саат',

  'jana.act.attention': '«Көңүл буруу керек» бөлүмүн ачуу',
  'jana.act.learning': 'Окутуу аналитикасы',
  'jana.act.approvals': 'Арыздарды ачуу',
  'jana.act.academy': 'Jana Academyни ачуу',
} satisfies Record<keyof typeof ru, string>
