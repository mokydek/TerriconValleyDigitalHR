import type ru from '../ru/jana'

export default {
  'jana.greeting':
    'Hello! I’m AI Jana, the JanaMen HR assistant. I can tell you how to request a vacation, a salary advance or a certificate, how many vacation days you have and where your requests stand, and what to complete in Jana Academy. I answer only from the HR knowledge base and always show the source.',
  'jana.greetingLead': 'I can also show figures for your team: who’s on vacation, who has built up vacation days, and how training is going.',
  'jana.refusedOthers':
    'I don’t disclose other employees’ personal data: salary, IIN, address or health information. It’s protected by the privacy policy and JanaMen access rights.',
  'jana.noAnswer': 'The knowledge base has no reliable answer to this question. I won’t guess, but I can pass your question to HR, and you’ll get the answer in notifications.',
  'jana.llmRefused': 'I can’t answer this question. If it’s about work, ask HR with the button below.',
  'jana.kbInRussian': 'Knowledge base articles are in Russian for now, so the answer below is in Russian.',

  'jana.src.profile': 'JanaMen personal account · 1C:ZUP data',
  'jana.src.analytics': 'JanaMen analytics as of {date}',

  'jana.scope.company': 'across the company',
  'jana.scope.team': 'in your team',
  'jana.period.nextWeek': 'next week',
  'jana.period.thisWeek': 'this week',
  'jana.period.tomorrow': 'tomorrow',
  'jana.period.nextMonth': 'next month',
  'jana.period.thisMonth': 'this month',
  'jana.period.today': 'today',
  'jana.period.default': 'in the next 7 days',

  'jana.analyticsDenied': 'Summary data on employees is available to managers and HR. I can tell you about your own data, such as your vacation balance or the status of your requests.',
  'jana.vacationOver': 'Vacation balance over {threshold} days {scope}: {n} {n|person|people}. It’s best to plan their vacations in advance to reduce the risk of burnout.',
  'jana.vacationOverNone': 'No employees {scope} have more than {threshold} vacation days left.',
  'jana.courseNone': 'There are no assignments for this course yet.',
  'jana.courseWorst': '“{department}” is doing worst on {what}: {completed} of {assigned} ({pct}%){overdue}. All departments {scope} are listed below.',
  'jana.courseWhat': 'the “{course}” course',
  'jana.courseWhatAll': 'mandatory training',
  'jana.courseOverdue': ', {n} overdue',
  'jana.onVacation': '{period} ({range}), {n} {n|person is|people are} on vacation {scope}.',
  'jana.onVacationNone': '{period}, nobody {scope} is on vacation.',
  'jana.overdue': 'Overdue training {scope}: {n}.',
  'jana.overdueNone': 'No overdue training {scope}. 👏',
  'jana.inWork': '{n} {n|request is|requests are} in progress {scope}. The oldest has been waiting {days} {days|day|days}.',
  'jana.inWorkNone': 'No requests in progress {scope}.',
  'jana.newcomers': 'Newcomers in the last 90 days {scope}: {n}.',
  'jana.newcomersNone': 'No new employees {scope} in the last 90 days.',
  'jana.headcount': 'Headcount {scope}: {n}.',

  'jana.balance':
    'You have **{available} vacation days** available for {year}: {entitled} entitled{carryover}, {used} already taken, {reserved} pending approval. Public holidays don’t count toward vacation.',
  'jana.balanceCarryover': ' + {n} carried over from last year',
  'jana.noRequests': 'You don’t have any requests yet.',
  'jana.myRequests': 'Your recent requests:',
  'jana.noCourses': 'No courses are assigned to you. Take a look at the Jana Academy catalog.',
  'jana.myCourses': 'Your training in Jana Academy:',
  'jana.manager': 'Your direct manager is **{name}**. They are the first to approve your vacation and advance requests.',
  'jana.managerNone': 'No direct manager is set for you in 1C:ZUP, so your requests go straight to HR.',
  'jana.hired': 'You joined {company} on {date} as “{position}”.',

  'jana.col.balance': 'Balance, days',
  'jana.col.due': 'Due',
  'jana.col.progress': 'Progress',
  'jana.col.stage': 'Stage',
  'jana.col.waitHours': 'Waiting, h',

  'jana.act.attention': 'Open “Needs attention”',
  'jana.act.learning': 'Learning analytics',
  'jana.act.approvals': 'Open requests',
  'jana.act.academy': 'Open Jana Academy',
} satisfies Record<keyof typeof ru, string>
