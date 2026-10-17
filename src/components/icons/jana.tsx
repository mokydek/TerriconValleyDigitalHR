import { forwardRef, type ReactNode, type SVGProps } from 'react'

/**
 * Иконки JanaMen в стиле Jańa Post: тонкий контур, скруглённые концы и углы, без заливки.
 * Сетка 24×24, линия 1.8. Свой рисунок, логотип Jańa Post не используется.
 * Пропсы совместимы с lucide-react (size, color, strokeWidth, className), поэтому иконки
 * подменяют lucide без правок на экранах: см. ./index.ts.
 */
export type JanaIconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  size?: number | string
  color?: string
  strokeWidth?: number | string
  absoluteStrokeWidth?: boolean
}

export const JANA_STROKE = 1.8

function icon(name: string, art: ReactNode) {
  const C = forwardRef<SVGSVGElement, JanaIconProps>(
    ({ size = 24, color = 'currentColor', strokeWidth = JANA_STROKE, absoluteStrokeWidth: _a, className, children, ...rest }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={rest['aria-label'] ? undefined : true}
        className={['jana-icon', className].filter(Boolean).join(' ')}
        {...rest}
      >
        {art}
        {children}
      </svg>
    ),
  )
  C.displayName = name
  return C
}

/** Главная */
export const HomeIcon = icon(
  'HomeIcon',
  <>
    <path d="m3.5 10 8.5-7 8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.5 20v-6h5v6" />
  </>,
)

/** Пульс компании */
export const PulseIcon = icon(
  'PulseIcon',
  <>
    <path d="M20.5 9c0-2.7-1.7-4.5-4.2-4.5-1.9 0-3.1.9-4.3 2.4-1.2-1.5-2.4-2.4-4.3-2.4C5.2 4.5 3.5 6.3 3.5 9c0 5 8.5 10.5 8.5 10.5s8.5-5.5 8.5-10.5Z" />
    <path d="M5.4 12h3l1.5-2.5 2.2 5 1.8-3h4.6" />
  </>,
)

/** Мои заявки: стопка бланков */
export const RequestsIcon = icon(
  'RequestsIcon',
  <>
    <path d="M8 2.5h8l3.5 3.5V16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2Z" />
    <path d="M15.5 2.5V6h4M9.5 9.5h6.5M9.5 13h4.5" />
    <path d="M3.5 7v12a2.5 2.5 0 0 0 2.5 2.5h9" />
  </>,
)

/** Jana Academy */
export const AcademyIcon = icon(
  'AcademyIcon',
  <>
    <path d="m2.5 9 9.5-5 9.5 5-9.5 5-9.5-5Z" />
    <path d="M6.5 11.3V16c3.3 2.9 7.7 2.9 11 0v-4.7" />
    <path d="M21.5 9v6" />
  </>,
)

/** AI Jana: облачко диалога с искрой внутри (у «Сообщений» вместо искры точки) */
export const AiJanaIcon = icon(
  'AiJanaIcon',
  <>
    <path d="M12 3.5c4.7 0 8.5 3.4 8.5 7.6s-3.8 7.6-8.5 7.6c-1 0-2-.1-2.9-.4L4.5 20.5l1.2-3.8C4.3 15.3 3.5 13.3 3.5 11.1c0-4.2 3.8-7.6 8.5-7.6Z" />
    <path d="M12 7c.45 2.25 1.15 2.95 3.4 3.4-2.25.45-2.95 1.15-3.4 3.4-.45-2.25-1.15-2.95-3.4-3.4 2.25-.45 2.95-1.15 3.4-3.4Z" />
  </>,
)

/** Задачи */
export const TasksIcon = icon(
  'TasksIcon',
  <>
    <rect x="4.5" y="4.5" width="15" height="17" rx="2.5" />
    <path d="M9 4.5V3.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 3.8v.7" />
    <path d="m8 11 1.5 1.5L12 10M14 11.5h2M8 16.5h8" />
  </>,
)

/** Объявления */
export const AnnouncementsIcon = icon(
  'AnnouncementsIcon',
  <>
    <path d="M4 9.5h3l8.5-4.5v14L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
    <path d="m7 14.5 1.5 5h2.5l-1-4.2" />
    <path d="M19 9.5a3.5 3.5 0 0 1 0 5" />
  </>,
)

/** База знаний */
export const KnowledgeIcon = icon(
  'KnowledgeIcon',
  <>
    <path d="M12 6.5C9.6 4.9 6.6 4.4 3 5v13.5c3.6-.6 6.6-.1 9 1.5 2.4-1.6 5.4-2.1 9-1.5V5c-3.6-.6-6.6-.1-9 1.5Z" />
    <path d="M12 6.5V20" />
  </>,
)

/** Курс / урок пройден */
export const CourseIcon = icon(
  'CourseIcon',
  <>
    <path d="M12 6.5C9.6 4.9 6.6 4.4 3 5v13.5c3.6-.6 6.6-.1 9 1.5 2.4-1.6 5.4-2.1 9-1.5V5c-3.6-.6-6.6-.1-9 1.5Z" />
    <path d="M12 6.5V20" />
    <path d="m14.5 11.5 1.5 1.5 3-3" />
  </>,
)

/** Согласования, входящие */
export const ApprovalsIcon = icon(
  'ApprovalsIcon',
  <>
    <path d="M3.5 13.5 6 5.8a2 2 0 0 1 1.9-1.3h8.2A2 2 0 0 1 18 5.8l2.5 7.7V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4.5Z" />
    <path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5" />
    <path d="m9.5 9 1.8 1.8L14.5 7.5" />
  </>,
)

/** Команда, сотрудники */
export const TeamIcon = icon(
  'TeamIcon',
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.4-3.6 3-5.8 6.5-5.8s6.1 2.2 6.5 5.8" />
    <path d="M15.5 4.8a3.3 3.3 0 0 1 0 6.4M17.5 14.6c2.2.6 3.6 2.6 4 5.4" />
  </>,
)

/** Аналитика и прогнозы */
export const AnalyticsIcon = icon(
  'AnalyticsIcon',
  <>
    <path d="M3.5 20.5h17" />
    <rect x="5" y="12" width="3" height="5.5" rx="1" />
    <rect x="10.5" y="8" width="3" height="9.5" rx="1" />
    <rect x="16" y="4" width="3" height="13.5" rx="1" />
  </>,
)

/** Обращения в HR */
export const TicketsIcon = icon(
  'TicketsIcon',
  <>
    <path d="M14.5 3.5h-9a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1v3l3.5-3h4.5a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2Z" />
    <path d="M19 9h.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 1-1.5 1.5h-1V20L15 17.5h-3.5" />
  </>,
)

/** Интеграции 1С:ЗУП */
export const IntegrationsIcon = icon(
  'IntegrationsIcon',
  <>
    <path d="M9 2.5v4M15 2.5v4" />
    <path d="M6.5 6.5h11v4a5.5 5.5 0 0 1-11 0v-4Z" />
    <path d="M12 16v5.5" />
  </>,
)

/** Профиль */
export const ProfileIcon = icon(
  'ProfileIcon',
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21c.6-4 3.6-6.5 7.5-6.5s6.9 2.5 7.5 6.5" />
  </>,
)

/** Отпуск: пальма */
export const VacationIcon = icon(
  'VacationIcon',
  <>
    <path d="M13 20.5c.4-3.8-.3-7-1.9-9.8" />
    <path d="M11.1 10.7C10 7.4 7.2 6 3.8 7" />
    <path d="M11.1 10.7c.9-3.4 3.7-5.2 7.6-4.8" />
    <path d="M11.1 10.7c-2.8.2-4.8 1.9-5.6 4.6" />
    <path d="M11.1 10.7c2.9-.3 5.2 1 6.5 3.6" />
    <path d="M4 20.5h16" />
  </>,
)

/** Аванс: купюра со знаком тенге */
export const AdvanceIcon = icon(
  'AdvanceIcon',
  <>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M8.5 9h7M8.5 11.5h7M12 11.5V16" />
  </>,
)

/** Справка с места работы */
export const CertificateIcon = icon(
  'CertificateIcon',
  <>
    <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5l-5-5Z" />
    <path d="M14 2.5v5h5" />
    <path d="M8.5 11.5h7M8.5 15h4" />
    <circle cx="15.5" cy="17.5" r="1.5" />
  </>,
)

/** Уведомления */
export const NotificationsIcon = icon(
  'NotificationsIcon',
  <>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z" />
    <path d="M10 21h4" />
  </>,
)

/** Сообщения */
export const MessagesIcon = icon(
  'MessagesIcon',
  <>
    <path d="M12 3.5c4.7 0 8.5 3.4 8.5 7.6s-3.8 7.6-8.5 7.6c-1 0-2-.1-2.9-.4L4.5 20.5l1.2-3.8C4.3 15.3 3.5 13.3 3.5 11.1c0-4.2 3.8-7.6 8.5-7.6Z" />
    <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
  </>,
)

/** Логистика: грузовик Jańa Post */
export const LogisticsIcon = icon(
  'LogisticsIcon',
  <>
    <path d="M2.5 6.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10h-12v-10Z" />
    <path d="M14.5 9.5h3.8l3.2 3.5v3.5h-7" />
    <circle cx="7" cy="17.5" r="2" />
    <circle cx="17.5" cy="17.5" r="2" />
    <path d="M6 9.5h4" />
  </>,
)

/** Посылка */
export const ParcelIcon = icon(
  'ParcelIcon',
  <>
    <path d="m12 2.5 8.5 4.5v10L12 21.5 3.5 17V7L12 2.5Z" />
    <path d="M3.5 7 12 11.5 20.5 7M12 11.5v10" />
    <path d="m7.8 4.8 8.5 4.5" />
  </>,
)

/** Язык интерфейса */
export const LanguageIcon = icon(
  'LanguageIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
  </>,
)

/** Календарь */
export const CalendarIcon = icon(
  'CalendarIcon',
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
  </>,
)

/** Сертификат, результат */
export const AwardIcon = icon(
  'AwardIcon',
  <>
    <circle cx="12" cy="9" r="6" />
    <path d="m9.5 9 1.7 1.7 3.3-3.4" />
    <path d="m8.5 14 -1.5 7.5 5-2.5 5 2.5-1.5-7.5" />
  </>,
)

/** Поиск */
export const SearchIcon = icon(
  'SearchIcon',
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m16 16 4.5 4.5" />
  </>,
)

/** Выход */
export const LogoutIcon = icon(
  'LogoutIcon',
  <>
    <path d="M14 4.5V4a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 4 4v16a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 14 20v-.5" />
    <path d="M10 12h10.5M17.5 8.5 21 12l-3.5 3.5" />
  </>,
)

export const JanaIcon = {
  home: HomeIcon,
  pulse: PulseIcon,
  requests: RequestsIcon,
  academy: AcademyIcon,
  aiJana: AiJanaIcon,
  tasks: TasksIcon,
  announcements: AnnouncementsIcon,
  knowledge: KnowledgeIcon,
  approvals: ApprovalsIcon,
  team: TeamIcon,
  analytics: AnalyticsIcon,
  tickets: TicketsIcon,
  integrations: IntegrationsIcon,
  profile: ProfileIcon,
  vacation: VacationIcon,
  advance: AdvanceIcon,
  certificate: CertificateIcon,
  notifications: NotificationsIcon,
  messages: MessagesIcon,
  logistics: LogisticsIcon,
  parcel: ParcelIcon,
  language: LanguageIcon,
  calendar: CalendarIcon,
  course: CourseIcon,
  award: AwardIcon,
  search: SearchIcon,
  logout: LogoutIcon,
} as const
