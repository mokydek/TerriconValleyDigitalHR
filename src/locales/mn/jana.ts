import type ru from '../ru/jana'

export default {
  'jana.greeting':
    'Сайн байна уу! Би JanaMen-ий HR туслах AI Jana байна. Амралт, урьдчилгаа цалин, тодорхойлолтыг хэрхэн бүрдүүлэх, танд хэдэн өдрийн амралт байгаа, хүсэлтүүд тань ямар шатанд байгаа, танд ямар даалгавар, эцсийн хугацаа байгаа, Jana Academy-д юу үзэх ёстой, ойрын баяр хэзээ болох, компанид юу шинэ байгааг хэлж өгнө. Зөвхөн HR-ын мэдлэгийн сан болон таны мэдээлэлд тулгуурлан хариулж, эх сурвалжийг үргэлж харуулдаг.',
  'jana.greetingLead': 'Мөн танай багийн тоон мэдээллийг харуулж чадна: хэн амралттай байгаа, хэнд амралт хуримтлагдсан, сургалт хэрхэн явж байгаа.',
  'jana.refusedOthers':
    'Би бусад ажилтны хувийн мэдээллийг задруулдаггүй: цалин, регистрийн дугаар, хаяг, эрүүл мэндийн мэдээлэл. Энэ нь нууцлалын бодлого болон JanaMen-ий хандах эрхээр хамгаалагдсан.',
  'jana.noAnswer': 'Мэдлэгийн санд энэ асуултад найдвартай хариулт алга. Би таамаглахгүй, гэхдээ асуултыг HR-т дамжуулж болно, хариу танд мэдэгдлээр ирнэ.',
  'jana.llmRefused': 'Энэ асуултад хариулж чадахгүй. Хэрэв ажилтай холбоотой бол HR-аас асуугаарай: доорх товч.',
  'jana.kbInRussian': 'Мэдлэгийн сангийн нийтлэлүүд одоогоор орос хэл дээр байгаа тул доорх хариулт орос хэл дээр байна.',

  'jana.src.profile': 'JanaMen хувийн самбар · 1С:ЗУП-ын мэдээлэл',
  'jana.src.analytics': 'JanaMen-ий шинжилгээ, {date}-ны байдлаар',

  'jana.scope.company': 'компанийн хэмжээнд',
  'jana.scope.team': 'танай багт',
  'jana.period.nextWeek': 'ирэх долоо хоногт',
  'jana.period.thisWeek': 'энэ долоо хоногт',
  'jana.period.tomorrow': 'маргааш',
  'jana.period.nextMonth': 'ирэх сард',
  'jana.period.thisMonth': 'энэ сард',
  'jana.period.today': 'өнөөдөр',
  'jana.period.default': 'ойрын 7 хоногт',

  'jana.analyticsDenied': 'Ажилтнуудын нэгдсэн мэдээлэл удирдагч болон HR-т нээлттэй. Таны өөрийн мэдээллийн талаар хэлж чадна, жишээ нь амралтын үлдэгдэл эсвэл хүсэлтийн төлөв.',
  'jana.vacationOver': '{scope} амралтын үлдэгдэл {threshold} өдрөөс илүү: {n} хүн. Ядаргааны эрсдэлийг бууруулахын тулд тэдний амралтыг урьдчилан төлөвлөх нь зүйтэй.',
  'jana.vacationOverNone': '{scope} амралтын үлдэгдэл {threshold} өдрөөс илүү ажилтан алга.',
  'jana.courseNone': 'Энэ сургалтад одоогоор хуваарилалт алга.',
  'jana.courseWorst': '«{department}» {what} хамгийн муу давж байна: {assigned} хүнээс {completed} ({pct}%){overdue}. Доор {scope} бүх хэлтэс харагдана.',
  'jana.courseWhat': '«{course}» сургалтыг',
  'jana.courseWhatAll': 'заавал судлах сургалтыг',
  'jana.courseOverdue': ', хугацаа хэтэрсэн {n}',
  'jana.onVacation': '{period} ({range}) {scope} {n} хүн амралттай байна.',
  'jana.onVacationNone': '{period} {scope} хэн ч амралтгүй байна.',
  'jana.overdue': '{scope} хугацаа хэтэрсэн сургалт: {n}.',
  'jana.overdueNone': '{scope} хугацаа хэтэрсэн сургалт алга.',
  'jana.inWork': '{scope} {n} хүсэлт шийдвэрлэгдэж байна. Хамгийн хуучин нь {days} хоног хүлээж байна.',
  'jana.inWorkNone': '{scope} шийдвэрлэгдэж буй хүсэлт алга.',
  'jana.newcomers': '{scope} сүүлийн 90 хоногт орсон шинэ ажилтан: {n}.',
  'jana.newcomersNone': '{scope} сүүлийн 90 хоногт шинэ ажилтан алга.',
  'jana.headcount': '{scope} ажилтны тоо: {n} хүн.',

  'jana.balance':
    'Танд {year} онд **{available} өдрийн** амралт байна: олгогдох {entitled}{carryover}, бүрдүүлсэн {used}, хянагдаж буй {reserved}. Баярын өдрүүд амралтад тооцогдохгүй.',
  'jana.balanceCarryover': ' + өнгөрсөн оноос шилжүүлсэн {n}',
  'jana.noRequests': 'Танд одоогоор хүсэлт алга.',
  'jana.myRequests': 'Таны сүүлийн хүсэлтүүд:',
  'jana.noCourses': 'Оноогдсон сургалт алга. Jana Academy-ийн каталогийг үзээрэй.',
  'jana.myCourses': 'Таны Jana Academy дахь сургалт:',
  'jana.manager': 'Таны шууд удирдагч: **{name}**. Таны амралт, урьдчилгаа цалингийн хүсэлтийг тэр хамгийн түрүүнд зөвшөөрнө.',
  'jana.managerNone': '1С:ЗУП-д таны шууд удирдагч заагдаагүй тул хүсэлтүүд шууд HR-т очдог.',
  'jana.hired': 'Та {company}-д «{position}» албан тушаалд орсон. Ажилд орсон огноо: {date}.',

  'jana.col.balance': 'Үлдэгдэл, өдөр',
  'jana.col.due': 'Хугацаа',
  'jana.col.progress': 'Явц',
  'jana.col.stage': 'Шат',
  'jana.col.waitHours': 'Хүлээсэн, цаг',

  'jana.act.attention': '«Анхаарах зүйлс» нээх',
  'jana.act.learning': 'Сургалтын шинжилгээ',
  'jana.act.approvals': 'Хүсэлтүүдийг нээх',
  'jana.act.academy': 'Jana Academy нээх',
} satisfies Record<keyof typeof ru, string>
