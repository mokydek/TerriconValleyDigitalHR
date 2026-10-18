import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { must, realtimeEnabled, supabase } from './supabase'
import { useAuth } from './auth'
import type {
  Announcement,
  Assignment,
  AttentionItem,
  Course,
  Department,
  Employee,
  EmployeePrivate,
  HrRequest,
  HrTicket,
  KbArticle,
  Lesson,
  Notification,
  PersonRow,
  Question,
  QuizResult,
  RequestEvent,
  RequestType,
  Task,
  TaskAttachment,
  TaskKind,
  LessonCheck,
  VacationBalance,
} from './types'

const REQUEST_SELECT =
  '*, employee:employees!requests_employee_fk(id,first_name,last_name,position,manager_id,department_id,department:departments!employees_department_fk(name)), approver:employees!requests_approver_fk(id,first_name,last_name,role)'

/* ======================= Справочники ======================= */

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => must(supabase.from('departments').select('id,name,parent_id,head_id').order('name')) as Promise<Department[]>,
    staleTime: 5 * 60_000,
  })
}

export function useEmployeesLite() {
  return useQuery({
    queryKey: ['employees-lite'],
    queryFn: () =>
      must(
        supabase
          .from('employees')
          .select('id,first_name,last_name,position,department_id,manager_id,role,status')
          .neq('status', 'terminated')
          .order('last_name'),
      ) as Promise<Pick<Employee, 'id' | 'first_name' | 'last_name' | 'position' | 'department_id' | 'manager_id' | 'role' | 'status'>[]>,
    staleTime: 5 * 60_000,
  })
}

/* ======================= Отпуск ======================= */

export function useVacationBalance(employeeId?: string) {
  const { me } = useAuth()
  const id = employeeId ?? me?.id
  return useQuery({
    queryKey: ['vacation-balance', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const rows = (await must(supabase.rpc('vacation_balance', { p_employee: id }))) as VacationBalance[]
      return rows[0]
    },
  })
}

/* ======================= Заявки ======================= */

export function useMyRequests() {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['requests', 'mine', me?.id],
    enabled: Boolean(me),
    queryFn: () =>
      must(supabase.from('requests').select(REQUEST_SELECT).eq('employee_id', me!.id).order('created_at', { ascending: false })) as Promise<
        HrRequest[]
      >,
  })
}

export function useEmployeeRequests(employeeId?: string) {
  return useQuery({
    queryKey: ['requests', 'employee', employeeId],
    enabled: Boolean(employeeId),
    queryFn: () =>
      must(supabase.from('requests').select(REQUEST_SELECT).eq('employee_id', employeeId!).order('created_at', { ascending: false })) as Promise<
        HrRequest[]
      >,
  })
}

/** Заявки «в работе» для руководителя (его команда) и HR (вся компания) — RLS отдаёт только разрешённые */
export function useWorkRequests(includeDoneDays = 14) {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['requests', 'work', me?.id, includeDoneDays],
    enabled: Boolean(me),
    refetchInterval: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - includeDoneDays * 86400_000).toISOString()
      const rows = (await must(
        supabase
          .from('requests')
          .select(REQUEST_SELECT)
          .neq('employee_id', me!.id)
          .or(`status.in.(pending,approved,processing),and(status.in.(done,rejected),updated_at.gte."${since}")`)
          .order('created_at', { ascending: true }),
      )) as HrRequest[]
      return rows
    },
  })
}

export function useRequestEvents(requestId?: string) {
  return useQuery({
    queryKey: ['request-events', requestId],
    enabled: Boolean(requestId),
    queryFn: () =>
      must(
        supabase
          .from('request_events')
          .select('*, actor:employees!request_events_actor_fk(first_name,last_name,position)')
          .eq('request_id', requestId!)
          .order('created_at'),
      ) as Promise<RequestEvent[]>,
  })
}

/** Время последнего перехода по этапам — для таймера «сколько висит» */
export function useStageSince(requestIds: string[]) {
  return useQuery({
    queryKey: ['request-stage-since', requestIds.join(',')],
    enabled: requestIds.length > 0,
    queryFn: async () => {
      const rows = (await must(
        supabase
          .from('request_events')
          .select('request_id,action,created_at')
          .in('request_id', requestIds)
          .in('action', ['created', 'approved', 'processed', 'completed', 'rejected'])
          .order('created_at'),
      )) as { request_id: string; action: string; created_at: string }[]
      const map: Record<string, string> = {}
      for (const r of rows) map[r.request_id] = r.created_at
      return map
    },
  })
}

export interface NewRequest {
  type: RequestType
  start_date?: string | null
  end_date?: string | null
  amount?: number | null
  comment?: string | null
  details?: Record<string, unknown>
}

function invalidateRequests(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['requests'] })
  void qc.invalidateQueries({ queryKey: ['request-events'] })
  void qc.invalidateQueries({ queryKey: ['request-stage-since'] })
  void qc.invalidateQueries({ queryKey: ['vacation-balance'] })
  void qc.invalidateQueries({ queryKey: ['notifications'] })
  void qc.invalidateQueries({ queryKey: ['hr'] })
}

export function useCreateRequest() {
  const qc = useQueryClient()
  const { me } = useAuth()
  return useMutation({
    mutationFn: async (r: NewRequest) =>
      must(
        supabase
          .from('requests')
          .insert({ employee_id: me!.id, ...r, details: r.details ?? {} })
          .select(REQUEST_SELECT)
          .single(),
      ) as Promise<HrRequest>,
    onSuccess: () => invalidateRequests(qc),
  })
}

export function useDecideRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, action, comment }: { id: string; action: 'approve' | 'process' | 'reject'; comment?: string }) =>
      must(supabase.rpc('decide_request', { p_request_id: id, p_action: action, p_comment: comment ?? null })),
    onSuccess: () => invalidateRequests(qc),
  })
}

export function useCancelRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => must(supabase.rpc('cancel_request', { p_request_id: id })),
    onSuccess: () => invalidateRequests(qc),
  })
}

export function useNudge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => must(supabase.rpc('nudge_approver', { p_request_id: id })),
    onSuccess: () => {
      invalidateRequests(qc)
      void qc.invalidateQueries({ queryKey: ['attention'] })
    },
  })
}

export function useRunIntegrationWorker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => must(supabase.rpc('run_integration_worker')) as Promise<number>,
    onSuccess: () => {
      invalidateRequests(qc)
      void qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })
}

/* ======================= Уведомления ======================= */

export function useNotifications() {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['notifications', me?.id],
    enabled: Boolean(me),
    refetchInterval: 45_000,
    queryFn: () =>
      must(
        supabase.from('notifications').select('*').eq('employee_id', me!.id).order('created_at', { ascending: false }).limit(60),
      ) as Promise<Notification[]>,
  })
}

/**
 * Realtime: новые уведомления появляются без перезагрузки (если Realtime включён в проекте).
 * Подписка одна на всё приложение (вызывается в AppShell): несколько подписок на один канал
 * Supabase объединяет, и повторное .on() после subscribe() бросает исключение.
 */
export function useRealtimeNotifications() {
  const { me } = useAuth()
  const qc = useQueryClient()
  useEffect(() => {
    if (!me || !realtimeEnabled) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      // уникальное имя канала: после размонтирования старый канал удаляется асинхронно
      channel = supabase
        .channel(`notifications-${me.id}-${Math.random().toString(36).slice(2, 10)}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `employee_id=eq.${me.id}` },
          () => {
            void qc.invalidateQueries({ queryKey: ['notifications'] })
            void qc.invalidateQueries({ queryKey: ['requests'] })
            void qc.invalidateQueries({ queryKey: ['assignments'] })
          },
        )
        .subscribe()
    } catch (error) {
      // Realtime — улучшение, а не обязательная часть: без него уведомления обновляются опросом
      console.warn('Realtime unavailable', error)
    }
    return () => {
      if (channel) void supabase.removeChannel(channel)
    }
  }, [me, qc])
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => must(supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => must(supabase.rpc('mark_all_notifications_read')),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

/* ======================= Jana Academy ======================= */

export function useCourses() {
  return useQuery({
    queryKey: ['courses'],
    queryFn: () => must(supabase.from('courses').select('*').order('is_mandatory', { ascending: false }).order('title')) as Promise<Course[]>,
    staleTime: 5 * 60_000,
  })
}

export function useCourseLessonCounts() {
  return useQuery({
    queryKey: ['course-lesson-counts'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = (await must(supabase.from('course_lessons').select('course_id'))) as { course_id: string }[]
      const map: Record<string, number> = {}
      for (const r of rows) map[r.course_id] = (map[r.course_id] ?? 0) + 1
      return map
    },
  })
}

export function useMyAssignments(employeeId?: string) {
  const { me } = useAuth()
  const id = employeeId ?? me?.id
  return useQuery({
    queryKey: ['assignments', id],
    enabled: Boolean(id),
    queryFn: () =>
      must(supabase.from('course_assignments').select('*, course:courses(*)').eq('employee_id', id!).order('created_at', { ascending: false })) as Promise<
        Assignment[]
      >,
  })
}

export function useCourse(slug?: string) {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['course', slug, me?.id],
    enabled: Boolean(slug && me),
    queryFn: async () => {
      const course = (await must(supabase.from('courses').select('*').eq('slug', slug!).single())) as Course
      const [lessons, questions, assignment, progress] = await Promise.all([
        must(supabase.from('course_lessons').select('*').eq('course_id', course.id).order('sort')) as Promise<Lesson[]>,
        must(supabase.from('course_questions').select('*').eq('course_id', course.id).order('sort')) as Promise<Question[]>,
        must(supabase.from('course_assignments').select('*').eq('course_id', course.id).eq('employee_id', me!.id).maybeSingle()) as Promise<Assignment | null>,
        must(supabase.from('lesson_progress').select('lesson_id').eq('employee_id', me!.id)) as Promise<{ lesson_id: string }[]>,
      ])
      const done = new Set(progress.map((p) => p.lesson_id))
      const lessonIds = lessons.map((l) => l.id)
      const [checks, answered] = await Promise.all([
        lessonIds.length
          ? (must(supabase.from('lesson_checks').select('*').in('lesson_id', lessonIds).order('sort')) as Promise<LessonCheck[]>)
          : Promise.resolve([] as LessonCheck[]),
        must(supabase.from('lesson_check_answers').select('check_id,correct').eq('employee_id', me!.id)) as Promise<{ check_id: string; correct: boolean }[]>,
      ])
      const solved = new Set(answered.filter((a) => a.correct).map((a) => a.check_id))
      return { course, lessons, questions, assignment, done, checks, solved }
    },
  })
}

function invalidateAcademy(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['course'] })
  void qc.invalidateQueries({ queryKey: ['assignments'] })
  void qc.invalidateQueries({ queryKey: ['notifications'] })
  void qc.invalidateQueries({ queryKey: ['hr'] })
}

export function useAnswerCheck() {
  return useMutation({
    mutationFn: async (p: { checkId: string; index: number }) =>
      (await must(supabase.rpc('answer_lesson_check', { p_check: p.checkId, p_index: p.index }))) as {
        correct: boolean
        explanation: string | null
        correct_index: number | null
      },
  })
}

export function useCompleteLesson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lessonId: string) => must(supabase.rpc('complete_lesson', { p_lesson: lessonId })) as Promise<Assignment>,
    onSuccess: () => invalidateAcademy(qc),
  })
}

export function useSubmitQuiz() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ courseId, answers }: { courseId: string; answers: Record<string, number> }) =>
      must(supabase.rpc('submit_quiz', { p_course: courseId, p_answers: answers })) as Promise<QuizResult>,
    onSuccess: () => invalidateAcademy(qc),
  })
}

export function useAssignCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ courseId, employeeIds, due }: { courseId: string; employeeIds: string[]; due: string | null }) =>
      must(supabase.rpc('assign_course', { p_course: courseId, p_employees: employeeIds, p_due: due })) as Promise<number>,
    onSuccess: () => invalidateAcademy(qc),
  })
}

/* ======================= Задачи ======================= */

const TASK_SELECT =
  '*, assignee:employees!tasks_assignee_fk(id,first_name,last_name,position), creator:employees!tasks_creator_fk(id,first_name,last_name,position), course:courses!tasks_course_fk(id,slug,title,duration_minutes,icon)'

export function useTasks(scope: 'mine' | 'created' | 'team' | 'employee', employeeId?: string) {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['tasks', scope, employeeId ?? me?.id],
    enabled: Boolean(me),
    queryFn: async () => {
      let q = supabase.from('tasks').select(TASK_SELECT).order('due_at', { ascending: true, nullsFirst: false })
      if (scope === 'mine') q = q.eq('assignee_id', me!.id)
      if (scope === 'created') q = q.eq('created_by', me!.id)
      if (scope === 'team') q = q.neq('assignee_id', me!.id)
      if (scope === 'employee') q = q.eq('assignee_id', employeeId!)
      return (await must(q)) as Task[]
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Task> }) => must(supabase.from('tasks').update(patch).eq('id', id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['hr'] })
    },
  })
}

export interface NewTaskInput {
  title: string
  description: string
  priority: string
  category: string
  dueAt: string | null
  assignees: string[]
  kind: TaskKind
  courseId: string | null
  checklist: { text: string; done: boolean }[]
}

export function useAssignTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: NewTaskInput) =>
      must(
        supabase.rpc('assign_tasks', {
          p_title: p.title,
          p_description: p.description,
          p_priority: p.priority,
          p_category: p.category,
          p_due: null,
          p_assignees: p.assignees,
          p_kind: p.kind,
          p_course: p.courseId,
          p_checklist: p.checklist,
          p_due_at: p.dueAt,
        }),
      ) as Promise<number>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['assignments'] })
    },
  })
}

/** Принять отчёт по задаче или вернуть на доработку */
export function useReviewTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { id: string; accept: boolean; comment?: string }) =>
      must(supabase.rpc('review_task', { p_task: p.id, p_accept: p.accept, p_comment: p.comment ?? null })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['task'] })
    },
  })
}

export function useTask(id?: string | null) {
  return useQuery({
    queryKey: ['task', id],
    enabled: Boolean(id),
    queryFn: async () => (await must(supabase.from('tasks').select(TASK_SELECT).eq('id', id!).maybeSingle())) as Task | null,
  })
}

const ATTACHMENT_FIELDS = 'id,task_id,author_id,name,mime,size,created_at'

export function useTaskAttachments(taskId?: string) {
  return useQuery({
    queryKey: ['task-attachments', taskId],
    enabled: Boolean(taskId),
    queryFn: async () =>
      (await must(supabase.from('task_attachments').select(ATTACHMENT_FIELDS).eq('task_id', taskId!).order('created_at'))) as TaskAttachment[],
  })
}

export function useAddAttachment() {
  const qc = useQueryClient()
  const { me } = useAuth()
  return useMutation({
    mutationFn: async (p: { taskId: string; name: string; mime: string; size: number; data: string }) =>
      must(supabase.from('task_attachments').insert({ task_id: p.taskId, author_id: me!.id, name: p.name, mime: p.mime, size: p.size, data: p.data })),
    onSuccess: (_d, p) => void qc.invalidateQueries({ queryKey: ['task-attachments', p.taskId] }),
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { id: string; taskId: string }) => must(supabase.from('task_attachments').delete().eq('id', p.id)),
    onSuccess: (_d, p) => void qc.invalidateQueries({ queryKey: ['task-attachments', p.taskId] }),
  })
}

/** Содержимое вложения грузим только по клику: в списке хватает имени и размера */
export async function fetchAttachmentData(id: string): Promise<string> {
  const row = (await must(supabase.from('task_attachments').select('data').eq('id', id).single())) as { data: string }
  return row.data
}

/* ======================= Объявления ======================= */

export function useAnnouncements(limit = 50) {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['announcements', limit],
    enabled: Boolean(me),
    queryFn: async () => {
      const [items, reads] = await Promise.all([
        must(
          supabase
            .from('announcements')
            .select('*, author:employees!announcements_author_fk(first_name,last_name,position), department:departments!announcements_department_fk(name)')
            .order('pinned', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(limit),
        ) as Promise<Announcement[]>,
        must(supabase.from('announcement_reads').select('announcement_id').eq('employee_id', me!.id)) as Promise<{ announcement_id: string }[]>,
      ])
      const read = new Set(reads.map((r) => r.announcement_id))
      return items.map((a) => ({ ...a, read: read.has(a.id) }))
    },
  })
}

export function useMarkAnnouncementRead() {
  const qc = useQueryClient()
  const { me } = useAuth()
  return useMutation({
    mutationFn: async (id: string) =>
      must(supabase.from('announcement_reads').upsert({ announcement_id: id, employee_id: me!.id }, { onConflict: 'announcement_id,employee_id', ignoreDuplicates: true })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['announcements'] }),
  })
}

export function useCreateAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: {
      title: string
      summary: string | null
      body: string
      category: string
      cover: string
      image: string | null
      video: string | null
      pinned: boolean
      audience_department_id: string | null
    }) => must(supabase.from('announcements').insert(a)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['announcements'] }),
  })
}

/* ======================= База знаний и обращения ======================= */

export function useKbArticles() {
  return useQuery({
    queryKey: ['kb-articles'],
    queryFn: () => must(supabase.from('kb_articles').select('*').order('category').order('title')) as Promise<KbArticle[]>,
    staleTime: 60_000,
  })
}

export function useKbArticle(slug?: string) {
  return useQuery({
    queryKey: ['kb-article', slug],
    enabled: Boolean(slug),
    queryFn: () => must(supabase.from('kb_articles').select('*').eq('slug', slug!).maybeSingle()) as Promise<KbArticle | null>,
  })
}

export function useTickets(scope: 'mine' | 'all') {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['tickets', scope, me?.id],
    enabled: Boolean(me),
    queryFn: async () => {
      let q = supabase
        .from('hr_tickets')
        .select('*, employee:employees!hr_tickets_employee_fk(first_name,last_name,position,department:departments!employees_department_fk(name))')
        .order('created_at', { ascending: false })
      if (scope === 'mine') q = q.eq('employee_id', me!.id)
      return (await must(q)) as HrTicket[]
    },
  })
}

export function useCreateTicket() {
  const qc = useQueryClient()
  const { me } = useAuth()
  return useMutation({
    mutationFn: async ({ question, aiQueryId }: { question: string; aiQueryId?: string | null }) =>
      must(supabase.from('hr_tickets').insert({ employee_id: me!.id, question, ai_query_id: aiQueryId ?? null }).select('*').single()) as Promise<HrTicket>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

export function useAnswerTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { id: string; answer: string; addToKb: boolean; kbTitle?: string }) =>
      must(supabase.rpc('answer_ticket', { p_ticket: p.id, p_answer: p.answer, p_add_to_kb: p.addToKb, p_kb_title: p.kbTitle ?? null })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['kb-articles'] })
      void qc.invalidateQueries({ queryKey: ['hr'] })
    },
  })
}

/* ======================= HR: сотрудники, «Слежу», зона внимания ======================= */

export function usePeople() {
  return useQuery({
    queryKey: ['hr', 'people'],
    queryFn: () => must(supabase.rpc('people_overview')) as Promise<PersonRow[]>,
  })
}

export function useToggleFollow() {
  const qc = useQueryClient()
  const { me } = useAuth()
  return useMutation({
    mutationFn: async ({ employeeId, follow, reason }: { employeeId: string; follow: boolean; reason?: string }) => {
      if (follow) {
        return must(supabase.from('watchlist').insert({ employee_id: employeeId, added_by: me!.id, reason: reason ?? null }))
      }
      return must(supabase.from('watchlist').delete().eq('employee_id', employeeId).eq('added_by', me!.id))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })
}

export function useWatchlist() {
  const { me, isHr } = useAuth()
  return useQuery({
    queryKey: ['watchlist', me?.id],
    enabled: Boolean(me && isHr),
    queryFn: () =>
      must(supabase.from('watchlist').select('employee_id,reason,created_at').eq('added_by', me!.id)) as Promise<
        { employee_id: string; reason: string | null; created_at: string }[]
      >,
  })
}

export function useHrDashboard() {
  return useQuery({ queryKey: ['hr', 'dashboard'], queryFn: () => must(supabase.rpc('hr_dashboard')) as Promise<HrDashboard>, refetchInterval: 60_000 })
}

export function useHrCharts() {
  return useQuery({ queryKey: ['hr', 'charts'], queryFn: () => must(supabase.rpc('hr_charts')) as Promise<HrCharts> })
}

export function useAttentionZone() {
  return useQuery({ queryKey: ['hr', 'attention'], queryFn: () => must(supabase.rpc('attention_zone')) as Promise<AttentionItem[]> })
}

export function useAttentionAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { action: string; employeeId: string; refId: string | null }) =>
      must(supabase.rpc('attention_action', { p_action: p.action, p_employee: p.employeeId, p_ref: p.refId })) as Promise<string>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['assignments'] })
    },
  })
}

/** Действия «Зоны внимания» пачкой: напомнить всем, поторопить всех, назначить всем */
export function useAttentionBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (items: { action: string; employee_id: string; ref_id: string | null }[]) =>
      must(supabase.rpc('attention_bulk', { p_items: items })) as Promise<number>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['assignments'] })
    },
  })
}

/** Своё напоминание группе сотрудников */
export function useSendReminder() {
  return useMutation({
    mutationFn: async (p: { employees: string[]; title: string; body: string; link: string }) =>
      must(supabase.rpc('send_reminder', { p_employees: p.employees, p_title: p.title, p_body: p.body, p_link: p.link })) as Promise<number>,
  })
}

export function useRefreshWatchAlerts(enabled: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    void supabase.rpc('refresh_watch_alerts').then(({ data }) => {
      if (data && Number(data) > 0) void qc.invalidateQueries({ queryKey: ['notifications'] })
    })
  }, [enabled, qc])
}

export function useEmployee(id?: string) {
  const { isHr, me } = useAuth()
  return useQuery({
    queryKey: ['employee', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const emp = (await must(
        supabase
          .from('employees')
          .select(
            '*, department:departments!employees_department_fk(id,name), location:locations!employees_location_fk(id,name,city,country), manager:manager(id,first_name,last_name,position,email,phone)',
          )
          .eq('id', id!)
          .single(),
      )) as Employee
      let priv: EmployeePrivate | null = null
      if (isHr || id === me?.id) {
        priv = (await must(supabase.from('employee_private').select('*').eq('employee_id', id!).maybeSingle())) as EmployeePrivate | null
      }
      return { emp, priv }
    },
  })
}

export function useAnalytics<T = unknown>(fn: string, args?: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: ['hr', 'analytics', fn, args],
    enabled,
    queryFn: () => must(supabase.rpc(fn, args ?? {})) as Promise<T>,
  })
}

/* ======================= Интеграции ======================= */

export function useIntegrationEvents() {
  return useQuery({
    queryKey: ['integrations', 'events'],
    queryFn: () =>
      must(supabase.from('integration_events').select('*').order('created_at', { ascending: false }).limit(40)) as Promise<
        {
          id: string
          system: string
          direction: string
          entity: string
          entity_id: string | null
          payload: Record<string, unknown>
          status: string
          external_id: string | null
          response: { document?: string } | null
          created_at: string
          processed_at: string | null
        }[]
      >,
    refetchInterval: 15_000,
  })
}

export function useZupPending() {
  return useQuery({
    queryKey: ['integrations', 'zup-pending'],
    queryFn: () =>
      must(supabase.rpc('zup_pending_changes')) as Promise<{
        new: { tab_no: string; name: string; position: string }[]
        changed: { tab_no: string; name: string; field: string; from: string; to: string }[]
        last_sync: string | null
      }>,
  })
}

export function useSyncZup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      must(supabase.rpc('sync_from_zup')) as Promise<{ total: number; inserted: number; updated: number; unchanged: number }>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['integrations'] })
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['employees-lite'] })
    },
  })
}

/* ======================= Типы ответов аналитики ======================= */

export interface HrDashboard {
  scope: 'company' | 'team'
  headcount: number
  newcomers_90d: number
  on_vacation_today: number
  requests: { in_work: number; at_manager: number; at_hr: number; in_1c: number; done_30d: number; created_30d: number; approval_hours: number | null }
  vacation: { entitled: number; used: number; reserved: number; available: number; usage_pct: number; over_30: number }
  learning: { assigned: number; completed: number; mandatory_pct: number; avg_score: number | null; overdue: number }
  ai: { queries_30d: number; no_answer_pct: number; open_tickets: number }
  tasks: { open: number; overdue: number; completion_pct: number }
}

export interface HrCharts {
  requests_weekly: { week: string; vacation: number; advance: number; other: number }[]
  vacation_monthly: {
    trend: number
    months: { key: string; label: string; actual: number | null; planned: number | null; forecast: number | null; last_year: number }[]
  }
  learning_by_department: { department: string; assigned: number; completed: number; pct: number }[]
  headcount_by_department: { department: string; count: number }[]
}
