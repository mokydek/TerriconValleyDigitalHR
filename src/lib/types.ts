export type Role = 'employee' | 'manager' | 'hr'

export interface Department {
  id: string
  name: string
  parent_id: string | null
  head_id: string | null
}

export interface Location {
  id: string
  name: string
  city: string
  country: string
  type: string
}

export interface Employee {
  id: string
  user_id: string | null
  zup_id: string | null
  company: string
  first_name: string
  last_name: string
  middle_name: string | null
  email: string
  phone: string | null
  position: string
  department_id: string | null
  location_id: string | null
  manager_id: string | null
  role: Role
  employment_type: string
  status: 'active' | 'on_leave' | 'terminated'
  hire_date: string
  vacation_days_per_year: number
  vacation_carryover: number
  synced_at: string | null
  department?: Pick<Department, 'id' | 'name'> | null
  location?: Pick<Location, 'id' | 'name' | 'city' | 'country'> | null
  manager?: Pick<Employee, 'id' | 'first_name' | 'last_name' | 'position' | 'email' | 'phone'> | null
}

export interface EmployeePrivate {
  employee_id: string
  iin: string | null
  birth_date: string | null
  salary: number | null
  personal_phone: string | null
  address: string | null
  emergency_contact: string | null
}

export interface VacationBalance {
  year: number
  entitled: number
  used: number
  reserved: number
  available: number
  /** перенос неиспользованных дней с прошлого года (уже входит в entitled) */
  carryover: number
}

export type RequestType = 'vacation' | 'advance' | 'certificate' | 'data_change'
export type RequestStatus = 'pending' | 'approved' | 'processing' | 'done' | 'rejected' | 'cancelled'

export interface IntegrationDoc {
  id: string
  document: string
  route?: string
}

export interface HrRequest {
  id: string
  number: number
  employee_id: string
  type: RequestType
  status: RequestStatus
  start_date: string | null
  end_date: string | null
  days: number | null
  amount: number | null
  comment: string | null
  details: Record<string, string | number | null>
  approver_id: string | null
  integration: { zup?: IntegrationDoc; documentolog?: IntegrationDoc }
  created_at: string
  updated_at: string
  employee?: Pick<Employee, 'id' | 'first_name' | 'last_name' | 'position' | 'manager_id' | 'department_id'> & {
    department?: { name: string } | null
  }
  approver?: Pick<Employee, 'id' | 'first_name' | 'last_name' | 'role'> | null
}

export interface RequestEvent {
  id: string
  request_id: string
  action: 'created' | 'approved' | 'rejected' | 'processed' | 'completed' | 'cancelled' | 'integration' | 'nudged' | 'comment'
  status: RequestStatus | null
  actor_id: string | null
  comment: string | null
  created_at: string
  actor?: Pick<Employee, 'first_name' | 'last_name' | 'position'> | null
}

export interface Notification {
  id: string
  employee_id: string
  title: string
  body: string | null
  link: string | null
  kind: string
  read_at: string | null
  created_at: string
}

export interface Course {
  id: string
  slug: string
  title: string
  description: string | null
  category: string
  /** ключ собственной иконки курса (CourseIcon) */
  icon: string
  summary: string | null
  duration_minutes: number
  is_mandatory: boolean
  pass_score: number
}

export interface Lesson {
  id: string
  course_id: string
  sort: number
  title: string
  content: string
  duration_minutes: number
  kind: 'article' | 'video' | 'practice'
  video_id: string | null
  video_title: string | null
  video_channel: string | null
}

export interface Question {
  id: string
  course_id: string
  sort: number
  question: string
  options: string[]
  explanation: string | null
}

export interface Assignment {
  id: string
  course_id: string
  employee_id: string
  status: 'assigned' | 'in_progress' | 'completed'
  progress: number
  score: number | null
  attempts: number
  due_date: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  course?: Course
}

export interface QuizResult {
  score: number
  passed: boolean
  pass_score: number
  correct: number
  total: number
  attempts: number
  results: { question_id: string; correct: boolean; explanation: string | null }[]
}

export interface KbArticle {
  id: string
  slug: string
  title: string
  title_kk: string | null
  category: string
  summary: string | null
  content: string
  source_title: string
  visibility: 'all' | 'manager' | 'hr'
  updated_at: string
}

export interface KbHit {
  chunk_id: string
  article_id: string
  slug: string
  title: string
  source_title: string
  heading: string
  content: string
  rank: number
  matched: number
  total_terms: number
}

export interface Task {
  id: string
  number: number
  title: string
  description: string | null
  assignee_id: string
  created_by: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'todo' | 'in_progress' | 'review' | 'done'
  category: string
  due_date: string | null
  /** дедлайн с точным временем */
  due_at: string | null
  kind: TaskKind
  course_id: string | null
  checklist: { text: string; done: boolean }[]
  result_note: string | null
  submitted_at: string | null
  review_comment: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  assignee?: Pick<Employee, 'id' | 'first_name' | 'last_name' | 'position'> | null
  creator?: Pick<Employee, 'id' | 'first_name' | 'last_name' | 'position'> | null
  course?: Pick<Course, 'id' | 'slug' | 'title' | 'duration_minutes' | 'icon'> | null
}

export type TaskKind = 'simple' | 'course' | 'report' | 'checklist'

export interface TaskAttachment {
  id: string
  task_id: string
  author_id: string | null
  name: string
  mime: string
  size: number
  created_at: string
}

export interface LessonCheck {
  id: string
  lesson_id: string
  sort: number
  question: string
  options: string[]
  explanation: string | null
}

export interface Announcement {
  id: string
  title: string
  summary: string | null
  body: string
  cover: string
  image: string | null
  /** Идентификатор ролика YouTube, приложенного к объявлению */
  video: string | null
  category: string
  pinned: boolean
  audience_department_id: string | null
  author_id: string | null
  created_at: string
  author?: Pick<Employee, 'first_name' | 'last_name' | 'position'> | null
  department?: { name: string } | null
}

export interface HrTicket {
  id: string
  number: number
  employee_id: string
  question: string
  status: 'open' | 'answered' | 'closed'
  answer: string | null
  answered_by: string | null
  created_at: string
  answered_at: string | null
  employee?: Pick<Employee, 'first_name' | 'last_name' | 'position'> & { department?: { name: string } | null }
}

export interface PersonRow {
  employee_id: string
  full_name: string
  job_title: string
  department_id: string | null
  department: string | null
  location: string | null
  role: Role
  hire_date: string
  state: 'active' | 'vacation' | 'newbie'
  vacation_available: number
  courses_assigned: number
  courses_completed: number
  courses_overdue: number
  avg_score: number | null
  open_tasks: number
  overdue_tasks: number
  requests_in_work: number
  followed: boolean
}

export interface AttentionItem {
  kind: 'vacation' | 'course' | 'request' | 'onboarding'
  employee_id: string
  full_name: string
  department: string | null
  title: string
  details: string
  action: 'remind_vacation' | 'remind_course' | 'nudge' | 'assign_course'
  ref_id: string | null
  severity: 'high' | 'medium' | 'low'
  last_reminded_at: string | null
}

export type ChatKind = 'direct' | 'group' | 'channel' | 'saved'
export type ChatRole = 'owner' | 'admin' | 'member'
export type ReactionKey = 'like' | 'heart' | 'fire' | 'party' | 'laugh' | 'ok'
export type AttachmentKind = 'image' | 'video' | 'file' | 'voice' | 'contact'

/** Служебное событие в ленте: текст собирает интерфейс на языке читателя */
export interface ChatEvent {
  event: 'created' | 'renamed' | 'photo' | 'photo_removed' | 'added' | 'removed' | 'left' | 'pinned' | 'admin'
  title?: string
  targets?: string[]
  message?: string
}

export interface ChatListItem {
  id: string
  kind: ChatKind
  title: string | null
  peer_id: string | null
  member_count: number
  avatar: string | null
  description: string | null
  my_role: ChatRole
  muted: boolean
  pinned: boolean
  last_body: string | null
  last_kind: ChatMessage['kind'] | null
  last_meta: ChatEvent | null
  last_attachment: AttachmentKind | null
  last_attachments: number
  last_author_id: string | null
  last_author_name: string | null
  last_at: string
  unread: number
}

/** Вложение без самого файла: файл грузится отдельно (useAttachmentData) */
export interface ChatAttachment {
  id: string
  kind: AttachmentKind
  name: string
  mime: string
  size: number
  thumb: string | null
  width: number | null
  height: number | null
  duration: number | null
  waveform: number[] | null
  contact_id: string | null
  position: number
}

export interface ChatPoll {
  question: string
  options: { id: number; text: string }[]
  multiple: boolean
  anonymous: boolean
  closed_at: string | null
}

export interface ChatMessage {
  id: string
  chat_id: string
  author_id: string
  body: string
  kind: 'text' | 'system' | 'poll'
  meta: ChatEvent | null
  reply_to: string | null
  edited_at: string | null
  deleted_at: string | null
  forward_author_id: string | null
  forward_chat_title: string | null
  created_at: string
  attachments: ChatAttachment[]
  reactions: { employee_id: string; reaction: ReactionKey }[]
  poll: ChatPoll | null
}

export interface ChatMember {
  employee_id: string
  last_read_at: string
  joined_at: string
  role: ChatRole
  employee: Pick<Employee, 'id' | 'first_name' | 'last_name' | 'position'> | null
}

export interface ChatInfo {
  id: string
  kind: ChatKind
  title: string | null
  description: string | null
  avatar: string | null
  pinned_message_id: string | null
  created_by: string | null
  created_at: string
}

export interface PollState {
  message_id: string
  counts: Record<string, number>
  total: number
  mine: number[]
  voters: Record<string, string[]> | null
}
