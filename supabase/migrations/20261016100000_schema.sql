-- =====================================================================
-- JanaMen — единая цифровая HR-платформа Jana Post
-- 1/7. Схема данных
--
-- Официальные кадровые данные (ФИО, должность, подразделение, руководитель,
-- дата приёма, оклад) мастерятся в 1С:ЗУП и попадают сюда только через
-- синхронизацию (см. 20261016100600_integrations.sql). Пользователи меняют
-- их не напрямую, а через заявку «Изменение данных».
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------- Оргструктура ----------

create table if not exists public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  city       text not null,
  country    text not null default 'Казахстан',
  type       text not null default 'office'
             check (type in ('office', 'warehouse', 'sorting_center', 'pickup_point')),
  created_at timestamptz not null default now()
);

create table if not exists public.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  parent_id  uuid,
  head_id    uuid,
  zup_id     text unique,
  created_at timestamptz not null default now(),
  constraint departments_parent_fk foreign key (parent_id) references public.departments (id) on delete set null
);

-- ---------- Сотрудники (рабочий профиль, виден коллегам) ----------

create table if not exists public.employees (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid unique,
  zup_id                 text unique,                 -- табельный номер в 1С:ЗУП
  company                text not null default 'ТОО «Jana Post»',
  first_name             text not null,
  last_name              text not null,
  middle_name            text,
  email                  text not null,
  phone                  text,
  position               text not null default 'Сотрудник',
  department_id          uuid,
  location_id            uuid,
  manager_id             uuid,
  role                   text not null default 'employee' check (role in ('employee', 'manager', 'hr')),
  employment_type        text not null default 'full_time'
                         check (employment_type in ('full_time', 'part_time', 'contract')),
  status                 text not null default 'active' check (status in ('active', 'on_leave', 'terminated')),
  hire_date              date not null default current_date,
  vacation_days_per_year integer not null default 24 check (vacation_days_per_year between 0 and 90),
  vacation_carryover     numeric(5, 1) not null default 0,
  avatar_color           text,
  synced_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint employees_user_fk       foreign key (user_id)       references auth.users (id) on delete set null,
  constraint employees_department_fk foreign key (department_id) references public.departments (id) on delete set null,
  constraint employees_location_fk   foreign key (location_id)   references public.locations (id) on delete set null,
  constraint employees_manager_fk    foreign key (manager_id)    references public.employees (id) on delete set null,
  constraint employees_not_own_manager check (manager_id is null or manager_id <> id)
);
create unique index if not exists employees_email_key on public.employees (lower(email));
create index if not exists employees_department_idx on public.employees (department_id);
create index if not exists employees_manager_idx on public.employees (manager_id);

do $$ begin
  alter table public.departments
    add constraint departments_head_fk foreign key (head_id) references public.employees (id) on delete set null;
exception when duplicate_object then null; end $$;

-- PostgREST не встраивает самоссылающиеся связи автоматически — объявляем computed relationship:
-- select=*,manager(first_name,last_name)
create or replace function public.manager(public.employees)
returns setof public.employees rows 1 language sql stable as $$
  select * from public.employees m where m.id = $1.manager_id
$$;

-- Персональные данные: видят только сам сотрудник и HR
create table if not exists public.employee_private (
  employee_id       uuid primary key,
  iin               text,
  birth_date        date,
  salary            numeric(12, 2),
  personal_phone    text,
  address           text,
  emergency_contact text,
  updated_at        timestamptz not null default now(),
  constraint employee_private_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade
);

-- ---------- HR-заявки ----------

create table if not exists public.requests (
  id               uuid primary key default gen_random_uuid(),
  number           bigint generated always as identity (start with 1001),
  employee_id      uuid not null,
  type             text not null check (type in ('vacation', 'advance', 'certificate', 'data_change')),
  -- pending — у согласующего (руководитель или HR), approved — согласовано руководителем, ждёт HR,
  -- processing — передано в 1С:ЗУП / Documentolog, ждём ответ, done — оформлено
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'processing', 'done', 'rejected', 'cancelled')),
  start_date       date,
  end_date         date,
  days             numeric(5, 1),
  amount           numeric(12, 2),
  comment          text,
  details          jsonb not null default '{}'::jsonb,
  approver_id      uuid,                              -- текущий согласующий
  integration      jsonb not null default '{}'::jsonb, -- внешние номера: 1С:ЗУП, Documentolog
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint requests_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade,
  constraint requests_approver_fk foreign key (approver_id) references public.employees (id) on delete set null,
  constraint requests_dates_check check (end_date is null or start_date is null or end_date >= start_date),
  constraint requests_amount_check check (amount is null or amount > 0)
);
create index if not exists requests_employee_idx on public.requests (employee_id, created_at desc);
create index if not exists requests_approver_idx on public.requests (approver_id, status);

-- История заявки: каждое действие и смена статуса
create table if not exists public.request_events (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  action     text not null check (action in ('created', 'approved', 'rejected', 'processed', 'completed', 'cancelled',
                                             'integration', 'nudged', 'comment')),
  status     text,
  actor_id   uuid,
  comment    text,
  created_at timestamptz not null default now(),
  constraint request_events_request_fk foreign key (request_id) references public.requests (id) on delete cascade,
  constraint request_events_actor_fk   foreign key (actor_id)   references public.employees (id) on delete set null
);
create index if not exists request_events_request_idx on public.request_events (request_id, created_at);

-- Производственный календарь РК
create table if not exists public.holidays (
  day  date primary key,
  name text not null
);

-- ---------- Уведомления ----------

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  title       text not null,
  body        text,
  link        text,
  kind        text not null default 'info'
              check (kind in ('info', 'success', 'warning', 'request', 'course', 'task', 'ticket', 'announcement')),
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint notifications_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade
);
create index if not exists notifications_employee_idx on public.notifications (employee_id, created_at desc);

-- ---------- Jana Academy ----------

create table if not exists public.courses (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  title            text not null,
  description      text,
  category         text not null default 'general' check (category in ('onboarding', 'safety', 'compliance', 'skills', 'general')),
  emoji            text not null default '📘',
  duration_minutes integer not null default 30,
  is_mandatory     boolean not null default false,
  pass_score       integer not null default 70 check (pass_score between 1 and 100),
  created_at       timestamptz not null default now()
);

create table if not exists public.course_lessons (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null,
  sort             integer not null default 0,
  title            text not null,
  content          text not null,
  duration_minutes integer not null default 5,
  constraint course_lessons_course_fk foreign key (course_id) references public.courses (id) on delete cascade
);
create index if not exists course_lessons_course_idx on public.course_lessons (course_id, sort);

create table if not exists public.course_questions (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null,
  sort        integer not null default 0,
  question    text not null,
  options     jsonb not null,
  explanation text,
  constraint course_questions_course_fk foreign key (course_id) references public.courses (id) on delete cascade
);

-- Правильные ответы скрыты от клиента: нет select-политики, проверка только в submit_quiz
create table if not exists public.course_answer_keys (
  question_id   uuid primary key,
  correct_index integer not null,
  constraint course_answer_keys_question_fk foreign key (question_id) references public.course_questions (id) on delete cascade
);

create table if not exists public.course_assignments (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null,
  employee_id  uuid not null,
  status       text not null default 'assigned' check (status in ('assigned', 'in_progress', 'completed')),
  progress     integer not null default 0 check (progress between 0 and 100),
  score        integer,
  attempts     integer not null default 0,
  due_date     date,
  assigned_by  uuid,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint course_assignments_course_fk   foreign key (course_id)   references public.courses (id) on delete cascade,
  constraint course_assignments_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade,
  constraint course_assignments_assigner_fk foreign key (assigned_by) references public.employees (id) on delete set null,
  constraint course_assignments_unique unique (course_id, employee_id)
);
create index if not exists course_assignments_employee_idx on public.course_assignments (employee_id);

create table if not exists public.lesson_progress (
  employee_id  uuid not null,
  lesson_id    uuid not null,
  completed_at timestamptz not null default now(),
  primary key (employee_id, lesson_id),
  constraint lesson_progress_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade,
  constraint lesson_progress_lesson_fk   foreign key (lesson_id)   references public.course_lessons (id) on delete cascade
);

create table if not exists public.course_attempts (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null,
  employee_id uuid not null,
  score       integer not null,
  passed      boolean not null,
  answers     jsonb not null,
  created_at  timestamptz not null default now(),
  constraint course_attempts_course_fk   foreign key (course_id)   references public.courses (id) on delete cascade,
  constraint course_attempts_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade
);

-- ---------- База знаний и AI Jana ----------

create table if not exists public.kb_articles (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  title_kk     text,
  category     text not null default 'general',
  summary      text,
  content      text not null,
  source_title text not null,                 -- документ-первоисточник
  visibility   text not null default 'all' check (visibility in ('all', 'manager', 'hr')),
  keywords     text[] not null default '{}',
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- Разделы статей — единица поиска и цитирования
create table if not exists public.kb_chunks (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid not null,
  sort       integer not null default 0,
  heading    text not null,
  content    text not null,
  keywords   text not null default '',
  tsv        tsvector generated always as (
               setweight(to_tsvector('russian', coalesce(heading, '')), 'A') ||
               setweight(to_tsvector('russian', coalesce(keywords, '')), 'A') ||
               setweight(to_tsvector('russian', coalesce(content, '')), 'B')) stored,
  constraint kb_chunks_article_fk foreign key (article_id) references public.kb_articles (id) on delete cascade
);
create index if not exists kb_chunks_tsv_idx on public.kb_chunks using gin (tsv);
create index if not exists kb_chunks_article_idx on public.kb_chunks (article_id, sort);

create table if not exists public.ai_queries (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  question    text not null,
  answer      text,
  status      text not null check (status in ('answered', 'personal', 'no_answer', 'refused')),
  mode        text not null default 'kb' check (mode in ('kb', 'llm')),
  sources     jsonb not null default '[]'::jsonb,
  helpful     boolean,
  created_at  timestamptz not null default now(),
  constraint ai_queries_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade
);
create index if not exists ai_queries_created_idx on public.ai_queries (created_at desc);

-- Обращения в HR (эскалация, когда у AI Jana нет надёжного ответа)
create table if not exists public.hr_tickets (
  id          uuid primary key default gen_random_uuid(),
  number      bigint generated always as identity (start with 501),
  employee_id uuid not null,
  question    text not null,
  ai_query_id uuid,
  status      text not null default 'open' check (status in ('open', 'answered', 'closed')),
  answer      text,
  answered_by uuid,
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  constraint hr_tickets_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade,
  constraint hr_tickets_query_fk    foreign key (ai_query_id) references public.ai_queries (id) on delete set null,
  constraint hr_tickets_answered_fk foreign key (answered_by) references public.employees (id) on delete set null
);

-- ---------- Задачи ----------

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  number       bigint generated always as identity (start with 101),
  title        text not null,
  description  text,
  assignee_id  uuid not null,
  created_by   uuid,
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done')),
  category     text not null default 'general'
               check (category in ('general', 'logistics', 'warehouse', 'delivery', 'client', 'hr', 'it', 'training')),
  due_date     date,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint tasks_assignee_fk foreign key (assignee_id) references public.employees (id) on delete cascade,
  constraint tasks_creator_fk  foreign key (created_by)  references public.employees (id) on delete set null
);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id, status);

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  author_id  uuid,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint task_comments_task_fk   foreign key (task_id)   references public.tasks (id) on delete cascade,
  constraint task_comments_author_fk foreign key (author_id) references public.employees (id) on delete set null
);

-- ---------- Объявления ----------

create table if not exists public.announcements (
  id                     uuid primary key default gen_random_uuid(),
  title                  text not null,
  body                   text not null,
  category               text not null default 'news'
                         check (category in ('news', 'logistics', 'hr', 'event', 'urgent')),
  pinned                 boolean not null default false,
  audience_department_id uuid,
  author_id              uuid,
  created_at             timestamptz not null default now(),
  constraint announcements_author_fk     foreign key (author_id) references public.employees (id) on delete set null,
  constraint announcements_department_fk foreign key (audience_department_id) references public.departments (id) on delete set null
);

create table if not exists public.announcement_reads (
  announcement_id uuid not null,
  employee_id     uuid not null,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, employee_id),
  constraint announcement_reads_announcement_fk foreign key (announcement_id) references public.announcements (id) on delete cascade,
  constraint announcement_reads_employee_fk     foreign key (employee_id)     references public.employees (id) on delete cascade
);

-- ---------- HR-мониторинг: «Слежу» и напоминания ----------

-- Персональный список наблюдения HR: о заявках, курсах и просрочках этих людей HR получает уведомления
create table if not exists public.watchlist (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  added_by    uuid not null,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint watchlist_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade,
  constraint watchlist_added_by_fk foreign key (added_by)    references public.employees (id) on delete cascade,
  constraint watchlist_unique unique (employee_id, added_by)
);

-- Отправленные напоминания из «Зоны внимания» (чтобы не дублировать и показывать «напомнили N ч назад»)
create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('vacation', 'course', 'nudge', 'onboarding', 'custom')),
  employee_id uuid not null,
  ref_id      uuid,
  sent_by     uuid,
  created_at  timestamptz not null default now(),
  constraint reminders_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade,
  constraint reminders_sent_by_fk  foreign key (sent_by)     references public.employees (id) on delete set null
);
create index if not exists reminders_lookup_idx on public.reminders (kind, employee_id, ref_id, created_at desc);

-- ---------- Операционные показатели (логистика) ----------

create table if not exists public.logistics_daily (
  id                 uuid primary key default gen_random_uuid(),
  day                date not null,
  location_id        uuid not null,
  parcels_in         integer not null default 0,
  parcels_processed  integer not null default 0,
  parcels_delivered  integer not null default 0,
  delivered_on_time  integer not null default 0,
  errors             integer not null default 0,
  staff_on_shift     integer not null default 0,
  constraint logistics_daily_location_fk foreign key (location_id) references public.locations (id) on delete cascade,
  constraint logistics_daily_unique unique (day, location_id)
);

-- ---------- Интеграции (transactional outbox + журнал) ----------

create table if not exists public.integration_events (
  id           uuid primary key default gen_random_uuid(),
  system       text not null check (system in ('1c_zup', 'documentolog')),
  direction    text not null check (direction in ('outbound', 'inbound')),
  entity       text not null,
  entity_id    uuid,
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'error')),
  external_id  text,
  response     jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists integration_events_status_idx on public.integration_events (status, created_at);

-- ---------- Журнал изменений ----------

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_id  uuid,
  action     text not null,
  changed_by uuid,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
