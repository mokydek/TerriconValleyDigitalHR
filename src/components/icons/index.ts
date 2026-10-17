/**
 * Единая точка импорта иконок. Экраны импортируют отсюда, а не из lucide-react:
 * смысловые иконки (разделы, сервисы, роли) заменены фирменным набором в стиле Jańa Post,
 * служебные значки (стрелки, крестик, галочка, загрузка) остаются из lucide.
 * Явные экспорты ниже имеют приоритет над `export *`.
 */
export * from 'lucide-react'
export { JanaIcon, JANA_STROKE, type JanaIconProps } from './jana'

export {
  HomeIcon as Home,
  PulseIcon as HeartPulse,
  RequestsIcon as FileStack,
  AcademyIcon as GraduationCap,
  AiJanaIcon as Sparkles,
  AiJanaIcon as Bot,
  TasksIcon as ClipboardList,
  AnnouncementsIcon as Megaphone,
  KnowledgeIcon as BookOpen,
  CourseIcon as BookOpenCheck,
  ApprovalsIcon as Inbox,
  TeamIcon as Users,
  TeamIcon as UsersRound,
  AnalyticsIcon as ChartColumnBig,
  TicketsIcon as MessagesSquare,
  TicketsIcon as MessageCircleQuestion,
  IntegrationsIcon as Plug,
  ProfileIcon as UserRound,
  VacationIcon as Palmtree,
  AdvanceIcon as Wallet,
  CertificateIcon as FileText,
  NotificationsIcon as Bell,
  MessagesIcon as MessageCircle,
  LogisticsIcon as Truck,
  ParcelIcon as Package,
  LanguageIcon as Globe,
  CalendarIcon as CalendarDays,
  AwardIcon as Award,
  SearchIcon as Search,
  LogoutIcon as LogOut,
} from './jana'
