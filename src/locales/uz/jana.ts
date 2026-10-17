import type ru from '../ru/jana'

export default {
  'jana.greeting':
    'Assalomu alaykum! Men AI Jana, JanaMen HR yordamchisiman. Taʼtil, avans yoki maʼlumotnomani qanday rasmiylashtirish, sizda necha kun taʼtil borligi va arizalaringiz holati, Jana Academyda nimalarni oʻtish kerakligi haqida aytib beraman. Faqat HR bilimlar bazasi asosida javob beraman va doim manbasini koʻrsataman.',
  'jana.greetingLead': 'Jamoangiz boʻyicha raqamlarni ham koʻrsata olaman: kim taʼtilda, kimda taʼtil kunlari yigʻilib qolgan, oʻqish qanday ketmoqda.',
  'jana.refusedOthers':
    'Men boshqa xodimlarning shaxsiy maʼlumotlarini oshkor qilmayman: maoshi, JShShIR, manzili, sogʻligʻi haqidagi maʼlumotlar. Bu maxfiylik siyosati va JanaMen kirish huquqlari bilan himoyalangan.',
  'jana.noAnswer': 'Bilimlar bazasida bu savolga ishonchli javob yoʻq. Taxmin qilmayman, lekin savolni HRga yuborishim mumkin, javob sizga bildirishnomalarda keladi.',
  'jana.llmRefused': 'Bu savolga javob bera olmayman. Agar u ishga oid boʻlsa, uni HRga bering: quyidagi tugma.',
  'jana.kbInRussian': 'Bilimlar bazasidagi maqolalar hozircha rus tilida, shuning uchun quyidagi javob rus tilida.',

  'jana.src.profile': 'JanaMen shaxsiy kabineti · 1C:ZUP maʼlumotlari',
  'jana.src.analytics': 'JanaMen tahlili, {date} holatiga',

  'jana.scope.company': 'kompaniya boʻyicha',
  'jana.scope.team': 'jamoangiz boʻyicha',
  'jana.period.nextWeek': 'kelasi haftada',
  'jana.period.thisWeek': 'shu haftada',
  'jana.period.tomorrow': 'ertaga',
  'jana.period.nextMonth': 'kelasi oyda',
  'jana.period.thisMonth': 'shu oyda',
  'jana.period.today': 'bugun',
  'jana.period.default': 'yaqin 7 kun ichida',

  'jana.analyticsDenied': 'Xodimlar boʻyicha umumlashgan maʼlumotlar rahbar va HR uchun ochiq. Oʻzingizning maʼlumotlaringiz haqida aytib bera olaman, masalan, taʼtil qoldigʻi yoki arizalar holati haqida.',
  'jana.vacationOver': '{scope} taʼtil qoldigʻi {threshold} kundan ortiq: {n} kishi. Charchash xavfini kamaytirish uchun ularga taʼtilni oldindan rejalashtirgan maʼqul.',
  'jana.vacationOverNone': '{scope} taʼtil qoldigʻi {threshold} kundan ortiq xodimlar yoʻq.',
  'jana.courseNone': 'Bu kurs boʻyicha hozircha tayinlovlar yoʻq.',
  'jana.courseWorst': '{what} eng yomon «{department}» oʻtmoqda: {assigned} kishidan {completed} ({pct}%){overdue}. Quyida {scope} barcha boʻlimlar koʻrsatilgan.',
  'jana.courseWhat': '«{course}» kursini',
  'jana.courseWhatAll': 'majburiy oʻqishni',
  'jana.courseOverdue': ', muddati oʻtgani {n}',
  'jana.onVacation': '{period} ({range}) {scope} taʼtilda {n} kishi.',
  'jana.onVacationNone': '{period} {scope} hech kim taʼtilda emas.',
  'jana.overdue': '{scope} muddati oʻtgan oʻqish: {n}.',
  'jana.overdueNone': '{scope} muddati oʻtgan oʻqish yoʻq. 👏',
  'jana.inWork': '{scope} ishda {n} ta ariza bor. Eng eskisi {days} kundan beri kutmoqda.',
  'jana.inWorkNone': '{scope} ishdagi arizalar yoʻq.',
  'jana.newcomers': '{scope} soʻnggi 90 kundagi yangi xodimlar: {n}.',
  'jana.newcomersNone': '{scope} soʻnggi 90 kunda yangi xodimlar yoʻq.',
  'jana.headcount': '{scope} xodimlar soni: {n} kishi.',

  'jana.balance':
    'Sizda {year}-yil uchun **{available} kun** taʼtil bor: belgilangani {entitled}{carryover}, rasmiylashtirilgani {used}, kelishuvda {reserved}. Bayram kunlari taʼtilga hisoblanmaydi.',
  'jana.balanceCarryover': ' + oʻtgan yildan koʻchirilgani {n}',
  'jana.noRequests': 'Sizda hozircha arizalar yoʻq.',
  'jana.myRequests': 'Soʻnggi arizalaringiz:',
  'jana.noCourses': 'Tayinlangan kurslar yoʻq. Jana Academy katalogiga koʻz tashlang.',
  'jana.myCourses': 'Jana Academydagi oʻqishingiz:',
  'jana.manager': 'Bevosita rahbaringiz: **{name}**. Taʼtil va avans boʻyicha arizalaringizni birinchi boʻlib u kelishadi.',
  'jana.managerNone': '1C:ZUPda bevosita rahbaringiz koʻrsatilmagan, shuning uchun arizalar darhol HRga tushadi.',
  'jana.hired': 'Siz {company} kompaniyasiga {date} «{position}» lavozimiga qabul qilingansiz.',

  'jana.col.balance': 'Qoldiq, kun',
  'jana.col.due': 'Muddat',
  'jana.col.progress': 'Jarayon',
  'jana.col.stage': 'Bosqich',
  'jana.col.waitHours': 'Kutmoqda, soat',

  'jana.act.attention': '«Eʼtibor talab» boʻlimini ochish',
  'jana.act.learning': 'Oʻqish tahlili',
  'jana.act.approvals': 'Arizalarni ochish',
  'jana.act.academy': 'Jana Academyni ochish',
} satisfies Record<keyof typeof ru, string>
