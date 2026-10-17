-- =====================================================================
-- JanaMen — полная установка базы данных (схема + RLS + функции + демо-данные)
--
-- Сгенерировано scripts/build-setup-sql.mjs — не редактируйте вручную,
-- правьте файлы в supabase/migrations и supabase/seed.sql.
--
-- Как применить: Supabase Dashboard → SQL Editor → New query → вставить
-- файл целиком → Run. Скрипт можно запускать повторно: схема обновится,
-- демо-данные пересоздадутся (тестовые аккаунты *@jana.test, пароль Jana2026!).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- migration: 20261016100000_schema.sql
-- ─────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────
-- migration: 20261016100100_security.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================================
-- JanaMen — 2/7. Ролевая модель и безопасность
-- Роли: employee (работник), manager (руководитель), hr (HR/администратор).
-- Ограничения работают на уровне БД (RLS), а не только в интерфейсе.
-- =====================================================================

-- ---------- Контекст текущего пользователя ----------

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.employees e
  where e.user_id = auth.uid() and e.status <> 'terminated'
  limit 1
$$;

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.role from public.employees e where e.user_id = auth.uid() and e.status <> 'terminated' limit 1),
    'guest')
$$;

create or replace function public.current_department_id()
returns uuid language sql stable security definer set search_path = public as $$
  select e.department_id from public.employees e where e.user_id = auth.uid() limit 1
$$;

create or replace function public.is_hr()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.user_id = auth.uid() and e.status <> 'terminated' and e.role = 'hr')
$$;

-- Прямой или непрямой руководитель сотрудника
create or replace function public.is_manager_of(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive chain (id, manager_id, depth) as (
    select e.id, e.manager_id, 1 from public.employees e where e.id = target
    union all
    select e.id, e.manager_id, c.depth + 1
    from public.employees e join chain c on e.id = c.manager_id
    where c.depth < 15
  )
  select target is not null and exists (
    select 1 from chain where chain.manager_id = public.current_employee_id())
$$;

create or replace function public.subordinate_ids(p_manager uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with recursive tree (id, depth) as (
    select e.id, 1 from public.employees e where e.manager_id = p_manager
    union all
    select e.id, t.depth + 1 from public.employees e join tree t on e.manager_id = t.id where t.depth < 15
  )
  select id from tree
$$;

-- Кого видит пользователь в аналитике: HR — всех, руководитель — свою команду, работник — себя
create or replace function public.visible_employee_ids()
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id();
begin
  if v_me is null then
    return;
  elsif public.is_hr() then
    return query select e.id from public.employees e;
  else
    return query select v_me union select public.subordinate_ids(v_me);
  end if;
end $$;

-- Вызов пришёл через API (PostgREST/RPC), а не из SQL-редактора/сидов
create or replace function public.in_request_context()
returns boolean language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true), '') <> ''
      or coalesce(current_setting('request.jwt.claim.role', true), '') <> ''
$$;

-- ---------- Общие триггеры ----------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['employees', 'employee_private', 'requests', 'tasks'] loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Официальные кадровые данные — только чтение. Даже HR меняет в JanaMen лишь
-- роль доступа; остальное приходит из 1С:ЗУП (функция sync_from_zup).
create or replace function public.guard_employee_update()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    if (new.user_id, new.zup_id, new.company, new.first_name, new.last_name, new.middle_name, new.email,
        new.position, new.department_id, new.location_id, new.manager_id, new.employment_type, new.status,
        new.hire_date, new.vacation_days_per_year, new.vacation_carryover)
       is distinct from
       (old.user_id, old.zup_id, old.company, old.first_name, old.last_name, old.middle_name, old.email,
        old.position, old.department_id, old.location_id, old.manager_id, old.employment_type, old.status,
        old.hire_date, old.vacation_days_per_year, old.vacation_carryover) then
      raise exception 'Официальные кадровые данные меняются только через 1С:ЗУП. Оформите заявку «Изменение данных».'
        using errcode = '42501';
    end if;
    if new.role is distinct from old.role and not public.is_hr() then
      raise exception 'Роль доступа может менять только HR' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_employees_guard on public.employees;
create trigger trg_employees_guard before update on public.employees
  for each row execute function public.guard_employee_update();

create or replace function public.guard_employee_private_update()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated'
     and (new.iin, new.salary, new.birth_date, new.employee_id) is distinct from
         (old.iin, old.salary, old.birth_date, old.employee_id) then
    raise exception 'ИИН, дата рождения и оклад меняются только через 1С:ЗУП' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_employee_private_guard on public.employee_private;
create trigger trg_employee_private_guard before update on public.employee_private
  for each row execute function public.guard_employee_private_update();

-- Журнал изменений карточек
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_row jsonb := to_jsonb(coalesce(new, old));
begin
  v_id := coalesce(v_row ->> 'id', v_row ->> 'employee_id')::uuid;
  insert into public.audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  values (tg_table_name, v_id, tg_op, public.current_employee_id(),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
drop trigger if exists trg_employees_audit on public.employees;
create trigger trg_employees_audit after update or delete on public.employees
  for each row execute function public.audit_row();
drop trigger if exists trg_employee_private_audit on public.employee_private;
create trigger trg_employee_private_audit after update or delete on public.employee_private
  for each row execute function public.audit_row();

-- ---------- Права на таблицы ----------

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.audit_log, public.integration_events, public.course_answer_keys, public.reminders
  from authenticated;

-- ---------- RLS ----------

do $$
declare t text;
begin
  foreach t in array array[
    'locations', 'departments', 'employees', 'employee_private', 'requests', 'request_events', 'holidays',
    'notifications', 'courses', 'course_lessons', 'course_questions', 'course_answer_keys', 'course_assignments',
    'lesson_progress', 'course_attempts', 'kb_articles', 'kb_chunks', 'ai_queries', 'hr_tickets', 'tasks',
    'task_comments', 'announcements', 'announcement_reads', 'watchlist', 'reminders', 'logistics_daily',
    'integration_events', 'audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Пересоздаём политики (миграцию можно применять повторно)
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'locations', 'departments', 'employees', 'employee_private', 'requests', 'request_events', 'holidays',
        'notifications', 'courses', 'course_lessons', 'course_questions', 'course_answer_keys', 'course_assignments',
        'lesson_progress', 'course_attempts', 'kb_articles', 'kb_chunks', 'ai_queries', 'hr_tickets', 'tasks',
        'task_comments', 'announcements', 'announcement_reads', 'watchlist', 'reminders', 'logistics_daily',
        'integration_events', 'audit_log'])
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Справочники: читают все сотрудники, меняет HR
do $$
declare t text;
begin
  foreach t in array array['locations', 'departments', 'holidays', 'courses', 'course_lessons', 'course_questions'] loop
    execute format('create policy "%1$s_select" on public.%1$s for select to authenticated
                    using ((select public.current_employee_id()) is not null)', t);
    execute format('create policy "%1$s_hr_write" on public.%1$s for all to authenticated
                    using ((select public.is_hr())) with check ((select public.is_hr()))', t);
  end loop;
end $$;

-- Сотрудники: рабочий профиль коллег виден всем (ФИО, должность, подразделение, рабочие контакты).
-- Персональные данные лежат отдельно — в employee_private.
create policy employees_select on public.employees for select to authenticated
  using ((select public.current_employee_id()) is not null);
create policy employees_update on public.employees for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));

create policy employee_private_select on public.employee_private for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy employee_private_update on public.employee_private for update to authenticated
  using (employee_id = (select public.current_employee_id()) or (select public.is_hr()))
  with check (employee_id = (select public.current_employee_id()) or (select public.is_hr()));

-- Заявки: свои; руководитель — только своей команды; HR — все. Изменения — только через RPC.
create policy requests_select on public.requests for select to authenticated
  using (employee_id = (select public.current_employee_id())
         or (select public.is_hr())
         or public.is_manager_of(employee_id));
create policy requests_insert on public.requests for insert to authenticated
  with check (employee_id = (select public.current_employee_id()));

create policy request_events_select on public.request_events for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id));

-- Уведомления — только свои
create policy notifications_select on public.notifications for select to authenticated
  using (employee_id = (select public.current_employee_id()));
create policy notifications_update on public.notifications for update to authenticated
  using (employee_id = (select public.current_employee_id()))
  with check (employee_id = (select public.current_employee_id()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (employee_id = (select public.current_employee_id()));

-- Jana Academy
create policy course_assignments_select on public.course_assignments for select to authenticated
  using (employee_id = (select public.current_employee_id())
         or (select public.is_hr())
         or public.is_manager_of(employee_id));
create policy course_assignments_insert on public.course_assignments for insert to authenticated
  with check (employee_id = (select public.current_employee_id())
              or (select public.is_hr())
              or public.is_manager_of(employee_id));
create policy course_assignments_delete on public.course_assignments for delete to authenticated
  using ((select public.is_hr()));

create policy lesson_progress_select on public.lesson_progress for select to authenticated
  using (employee_id = (select public.current_employee_id())
         or (select public.is_hr())
         or public.is_manager_of(employee_id));

create policy course_attempts_select on public.course_attempts for select to authenticated
  using (employee_id = (select public.current_employee_id())
         or (select public.is_hr())
         or public.is_manager_of(employee_id));

-- База знаний: часть статей только для руководителей / HR
create policy kb_articles_select on public.kb_articles for select to authenticated
  using ((select public.current_employee_id()) is not null
         and (visibility = 'all'
              or (visibility = 'manager' and (select public.current_app_role()) in ('manager', 'hr'))
              or (visibility = 'hr' and (select public.is_hr()))));
create policy kb_articles_hr_write on public.kb_articles for all to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));

create policy kb_chunks_select on public.kb_chunks for select to authenticated
  using (exists (select 1 from public.kb_articles a where a.id = article_id));
create policy kb_chunks_hr_write on public.kb_chunks for all to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));

-- Вопросы к AI Jana и обращения в HR
create policy ai_queries_select on public.ai_queries for select to authenticated
  using (employee_id = (select public.current_employee_id()) or (select public.is_hr()));
create policy ai_queries_insert on public.ai_queries for insert to authenticated
  with check (employee_id = (select public.current_employee_id()));
create policy ai_queries_update on public.ai_queries for update to authenticated
  using (employee_id = (select public.current_employee_id()))
  with check (employee_id = (select public.current_employee_id()));

create policy hr_tickets_select on public.hr_tickets for select to authenticated
  using (employee_id = (select public.current_employee_id()) or (select public.is_hr()));
create policy hr_tickets_insert on public.hr_tickets for insert to authenticated
  with check (employee_id = (select public.current_employee_id()));

-- Задачи
create policy tasks_select on public.tasks for select to authenticated
  using (assignee_id = (select public.current_employee_id())
         or created_by = (select public.current_employee_id())
         or (select public.is_hr())
         or public.is_manager_of(assignee_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (created_by = (select public.current_employee_id())
              and (assignee_id = (select public.current_employee_id())
                   or (select public.is_hr())
                   or public.is_manager_of(assignee_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (assignee_id = (select public.current_employee_id())
         or created_by = (select public.current_employee_id())
         or (select public.is_hr())
         or public.is_manager_of(assignee_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (created_by = (select public.current_employee_id()) or (select public.is_hr()));

create policy task_comments_select on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (author_id = (select public.current_employee_id())
              and exists (select 1 from public.tasks t where t.id = task_id));

-- Объявления: для всех или для конкретного подразделения
create policy announcements_select on public.announcements for select to authenticated
  using ((select public.current_employee_id()) is not null
         and (audience_department_id is null
              or audience_department_id = (select public.current_department_id())
              or author_id = (select public.current_employee_id())
              or (select public.is_hr())));
create policy announcements_insert on public.announcements for insert to authenticated
  with check ((select public.is_hr())
              or ((select public.current_app_role()) = 'manager'
                  and audience_department_id = (select public.current_department_id())));
create policy announcements_delete on public.announcements for delete to authenticated
  using ((select public.is_hr()) or author_id = (select public.current_employee_id()));

create policy announcement_reads_select on public.announcement_reads for select to authenticated
  using (employee_id = (select public.current_employee_id()) or (select public.is_hr()));
create policy announcement_reads_insert on public.announcement_reads for insert to authenticated
  with check (employee_id = (select public.current_employee_id()));

-- HR-мониторинг, логистика, интеграции, аудит — HR (руководитель видит логистику)
-- «Слежу» — личный список каждого HR
create policy watchlist_hr on public.watchlist for all to authenticated
  using ((select public.is_hr()) and added_by = (select public.current_employee_id()))
  with check ((select public.is_hr()) and added_by = (select public.current_employee_id()));
create policy reminders_select on public.reminders for select to authenticated
  using ((select public.current_app_role()) in ('manager', 'hr'));
create policy logistics_select on public.logistics_daily for select to authenticated
  using ((select public.current_app_role()) in ('manager', 'hr'));
create policy integration_events_select on public.integration_events for select to authenticated
  using ((select public.is_hr()));
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.is_hr()));
-- course_answer_keys: политик нет — недоступно никому через API

-- ─────────────────────────────────────────────────────────────────────
-- migration: 20261016100200_requests.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================================
-- JanaMen — 3/7. HR-заявки: «Отпуск», «Аванс», «Справка», «Изменение данных»
-- Маршрут: работник → руководитель (согласование) → HR (оформление в 1С:ЗУП /
-- Documentolog) → «Оформлено». Каждый шаг пишет историю и уведомление.
-- =====================================================================

-- ---------- Утилиты ----------

-- 150000 → «150 000»
create or replace function public.fmt_money(p numeric)
returns text language sql immutable as $$
  select replace(to_char(round(p), 'FM999,999,999,990'), ',', ' ')
$$;

-- ---------- Уведомления ----------

create or replace function public.notify(p_employee uuid, p_title text, p_body text, p_link text, p_kind text default 'info')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_employee is null then return; end if;
  insert into public.notifications (employee_id, title, body, link, kind)
  values (p_employee, p_title, p_body, p_link, coalesce(p_kind, 'info'));
end $$;

create or replace function public.employee_name(p_employee uuid)
returns text language sql stable security definer set search_path = public as $$
  select trim(e.first_name || ' ' || e.last_name) from public.employees e where e.id = p_employee
$$;

create or replace function public.mark_all_notifications_read()
returns void language sql security definer set search_path = public as $$
  update public.notifications set read_at = now()
  where employee_id = public.current_employee_id() and read_at is null
$$;

-- Уведомить HR, которые «следят» за сотрудником (кроме автора действия)
create or replace function public.notify_followers(p_employee uuid, p_title text, p_body text, p_link text, p_kind text default 'info')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (employee_id, title, body, link, kind)
  select w.added_by, '👁 ' || public.employee_name(p_employee) || ': ' || p_title, p_body, p_link, coalesce(p_kind, 'info')
  from public.watchlist w
  where w.employee_id = p_employee
    and w.added_by is distinct from public.current_employee_id()
    and w.added_by <> p_employee;
end $$;

-- ---------- Привязка аккаунта к карточке сотрудника по email ----------

-- Учётная запись привязывается к карточке сотрудника из 1С:ЗУП по рабочей почте и только
-- после её подтверждения: иначе регистрация с чужим адресом позволила бы «занять» карточку.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null then
    update public.employees set user_id = new.id
    where lower(email) = lower(new.email) and user_id is null;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Отпуск: календарь и баланс ----------

-- Отпуск считается в календарных днях; праздничные дни РК не включаются
create or replace function public.count_vacation_days(p_start date, p_end date)
returns numeric language sql stable set search_path = public as $$
  select case when p_start is null or p_end is null or p_end < p_start then null else (
    select count(*)::numeric from generate_series(p_start, p_end, interval '1 day') d
    where not exists (select 1 from public.holidays h where h.day = d::date)) end
$$;

-- entitled = положено за год (пропорционально для принятых в этом году) + перенос с прошлого года
drop function if exists public.vacation_balance(uuid, integer);
create or replace function public.vacation_balance(p_employee uuid default null, p_year integer default null)
returns table (year integer, entitled numeric, used numeric, reserved numeric, available numeric, carryover numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_target uuid := coalesce(p_employee, public.current_employee_id());
  v_year integer := coalesce(p_year, extract(year from current_date)::integer);
  v_factor numeric := 1;
begin
  if v_target is null then raise exception 'Сотрудник не найден'; end if;
  if public.in_request_context()
     and v_target is distinct from public.current_employee_id()
     and not public.is_hr() and not public.is_manager_of(v_target) then
    raise exception 'Нет доступа к балансу отпуска другого сотрудника' using errcode = '42501';
  end if;

  select * into v_emp from public.employees e where e.id = v_target;
  if extract(year from v_emp.hire_date) = v_year then
    v_factor := (12 - extract(month from v_emp.hire_date) + 1) / 12.0;
  elsif extract(year from v_emp.hire_date) > v_year then
    v_factor := 0;
  end if;

  year := v_year;
  carryover := case when v_year = extract(year from current_date) then v_emp.vacation_carryover else 0 end;
  entitled := round(v_emp.vacation_days_per_year * v_factor, 1) + carryover;
  select coalesce(sum(r.days), 0) into used from public.requests r
   where r.employee_id = v_target and r.type = 'vacation' and r.status = 'done'
     and extract(year from r.start_date) = v_year;
  select coalesce(sum(r.days), 0) into reserved from public.requests r
   where r.employee_id = v_target and r.type = 'vacation' and r.status in ('pending', 'approved', 'processing')
     and extract(year from r.start_date) = v_year;
  available := entitled - used - reserved;
  return next;
end $$;

-- ---------- Справочники статусов ----------

create or replace function public.request_type_label(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'vacation' then 'Отпуск'
    when 'advance' then 'Аванс'
    when 'certificate' then 'Справка с места работы'
    when 'data_change' then 'Изменение данных'
    else 'Заявка' end
$$;

create or replace function public.default_hr_approver(p_exclude uuid default null)
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.employees e
  where e.role = 'hr' and e.status <> 'terminated' and e.id is distinct from p_exclude
  order by e.hire_date
  limit 1
$$;

create or replace function public.log_request_event(p_request uuid, p_action text, p_status text, p_actor uuid, p_comment text)
returns void language sql security definer set search_path = public as $$
  insert into public.request_events (request_id, action, status, actor_id, comment)
  values (p_request, p_action, p_status, p_actor, nullif(trim(p_comment), ''))
$$;

-- ---------- Создание заявки: валидация на стороне БД ----------
-- Не SECURITY DEFINER: проверки должны видеть, что вставка пришла из API.

create or replace function public.requests_before_insert()
returns trigger language plpgsql set search_path = public as $$
declare
  v_emp public.employees;
  v_salary numeric;
  v_balance record;
  v_conflict record;
  v_is_api boolean := current_user = 'authenticated';
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if v_emp.id is null then raise exception 'Сотрудник не найден'; end if;

  if v_is_api then
    new.status := 'pending';
    new.integration := '{}'::jsonb;
  end if;

  if new.type = 'vacation' then
    if new.start_date is null or new.end_date is null then
      raise exception 'Укажите даты отпуска';
    end if;
    if new.end_date < new.start_date then
      raise exception 'Дата окончания раньше даты начала';
    end if;
    new.days := public.count_vacation_days(new.start_date, new.end_date);
    if coalesce(new.days, 0) < 1 then
      raise exception 'В выбранном периоде только праздничные дни';
    end if;
    if v_is_api then
      if new.start_date < current_date then
        raise exception 'Нельзя оформить отпуск задним числом';
      end if;
      if new.start_date > current_date + 365 then
        raise exception 'Отпуск можно запланировать не более чем на год вперёд';
      end if;
      select r.number, r.start_date, r.end_date into v_conflict
      from public.requests r
      where r.employee_id = new.employee_id and r.type = 'vacation'
        and r.status in ('pending', 'approved', 'processing', 'done')
        and daterange(r.start_date, r.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
      limit 1;
      if v_conflict.number is not null then
        raise exception 'Даты пересекаются с заявкой №% (% – %)', v_conflict.number,
          to_char(v_conflict.start_date, 'DD.MM.YYYY'), to_char(v_conflict.end_date, 'DD.MM.YYYY');
      end if;
      select * into v_balance from public.vacation_balance(new.employee_id, extract(year from new.start_date)::integer);
      if new.days > v_balance.available then
        raise exception 'Недостаточно дней отпуска: доступно %, запрошено %', v_balance.available, new.days;
      end if;
    end if;

  elsif new.type = 'advance' then
    new.start_date := null;
    new.end_date := null;
    if new.amount is null or new.amount <= 0 then
      raise exception 'Укажите сумму аванса';
    end if;
    if v_is_api then
      select p.salary into v_salary from public.employee_private p where p.employee_id = new.employee_id;
      if v_salary is not null and new.amount > round(v_salary * 0.5) then
        raise exception 'Аванс не может превышать 50%% оклада, максимум % ₸',
          public.fmt_money(v_salary * 0.5);
      end if;
      if exists (select 1 from public.requests r
                 where r.employee_id = new.employee_id and r.type = 'advance'
                   and r.status in ('pending', 'approved', 'processing', 'done')
                   and date_trunc('month', r.created_at) = date_trunc('month', now())) then
        raise exception 'Аванс можно запросить один раз в месяц, заявка в этом месяце уже есть';
      end if;
    end if;

  elsif new.type = 'certificate' then
    new.details := jsonb_build_object(
      'purpose', coalesce(new.details ->> 'purpose', 'По месту требования'),
      'language', coalesce(new.details ->> 'language', 'ru'),
      'copies', coalesce((new.details ->> 'copies')::int, 1));

  elsif new.type = 'data_change' then
    if coalesce(new.details ->> 'field', '') = '' or coalesce(new.details ->> 'new_value', '') = '' then
      raise exception 'Укажите, какие данные изменить и новое значение';
    end if;
  end if;

  -- Первый согласующий: руководитель (отпуск, аванс) или сразу HR (справки, изменение данных)
  if new.approver_id is null or v_is_api then
    if new.type in ('vacation', 'advance') and v_emp.manager_id is not null then
      new.approver_id := v_emp.manager_id;
    else
      new.approver_id := public.default_hr_approver(new.employee_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_requests_before_insert on public.requests;
create trigger trg_requests_before_insert before insert on public.requests
  for each row execute function public.requests_before_insert();

create or replace function public.requests_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_request_event(new.id, 'created', new.status, new.employee_id, new.comment);
  if new.status = 'pending' and new.approver_id is not null and new.approver_id <> new.employee_id then
    perform public.notify(new.approver_id,
      'Новая заявка: ' || public.request_type_label(new.type),
      public.employee_name(new.employee_id) || ' · №' || new.number
        || case when new.type = 'advance' then ' · ' || public.fmt_money(new.amount) || ' ₸'
                when new.type = 'vacation'
                  then ' · ' || to_char(new.start_date, 'DD.MM') || '–' || to_char(new.end_date, 'DD.MM.YYYY')
                       || ' (' || new.days || ' дн.)'
                else '' end,
      '/approvals', 'request');
  end if;
  perform public.notify_followers(new.employee_id, 'новая заявка «' || public.request_type_label(new.type) || '»',
    '№' || new.number, '/approvals', 'request');
  return new;
end $$;
drop trigger if exists trg_requests_after_insert on public.requests;
create trigger trg_requests_after_insert after insert on public.requests
  for each row execute function public.requests_after_insert();

-- ---------- Решения по заявке ----------
-- approve — руководитель согласует; process — HR оформляет (1С:ЗУП / Documentolog); reject — отказ

create or replace function public.decide_request(p_request_id uuid, p_action text, p_comment text default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_is_hr boolean := public.is_hr();
  r public.requests;
  v_emp public.employees;
  v_hr uuid;
begin
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  select * into v_emp from public.employees where id = r.employee_id;

  if v_me is null or not (v_is_hr or r.approver_id = v_me or public.is_manager_of(r.employee_id)) then
    raise exception 'Нет прав на эту заявку' using errcode = '42501';
  end if;
  if r.employee_id = v_me then
    raise exception 'Нельзя согласовать собственную заявку' using errcode = '42501';
  end if;

  if p_action = 'approve' then
    if r.status <> 'pending' then raise exception 'Заявка уже обработана'; end if;
    if r.type = 'vacation' and (select available from public.vacation_balance(r.employee_id, extract(year from r.start_date)::int)) < 0 then
      raise exception 'У сотрудника недостаточно дней отпуска';
    end if;
    v_hr := public.default_hr_approver(r.employee_id);
    update public.requests set status = 'approved', approver_id = v_hr where id = r.id returning * into r;
    perform public.log_request_event(r.id, 'approved', r.status, v_me, p_comment);
    perform public.notify(r.employee_id, 'Заявка №' || r.number || ' согласована',
      public.request_type_label(r.type) || ': согласовано руководителем, передано в HR на оформление', '/requests', 'success');
    perform public.notify_followers(r.employee_id, 'заявка №' || r.number || ' согласована руководителем',
      public.request_type_label(r.type), '/approvals', 'request');
    if v_hr is not null and v_hr <> v_me then
      perform public.notify(v_hr, 'Оформите заявку №' || r.number,
        public.employee_name(r.employee_id) || ' · ' || public.request_type_label(r.type) || ': согласовано руководителем',
        '/approvals', 'request');
    end if;

  elsif p_action = 'process' then
    if not v_is_hr then raise exception 'Оформление выполняет HR' using errcode = '42501'; end if;
    if not (r.status = 'approved'
            or (r.status = 'pending' and (r.type in ('certificate', 'data_change') or v_emp.manager_id is null
                                          or r.approver_id = v_me))) then
      raise exception 'Заявка ещё не согласована руководителем';
    end if;
    -- Передача во внешние системы: событие в outbox, ответ придёт асинхронно (этап «В 1С»)
    perform public.enqueue_request_integration(r.id);
    update public.requests set status = 'processing', approver_id = null where id = r.id returning * into r;
    perform public.log_request_event(r.id, 'processed', r.status, v_me,
      coalesce(nullif(trim(p_comment), ''), case when r.type = 'certificate' then 'Передано в Documentolog'
                                                 else 'Передано в 1С:ЗУП' end));
    perform public.notify(r.employee_id, 'Заявка №' || r.number || ' передана на оформление',
      public.request_type_label(r.type) || ': HR передал заявку в ' ||
      case when r.type = 'certificate' then 'Documentolog' else '1С:ЗУП' end, '/requests', 'info');

  elsif p_action = 'reject' then
    if r.status not in ('pending', 'approved') then raise exception 'Заявка уже закрыта'; end if;
    if coalesce(trim(p_comment), '') = '' then raise exception 'Укажите причину отказа'; end if;
    update public.requests set status = 'rejected' where id = r.id returning * into r;
    perform public.log_request_event(r.id, 'rejected', r.status, v_me, p_comment);
    perform public.notify(r.employee_id, 'Заявка №' || r.number || ' отклонена',
      public.request_type_label(r.type) || ': ' || p_comment, '/requests', 'warning');
    perform public.notify_followers(r.employee_id, 'заявка №' || r.number || ' отклонена', p_comment, '/approvals', 'warning');
  else
    raise exception 'Неизвестное действие: %', p_action;
  end if;
  return r;
end $$;

create or replace function public.cancel_request(p_request_id uuid, p_comment text default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.employee_id is distinct from public.current_employee_id() then
    raise exception 'Заявка не найдена' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'Оформленную или закрытую заявку отменить нельзя, обратитесь в HR';
  end if;
  update public.requests set status = 'cancelled' where id = r.id returning * into r;
  perform public.log_request_event(r.id, 'cancelled', r.status, r.employee_id, p_comment);
  if r.approver_id is not null then
    perform public.notify(r.approver_id, 'Заявка №' || r.number || ' отозвана',
      public.employee_name(r.employee_id) || ' отменил(а) заявку: ' || lower(public.request_type_label(r.type)),
      '/approvals', 'info');
  end if;
  return r;
end $$;

-- «Поторопить»: HR напоминает согласующему о зависшей заявке
create or replace function public.nudge_approver(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests; v_hours int;
begin
  if not public.is_hr() then raise exception 'Только для HR' using errcode = '42501'; end if;
  select * into r from public.requests where id = p_request_id;
  if r.id is null or r.status not in ('pending', 'approved') or r.approver_id is null then
    raise exception 'Заявка не ждёт решения';
  end if;
  v_hours := extract(epoch from now() - coalesce((select max(created_at) from public.request_events
                                                    where request_id = r.id and action <> 'nudged'), r.created_at)) / 3600;
  perform public.notify(r.approver_id, '⏰ Заявка №' || r.number || ' ждёт вашего решения',
    public.employee_name(r.employee_id) || ' · ' || public.request_type_label(r.type) || ': висит ' || v_hours
      || ' ч. HR просит рассмотреть сегодня', '/approvals', 'warning');
  perform public.log_request_event(r.id, 'nudged', null, public.current_employee_id(),
    'HR напомнил согласующему: ' || public.employee_name(r.approver_id));
  insert into public.reminders (kind, employee_id, ref_id, sent_by)
  values ('nudge', r.approver_id, r.id, public.current_employee_id());
end $$;

-- Кто из команды отсутствует (для руководителя и HR; коллеги видят только оформленные отпуска)
create or replace function public.team_absences(p_from date, p_to date)
returns table (request_id uuid, employee_id uuid, full_name text, job_title text, start_date date, end_date date,
               days numeric, status text)
language sql stable security definer set search_path = public as $$
  select r.id, r.employee_id, public.employee_name(r.employee_id), e.position, r.start_date, r.end_date, r.days, r.status
  from public.requests r
  join public.employees e on e.id = r.employee_id
  where public.current_employee_id() is not null
    and r.type = 'vacation'
    and r.status in ('pending', 'approved', 'processing', 'done')
    and r.start_date <= p_to and r.end_date >= p_from
    and (public.is_hr() or public.is_manager_of(r.employee_id) or r.employee_id = public.current_employee_id()
         or (r.status = 'done' and e.manager_id is not distinct from
               (select me.manager_id from public.employees me where me.id = public.current_employee_id())))
  order by r.start_date
$$;

-- ─────────────────────────────────────────────────────────────────────
-- migration: 20261016100300_academy_ai.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================================
-- JanaMen — 4/7. Jana Academy (LMS) и AI Jana (база знаний, эскалация в HR)
-- =====================================================================

-- ---------- Jana Academy ----------

create or replace function public.course_assignments_before()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and current_user = 'authenticated' then
    new.assigned_by := public.current_employee_id();
    new.status := 'assigned';
    new.progress := 0;
    new.score := null;
    new.attempts := 0;
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_course_assignments_before on public.course_assignments;
create trigger trg_course_assignments_before before insert on public.course_assignments
  for each row execute function public.course_assignments_before();

create or replace function public.course_assignments_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_course public.courses;
begin
  select * into v_course from public.courses where id = new.course_id;
  if new.assigned_by is distinct from new.employee_id then
    perform public.notify(new.employee_id, 'Назначен курс: ' || v_course.title,
      'Jana Academy' || coalesce(' · пройти до ' || to_char(new.due_date, 'DD.MM.YYYY'), ''),
      '/academy/' || v_course.slug, 'course');
    perform public.notify_followers(new.employee_id, 'назначен курс «' || v_course.title || '»',
      coalesce('до ' || to_char(new.due_date, 'DD.MM.YYYY'), ''), '/employees/' || new.employee_id, 'course');
  end if;
  return new;
end $$;
drop trigger if exists trg_course_assignments_notify on public.course_assignments;
create trigger trg_course_assignments_notify after insert on public.course_assignments
  for each row execute function public.course_assignments_notify();

-- Назначить курс (HR — любому, руководитель — своей команде)
create or replace function public.assign_course(p_course uuid, p_employees uuid[], p_due date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_count integer := 0; v_me uuid := public.current_employee_id();
begin
  if v_me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  foreach v_id in array p_employees loop
    if public.is_hr() or public.is_manager_of(v_id) then
      insert into public.course_assignments (course_id, employee_id, due_date, assigned_by)
      values (p_course, v_id, p_due, v_me)
      on conflict (course_id, employee_id) do nothing;
      if found then v_count := v_count + 1; end if;
    end if;
  end loop;
  return v_count;
end $$;

-- Прогресс = пройденные уроки + итоговый тест
create or replace function public.recalc_course_progress(p_course uuid, p_employee uuid)
returns public.course_assignments language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
  v_done integer;
  v_has_quiz boolean;
  a public.course_assignments;
begin
  select count(*) into v_total from public.course_lessons where course_id = p_course;
  select count(*) into v_done from public.lesson_progress lp
    join public.course_lessons l on l.id = lp.lesson_id
   where l.course_id = p_course and lp.employee_id = p_employee;
  select exists (select 1 from public.course_questions where course_id = p_course) into v_has_quiz;

  insert into public.course_assignments (course_id, employee_id, assigned_by, status, started_at)
  values (p_course, p_employee, p_employee, 'in_progress', now())
  on conflict (course_id, employee_id) do nothing;

  update public.course_assignments
     set progress = case when status = 'completed' then 100
                         else least(99, round(100.0 * v_done / greatest(1, v_total + case when v_has_quiz then 1 else 0 end)))::int end,
         status = case when status = 'completed' then 'completed' else 'in_progress' end,
         started_at = coalesce(started_at, now())
   where course_id = p_course and employee_id = p_employee
  returning * into a;

  -- Курс без теста завершается, когда пройдены все уроки
  if not v_has_quiz and v_done >= v_total and a.status <> 'completed' then
    update public.course_assignments set status = 'completed', progress = 100, completed_at = now()
     where id = a.id returning * into a;
  end if;
  return a;
end $$;

create or replace function public.complete_lesson(p_lesson uuid)
returns public.course_assignments language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_course uuid;
begin
  if v_me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select course_id into v_course from public.course_lessons where id = p_lesson;
  if v_course is null then raise exception 'Урок не найден'; end if;
  insert into public.lesson_progress (employee_id, lesson_id) values (v_me, p_lesson)
  on conflict do nothing;
  return public.recalc_course_progress(v_course, v_me);
end $$;

-- Итоговый тест: проверка на сервере, правильные ответы клиенту не отдаются
create or replace function public.submit_quiz(p_course uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_course public.courses;
  v_total integer;
  v_correct integer := 0;
  v_score integer;
  v_passed boolean;
  v_results jsonb := '[]'::jsonb;
  q record;
  v_given integer;
  a public.course_assignments;
begin
  if v_me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select * into v_course from public.courses where id = p_course;
  if v_course.id is null then raise exception 'Курс не найден'; end if;

  if exists (select 1 from public.course_lessons l where l.course_id = p_course
             and not exists (select 1 from public.lesson_progress lp where lp.lesson_id = l.id and lp.employee_id = v_me)) then
    raise exception 'Сначала изучите все уроки курса';
  end if;

  select count(*) into v_total from public.course_questions where course_id = p_course;
  for q in
    select cq.id, cq.explanation, k.correct_index
    from public.course_questions cq join public.course_answer_keys k on k.question_id = cq.id
    where cq.course_id = p_course order by cq.sort
  loop
    v_given := nullif(p_answers ->> q.id::text, '')::integer;
    if v_given = q.correct_index then v_correct := v_correct + 1; end if;
    v_results := v_results || jsonb_build_object(
      'question_id', q.id, 'correct', v_given = q.correct_index, 'explanation', q.explanation);
  end loop;

  v_score := case when v_total = 0 then 100 else round(100.0 * v_correct / v_total)::int end;
  v_passed := v_score >= v_course.pass_score;

  insert into public.course_attempts (course_id, employee_id, score, passed, answers)
  values (p_course, v_me, v_score, v_passed, p_answers);

  perform public.recalc_course_progress(p_course, v_me);
  update public.course_assignments
     set attempts = attempts + 1,
         score = greatest(coalesce(score, 0), v_score),
         status = case when v_passed then 'completed' else status end,
         progress = case when v_passed then 100 else progress end,
         completed_at = case when v_passed then coalesce(completed_at, now()) else completed_at end
   where course_id = p_course and employee_id = v_me
  returning * into a;

  perform public.notify_followers(v_me,
    case when v_passed then 'сдал(а) тест «' || v_course.title || '»' else 'не сдал(а) тест «' || v_course.title || '»' end,
    'Результат: ' || v_score || '%', '/employees/' || v_me, 'course');
  if v_passed then
    perform public.notify(v_me, 'Курс пройден: ' || v_course.title,
      'Результат теста: ' || v_score || '%. Сертификат доступен в Jana Academy', '/academy/' || v_course.slug, 'course');
    if a.assigned_by is not null and a.assigned_by <> v_me then
      perform public.notify(a.assigned_by, 'Курс завершён',
        public.employee_name(v_me) || ' прошёл(ла) «' || v_course.title || '»: ' || v_score || '%', '/academy', 'course');
    end if;
  end if;

  return jsonb_build_object('score', v_score, 'passed', v_passed, 'pass_score', v_course.pass_score,
                            'correct', v_correct, 'total', v_total, 'results', v_results,
                            'attempts', a.attempts);
end $$;

-- ---------- База знаний: поиск для AI Jana ----------
-- SECURITY INVOKER: RLS скрывает статьи, недоступные роли пользователя

create or replace function public.kb_search(p_query text, p_limit integer default 5)
returns table (chunk_id uuid, article_id uuid, slug text, title text, source_title text, heading text,
               content text, rank real, matched integer, total_terms integer)
language plpgsql stable set search_path = public, extensions as $$
declare
  v_terms text[];
  v_query tsquery;
begin
  select array_agg(distinct lexeme) into v_terms
  from unnest(to_tsvector('russian', coalesce(p_query, '')));
  if v_terms is null or array_length(v_terms, 1) is null then
    return;
  end if;
  -- лексемы уже нормализованы русским стеммером — собираем OR-запрос без повторного стемминга
  v_query := to_tsquery('simple', array_to_string(array(select quote_literal(t) from unnest(v_terms) t), ' | '));

  return query
  select c.id, a.id, a.slug, a.title, a.source_title, c.heading, c.content,
         (ts_rank_cd(c.tsv, v_query, 32) + 0.25 * similarity(a.title || ' ' || c.heading, p_query))::real as rank,
         (select count(*)::int from unnest(v_terms) t where t = any (tsvector_to_array(c.tsv))) as matched,
         array_length(v_terms, 1) as total_terms
  from public.kb_chunks c
  join public.kb_articles a on a.id = c.article_id
  where c.tsv @@ v_query
  order by matched desc, rank desc
  limit greatest(1, least(p_limit, 10));
end $$;

-- ---------- Контекст пользователя для AI Jana (только его собственные / разрешённые данные) ----------

create or replace function public.assistant_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_role text := public.current_app_role();
  e public.employees;
  v_result jsonb;
  v_balance record;
begin
  if v_me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select * into e from public.employees where id = v_me;
  select * into v_balance from public.vacation_balance(v_me);

  v_result := jsonb_build_object(
    'today', current_date,
    'role', v_role,
    'profile', jsonb_build_object(
      'full_name', trim(e.last_name || ' ' || e.first_name || ' ' || coalesce(e.middle_name, '')),
      'company', e.company,
      'position', e.position,
      'department', (select d.name from public.departments d where d.id = e.department_id),
      'manager', public.employee_name(e.manager_id),
      'hire_date', e.hire_date),
    'vacation', jsonb_build_object('year', v_balance.year, 'entitled', v_balance.entitled, 'used', v_balance.used,
                                   'reserved', v_balance.reserved, 'available', v_balance.available,
                                   'carryover_from_last_year', v_balance.carryover),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'number', r.number, 'type', public.request_type_label(r.type), 'status', r.status,
        'start_date', r.start_date, 'end_date', r.end_date, 'days', r.days, 'amount', r.amount,
        'created_at', r.created_at::date) order by r.created_at desc)
      from (select * from public.requests where employee_id = v_me order by created_at desc limit 5) r), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object(
        'title', c.title, 'status', ca.status, 'progress', ca.progress, 'score', ca.score, 'due_date', ca.due_date))
      from public.course_assignments ca join public.courses c on c.id = ca.course_id
      where ca.employee_id = v_me), '[]'::jsonb),
    'open_tasks', (select count(*) from public.tasks t where t.assignee_id = v_me and t.status <> 'done'),
    'unread_notifications', (select count(*) from public.notifications n where n.employee_id = v_me and n.read_at is null));

  if v_role in ('manager', 'hr') then
    v_result := v_result || jsonb_build_object('team', jsonb_build_object(
      'size', (select count(*) from public.subordinate_ids(v_me)),
      'pending_approvals', (select count(*) from public.requests r
                             where r.approver_id = v_me and r.status in ('pending', 'approved')),
      'on_vacation_today', coalesce((select jsonb_agg(public.employee_name(r.employee_id))
                             from public.requests r
                             where r.type = 'vacation' and r.status = 'done'
                               and current_date between r.start_date and r.end_date
                               and r.employee_id in (select public.subordinate_ids(v_me))), '[]'::jsonb)));
  end if;
  if v_role = 'hr' then
    v_result := v_result || jsonb_build_object('company', jsonb_build_object(
      'employees', (select count(*) from public.employees where status <> 'terminated'),
      'requests_in_work', (select count(*) from public.requests where status in ('pending', 'approved')),
      'open_tickets', (select count(*) from public.hr_tickets where status = 'open')));
  end if;
  return v_result;
end $$;

-- ---------- Обращения в HR ----------

create or replace function public.hr_tickets_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(public.default_hr_approver(new.employee_id), 'Новое обращение №' || new.number,
    public.employee_name(new.employee_id) || ': «' || left(new.question, 140) || '»', '/tickets', 'ticket');
  return new;
end $$;
drop trigger if exists trg_hr_tickets_after_insert on public.hr_tickets;
create trigger trg_hr_tickets_after_insert after insert on public.hr_tickets
  for each row execute function public.hr_tickets_after_insert();

create or replace function public.hr_tickets_before_insert()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.status := 'open';
    new.answer := null;
    new.answered_by := null;
    new.answered_at := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_hr_tickets_before_insert on public.hr_tickets;
create trigger trg_hr_tickets_before_insert before insert on public.hr_tickets
  for each row execute function public.hr_tickets_before_insert();

-- Ответ HR; при желании ответ сразу пополняет базу знаний AI Jana
create or replace function public.answer_ticket(p_ticket uuid, p_answer text, p_add_to_kb boolean default false,
                                                p_kb_title text default null)
returns public.hr_tickets language plpgsql security definer set search_path = public as $$
declare t public.hr_tickets; v_article uuid; v_slug text;
begin
  if not public.is_hr() then raise exception 'Отвечает HR' using errcode = '42501'; end if;
  if coalesce(trim(p_answer), '') = '' then raise exception 'Введите ответ'; end if;
  update public.hr_tickets
     set status = 'answered', answer = trim(p_answer), answered_by = public.current_employee_id(), answered_at = now()
   where id = p_ticket
  returning * into t;
  if t.id is null then raise exception 'Обращение не найдено'; end if;

  if p_add_to_kb then
    v_slug := 'faq-' || t.number;
    insert into public.kb_articles (slug, title, category, summary, content, source_title, keywords)
    values (v_slug, coalesce(nullif(trim(p_kb_title), ''), left(t.question, 120)), 'faq', left(trim(p_answer), 200),
            trim(p_answer), 'Ответ HR на обращение №' || t.number || ' от ' || to_char(now(), 'DD.MM.YYYY'), '{}')
    on conflict (slug) do update set content = excluded.content, summary = excluded.summary, updated_at = now()
    returning id into v_article;
    delete from public.kb_chunks where article_id = v_article;
    insert into public.kb_chunks (article_id, sort, heading, content, keywords)
    values (v_article, 0, coalesce(nullif(trim(p_kb_title), ''), left(t.question, 120)), trim(p_answer), t.question);
  end if;

  perform public.notify(t.employee_id, 'HR ответил на обращение №' || t.number, left(trim(p_answer), 160), '/assistant', 'ticket');
  return t;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- migration: 20261016100400_tasks_announcements.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================================
-- JanaMen — 5/7. Задачи и объявления
-- =====================================================================

-- ---------- Задачи ----------

create or replace function public.tasks_before_insert()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.created_by := public.current_employee_id();
  end if;
  if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
  if new.status = 'done' and new.completed_at is null then new.completed_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_tasks_before_insert on public.tasks;
create trigger trg_tasks_before_insert before insert on public.tasks
  for each row execute function public.tasks_before_insert();

-- Исполнитель меняет только статус; постановщик, руководитель и HR — всё
create or replace function public.guard_task_update()
returns trigger language plpgsql as $$
declare v_me uuid := public.current_employee_id();
begin
  if current_user = 'authenticated'
     and not (public.is_hr() or old.created_by = v_me or public.is_manager_of(old.assignee_id)) then
    if (new.title, new.description, new.assignee_id, new.created_by, new.priority, new.category, new.due_date)
       is distinct from
       (old.title, old.description, old.assignee_id, old.created_by, old.priority, old.category, old.due_date) then
      raise exception 'Исполнитель может менять только статус задачи' using errcode = '42501';
    end if;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
    new.completed_at := case when new.status = 'done' then now() end;
  end if;
  return new;
end $$;
drop trigger if exists trg_tasks_guard on public.tasks;
create trigger trg_tasks_guard before update on public.tasks
  for each row execute function public.guard_task_update();

create or replace function public.tasks_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id();
begin
  if tg_op = 'INSERT' then
    if new.created_by is distinct from new.assignee_id and new.status <> 'done' then
      perform public.notify(new.assignee_id, 'Новая задача №' || new.number, new.title
        || coalesce(' · до ' || to_char(new.due_date, 'DD.MM'), ''), '/tasks', 'task');
    end if;
  else
    if new.assignee_id is distinct from old.assignee_id then
      perform public.notify(new.assignee_id, 'Вам назначена задача №' || new.number, new.title, '/tasks', 'task');
    end if;
    if new.status is distinct from old.status and new.status in ('review', 'done')
       and new.created_by is not null and new.created_by is distinct from v_me then
      perform public.notify(new.created_by,
        'Задача №' || new.number || case when new.status = 'done' then ' выполнена' else ' на проверке' end,
        public.employee_name(new.assignee_id) || ': ' || new.title, '/tasks',
        case when new.status = 'done' then 'success' else 'task' end);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_tasks_notify on public.tasks;
create trigger trg_tasks_notify after insert or update on public.tasks
  for each row execute function public.tasks_notify();

-- Поставить задачу нескольким сотрудникам сразу
create or replace function public.assign_tasks(
  p_title text, p_description text, p_priority text, p_category text, p_due date, p_assignees uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_id uuid; v_count integer := 0;
begin
  if v_me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Укажите название задачи'; end if;
  foreach v_id in array coalesce(p_assignees, '{}') loop
    if v_id = v_me or public.is_hr() or public.is_manager_of(v_id) then
      insert into public.tasks (title, description, assignee_id, created_by, priority, category, due_date)
      values (trim(p_title), nullif(trim(p_description), ''), v_id, v_me,
              coalesce(p_priority, 'medium'), coalesce(p_category, 'general'), p_due);
      v_count := v_count + 1;
    end if;
  end loop;
  if v_count = 0 then raise exception 'Нет прав ставить задачи выбранным сотрудникам' using errcode = '42501'; end if;
  return v_count;
end $$;

-- ---------- Объявления ----------

create or replace function public.announcements_before_insert()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then new.author_id := public.current_employee_id(); end if;
  return new;
end $$;
drop trigger if exists trg_announcements_before_insert on public.announcements;
create trigger trg_announcements_before_insert before insert on public.announcements
  for each row execute function public.announcements_before_insert();

create or replace function public.announcements_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pinned or new.category = 'urgent' then
    insert into public.notifications (employee_id, title, body, link, kind)
    select e.id, case when new.category = 'urgent' then 'Срочное объявление' else 'Важное объявление' end,
           new.title, '/announcements', 'announcement'
    from public.employees e
    where e.status <> 'terminated' and e.id is distinct from new.author_id
      and (new.audience_department_id is null or e.department_id = new.audience_department_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_announcements_notify on public.announcements;
create trigger trg_announcements_notify after insert on public.announcements
  for each row execute function public.announcements_notify();

-- ─────────────────────────────────────────────────────────────────────
-- migration: 20261016100500_analytics.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================================
-- JanaMen — 6/7. «Пульс компании»: аналитика, зона внимания, прогнозы
-- HR видит всю компанию, руководитель — только свою команду (visible_employee_ids).
-- Прогнозы — тренд + сезонность по годовой истории; в интерфейсе подписаны как «прогноз».
-- =====================================================================

create or replace function public.require_analytics_access()
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[];
begin
  if public.current_app_role() not in ('manager', 'hr') then
    raise exception 'Аналитика доступна руководителю и HR' using errcode = '42501';
  end if;
  select array_agg(id) into v_ids from public.visible_employee_ids() id;
  return coalesce(v_ids, '{}');
end $$;

-- Дней отпуска, приходящихся на период [p_from, p_to]
create or replace function public.overlap_days(p_start date, p_end date, p_from date, p_to date)
returns integer language sql immutable as $$
  select greatest(0, least(p_end, p_to) - greatest(p_start, p_from) + 1)
$$;

-- ---------- Сотрудники: таблица для HR / руководителя ----------

create or replace function public.people_overview()
returns table (employee_id uuid, full_name text, job_title text, department_id uuid, department text, location text,
               role text, hire_date date, state text, vacation_available numeric,
               courses_assigned integer, courses_completed integer, courses_overdue integer, avg_score integer,
               open_tasks integer, overdue_tasks integer, requests_in_work integer, followed boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[] := public.require_analytics_access(); v_me uuid := public.current_employee_id();
begin
  return query
  select e.id,
         trim(e.last_name || ' ' || e.first_name),
         e.position,
         e.department_id,
         d.name,
         l.city,
         e.role,
         e.hire_date,
         case
           when exists (select 1 from public.requests r where r.employee_id = e.id and r.type = 'vacation'
                        and r.status in ('processing', 'done') and current_date between r.start_date and r.end_date) then 'vacation'
           when e.hire_date > current_date - 90 then 'newbie'
           else 'active' end,
         (select vb.available from public.vacation_balance(e.id) vb),
         (select count(*)::int from public.course_assignments ca where ca.employee_id = e.id),
         (select count(*)::int from public.course_assignments ca where ca.employee_id = e.id and ca.status = 'completed'),
         (select count(*)::int from public.course_assignments ca where ca.employee_id = e.id
           and ca.status <> 'completed' and ca.due_date < current_date),
         (select round(avg(ca.score))::int from public.course_assignments ca where ca.employee_id = e.id and ca.score is not null),
         (select count(*)::int from public.tasks t where t.assignee_id = e.id and t.status <> 'done'),
         (select count(*)::int from public.tasks t where t.assignee_id = e.id and t.status <> 'done' and t.due_date < current_date),
         (select count(*)::int from public.requests r where r.employee_id = e.id and r.status in ('pending', 'approved', 'processing')),
         exists (select 1 from public.watchlist w where w.employee_id = e.id and w.added_by = v_me)
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.locations l on l.id = e.location_id
  where e.id = any (v_ids) and e.status <> 'terminated' and e.id <> v_me
  order by e.last_name, e.first_name;
end $$;

-- ---------- KPI ----------

create or replace function public.hr_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[] := public.require_analytics_access();
  v_year int := extract(year from current_date)::int;
  v_result jsonb;
begin
  with emp as (
    select e.* from public.employees e where e.id = any (v_ids) and e.status <> 'terminated'
  ), req as (
    select r.* from public.requests r where r.employee_id = any (v_ids)
  ), bal as (
    select vb.* from emp, lateral public.vacation_balance(emp.id, v_year) vb
  ), mgr_stage as (
    select extract(epoch from ev.created_at - r.created_at) / 3600 as hours
    from req r
    join lateral (select min(x.created_at) as created_at from public.request_events x
                  where x.request_id = r.id and x.action in ('approved', 'rejected')) ev on ev.created_at is not null
    where r.created_at > now() - interval '90 days'
  ), ca as (
    select a.*, c.is_mandatory from public.course_assignments a join public.courses c on c.id = a.course_id
    where a.employee_id = any (v_ids)
  ), aq as (
    select q.* from public.ai_queries q where q.employee_id = any (v_ids) and q.created_at > now() - interval '30 days'
  ), tk as (
    select t.* from public.tasks t where t.assignee_id = any (v_ids)
  )
  select jsonb_build_object(
    'scope', case when public.is_hr() then 'company' else 'team' end,
    'as_of', now(),
    'headcount', (select count(*) from emp),
    'newcomers_90d', (select count(*) from emp where hire_date > current_date - 90),
    'on_vacation_today', (select count(distinct r.employee_id) from req r where r.type = 'vacation'
                          and r.status in ('processing', 'done') and current_date between r.start_date and r.end_date),
    'requests', jsonb_build_object(
      'in_work', (select count(*) from req where status in ('pending', 'approved', 'processing')),
      'at_manager', (select count(*) from req r where r.status = 'pending'
                       and not exists (select 1 from public.employees a where a.id = r.approver_id and a.role = 'hr')),
      'at_hr', (select count(*) from req r where r.status = 'approved'
                  or (r.status = 'pending' and exists (select 1 from public.employees a where a.id = r.approver_id and a.role = 'hr'))),
      'in_1c', (select count(*) from req where status = 'processing'),
      'done_30d', (select count(*) from req where status = 'done' and updated_at > now() - interval '30 days'),
      'created_30d', (select count(*) from req where created_at > now() - interval '30 days'),
      'approval_hours', (select round(avg(hours)::numeric, 1) from mgr_stage)),
    'vacation', jsonb_build_object(
      'entitled', (select coalesce(sum(entitled), 0) from bal),
      'used', (select coalesce(sum(used), 0) from bal),
      'reserved', (select coalesce(sum(reserved), 0) from bal),
      'available', (select coalesce(sum(available), 0) from bal),
      'usage_pct', (select case when sum(entitled) > 0 then round(100 * sum(used + reserved) / sum(entitled)) else 0 end from bal),
      'over_30', (select count(*) from bal where available > 30)),
    'learning', jsonb_build_object(
      'assigned', (select count(*) from ca),
      'completed', (select count(*) from ca where status = 'completed'),
      'mandatory_pct', (select case when count(*) filter (where is_mandatory) > 0
                          then round(100.0 * count(*) filter (where is_mandatory and status = 'completed') / count(*) filter (where is_mandatory))
                          else 0 end from ca),
      'avg_score', (select round(avg(score)) from ca where score is not null),
      'overdue', (select count(*) from ca where status <> 'completed' and due_date < current_date)),
    'ai', jsonb_build_object(
      'queries_30d', (select count(*) from aq),
      'no_answer_pct', (select case when count(*) > 0 then round(100.0 * count(*) filter (where status = 'no_answer') / count(*)) else 0 end from aq),
      'open_tickets', (select count(*) from public.hr_tickets t where t.employee_id = any (v_ids) and t.status = 'open')),
    'tasks', jsonb_build_object(
      'open', (select count(*) from tk where status <> 'done'),
      'overdue', (select count(*) from tk where status <> 'done' and due_date < current_date),
      'completion_pct', (select case when count(*) > 0 then round(100.0 * count(*) filter (where status = 'done') / count(*)) else 0 end from tk))
  ) into v_result;
  return v_result;
end $$;

-- ---------- Отпуска по месяцам: факт за 12 месяцев + прогноз на 3 ----------
-- Прогноз = max(уже запланировано, тот же месяц год назад × тренд последних 6 месяцев)

create or replace function public.vacation_monthly()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[] := public.require_analytics_access();
  v_cur date := date_trunc('month', current_date)::date;
  v_recent numeric; v_prev numeric; v_trend numeric;
  v_result jsonb;
begin
  -- тренд: последние 6 полных месяцев к тем же месяцам годом ранее
  select coalesce(sum(public.overlap_days(r.start_date, r.end_date, (v_cur - interval '6 months')::date, v_cur - 1)), 0),
         coalesce(sum(public.overlap_days(r.start_date, r.end_date, (v_cur - interval '18 months')::date,
                                          (v_cur - interval '12 months')::date - 1)), 0)
    into v_recent, v_prev
  from public.requests r
  where r.employee_id = any (v_ids) and r.type = 'vacation' and r.status = 'done';
  v_trend := case when v_prev > 0 then least(2, greatest(0.5, v_recent / v_prev)) else 1 end;

  with v as (
    select r.start_date, r.end_date, r.status from public.requests r
    where r.employee_id = any (v_ids) and r.type = 'vacation'
      and r.status in ('pending', 'approved', 'processing', 'done')
  )
  select jsonb_build_object(
    'trend', round(v_trend, 2),
    'months', jsonb_agg(jsonb_build_object(
      'key', to_char(m, 'YYYY-MM'),
      'label', (array['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'])[extract(month from m)::int]
               || ' ' || to_char(m, 'YY'),
      'actual', case when m <= v_cur then x.actual end,
      'planned', case when m >= v_cur then x.planned end,
      'forecast', case when m >= v_cur then greatest(x.planned, round(coalesce(x.last_year, 0) * v_trend)) end,
      'last_year', x.last_year) order by m))
  into v_result
  from generate_series(v_cur - interval '11 months', v_cur + interval '3 months', interval '1 month') m
  cross join lateral (
    select
      (select coalesce(sum(public.overlap_days(v.start_date, v.end_date, m::date, (m + interval '1 month')::date - 1)), 0)
         from v where v.status in ('processing', 'done')) as actual,
      (select coalesce(sum(public.overlap_days(v.start_date, v.end_date, m::date, (m + interval '1 month')::date - 1)), 0)
         from v) as planned,
      (select coalesce(sum(public.overlap_days(v.start_date, v.end_date, (m - interval '12 months')::date,
                                               (m - interval '11 months')::date - 1)), 0)
         from v where v.status = 'done') as last_year
  ) x;
  return v_result;
end $$;

-- ---------- Тепловая карта отпусков «месяц × отдел» (% сотрудников в отпуске) ----------

create or replace function public.vacation_heatmap(p_year integer default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[] := public.require_analytics_access(); v_year int := coalesce(p_year, extract(year from current_date)::int);
begin
  return (
    with dept as (
      select e.department_id, coalesce(d.name, 'Без подразделения') as department, count(*) as headcount
      from public.employees e left join public.departments d on d.id = e.department_id
      where e.id = any (v_ids) and e.status <> 'terminated'
      group by e.department_id, d.name
    ), vac as (
      select r.employee_id, e.department_id, r.start_date, r.end_date
      from public.requests r join public.employees e on e.id = r.employee_id
      where r.type = 'vacation' and r.status in ('pending', 'approved', 'processing', 'done')
        and e.id = any (v_ids) and e.status <> 'terminated'
    )
    select jsonb_build_object(
      'year', v_year,
      'months', jsonb_build_array('Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'),
      'rows', jsonb_agg(jsonb_build_object(
        'department', dept.department,
        'headcount', dept.headcount,
        'values', (select jsonb_agg(round(100.0 * (
                      select count(distinct vac.employee_id) from vac
                      where vac.department_id is not distinct from dept.department_id
                        and vac.start_date <= (make_date(v_year, mm, 1) + interval '1 month')::date - 1
                        and vac.end_date >= make_date(v_year, mm, 1)) / dept.headcount) order by mm)
                   from generate_series(1, 12) mm),
        'days', (select jsonb_agg((
                    select coalesce(sum(public.overlap_days(vac.start_date, vac.end_date, make_date(v_year, mm, 1),
                                                            (make_date(v_year, mm, 1) + interval '1 month')::date - 1)), 0)
                    from vac where vac.department_id is not distinct from dept.department_id) order by mm)
                 from generate_series(1, 12) mm)) order by dept.department))
    from dept);
end $$;

-- ---------- Обучение: воронка и прогноз даты 100% ----------

create or replace function public.learning_funnel(p_course uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[] := public.require_analytics_access();
begin
  return (
    with a as (
      select ca.*, (select count(*) from public.course_lessons l where l.course_id = ca.course_id) as lessons,
             (select count(*) from public.lesson_progress lp join public.course_lessons l on l.id = lp.lesson_id
               where l.course_id = ca.course_id and lp.employee_id = ca.employee_id) as lessons_done
      from public.course_assignments ca join public.courses c on c.id = ca.course_id
      where ca.employee_id = any (v_ids) and (p_course is null or ca.course_id = p_course)
        and (p_course is not null or c.is_mandatory)
    )
    select jsonb_build_object(
      'assigned', count(*),
      'started', count(*) filter (where status <> 'assigned' or lessons_done > 0),
      'lessons_done', count(*) filter (where lessons_done >= lessons and lessons > 0),
      'passed', count(*) filter (where status = 'completed'))
    from a);
end $$;

create or replace function public.learning_forecast()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[] := public.require_analytics_access();
  v_total int; v_done int; v_rate numeric; v_eta date;
begin
  select count(*), count(*) filter (where ca.status = 'completed') into v_total, v_done
  from public.course_assignments ca join public.courses c on c.id = ca.course_id
  where ca.employee_id = any (v_ids) and c.is_mandatory;

  -- темп: завершений в день за последние 28 дней
  select count(*) / 28.0 into v_rate
  from public.course_assignments ca join public.courses c on c.id = ca.course_id
  where ca.employee_id = any (v_ids) and c.is_mandatory and ca.completed_at > now() - interval '28 days';

  v_eta := case when v_total = v_done then current_date
                when v_rate > 0 then current_date + ceil((v_total - v_done) / v_rate)::int end;

  return jsonb_build_object(
    'total', v_total, 'completed', v_done,
    'pct', case when v_total > 0 then round(100.0 * v_done / v_total) else 0 end,
    'rate_per_week', round(coalesce(v_rate, 0) * 7, 1),
    'eta', v_eta,
    'series', (
      select jsonb_agg(jsonb_build_object(
        'day', to_char(d, 'DD.MM'),
        'actual', case when d <= current_date then (
            select round(100.0 * count(*) / greatest(1, v_total))
            from public.course_assignments ca join public.courses c on c.id = ca.course_id
            where ca.employee_id = any (v_ids) and c.is_mandatory and ca.completed_at::date <= d) end,
        'forecast', case when d >= current_date then
            least(100, round(100.0 * (v_done + coalesce(v_rate, 0) * (d - current_date)) / greatest(1, v_total))) end)
        order by d)
      from generate_series(current_date - 27, current_date + 28, interval '1 day') g(d0)
      cross join lateral (select g.d0::date as d) dd));
end $$;

-- ---------- Заявки: время на каждом этапе (поиск узкого места) ----------

create or replace function public.request_stage_times()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[] := public.require_analytics_access();
begin
  return (
    with r as (
      select q.id, q.created_at,
             (select min(created_at) from public.request_events e where e.request_id = q.id and e.action = 'approved') as approved_at,
             (select min(created_at) from public.request_events e where e.request_id = q.id and e.action = 'processed') as processed_at,
             (select min(created_at) from public.request_events e where e.request_id = q.id and e.action = 'completed') as completed_at,
             (select actor_id from public.request_events e where e.request_id = q.id and e.action = 'approved' limit 1) as manager_id
      from public.requests q
      where q.employee_id = any (v_ids) and q.created_at > now() - interval '120 days'
    ), stages as (
      select 'manager' as stage, extract(epoch from approved_at - created_at) / 3600 as hours from r where approved_at is not null
      union all
      select 'hr', extract(epoch from processed_at - coalesce(approved_at, created_at)) / 3600 from r where processed_at is not null
      union all
      select '1c', extract(epoch from completed_at - processed_at) / 3600 from r where completed_at is not null and processed_at is not null
    )
    select jsonb_build_object(
      'stages', (select jsonb_agg(t order by case t.stage when 'manager' then 1 when 'hr' then 2 else 3 end)
                 from (select s.stage, round(avg(hours)::numeric, 1) as avg_hours,
                              round(max(hours)::numeric, 1) as max_hours, count(*) as count
                       from stages s group by s.stage) t),
      'by_manager', (select jsonb_agg(t order by t.avg_hours desc) from (
                       select public.employee_name(manager_id) as manager, count(*) as count,
                              round(avg(extract(epoch from approved_at - created_at) / 3600)::numeric, 1) as avg_hours
                       from r where approved_at is not null group by manager_id) t)));
end $$;

-- ---------- AI Jana: что спрашивают и чего не хватает в базе знаний ----------

create or replace function public.ai_insights()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[] := public.require_analytics_access();
begin
  return (
    with q as (
      select * from public.ai_queries where employee_id = any (v_ids) and created_at > now() - interval '30 days'
    )
    select jsonb_build_object(
      'total', (select count(*) from q),
      'answered_pct', (select case when count(*) > 0 then round(100.0 * count(*) filter (where status in ('answered', 'personal')) / count(*)) else 0 end from q),
      'top_questions', (select coalesce(jsonb_agg(t order by t.count desc), '[]'::jsonb) from (
          select question, count(*) as count, max(status) as status from q group by question order by count(*) desc limit 8) t),
      'unanswered', (select coalesce(jsonb_agg(t order by t.count desc), '[]'::jsonb) from (
          select question, count(*) as count,
                 'Дописать положение: «' || rtrim(question, '?') || '»' as suggestion
          from q where status = 'no_answer' group by question order by count(*) desc limit 8) t),
      'top_sources', (select coalesce(jsonb_agg(t order by t.count desc), '[]'::jsonb) from (
          select a.title, a.slug, count(*) as count
          from q cross join lateral jsonb_array_elements(q.sources) s
          join public.kb_articles a on a.slug = s ->> 'slug'
          group by a.title, a.slug order by count(*) desc limit 6) t),
      'tickets_open', (select count(*) from public.hr_tickets where status = 'open' and employee_id = any (v_ids))));
end $$;

-- ---------- Графики для главной ----------

create or replace function public.hr_charts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[] := public.require_analytics_access();
begin
  return jsonb_build_object(
    'requests_weekly', (
      select jsonb_agg(jsonb_build_object(
        'week', to_char(gs, 'DD.MM'),
        'vacation', (select count(*) from public.requests r where r.employee_id = any (v_ids) and r.type = 'vacation'
                      and r.created_at >= gs and r.created_at < gs + interval '7 days'),
        'advance', (select count(*) from public.requests r where r.employee_id = any (v_ids) and r.type = 'advance'
                      and r.created_at >= gs and r.created_at < gs + interval '7 days'),
        'other', (select count(*) from public.requests r where r.employee_id = any (v_ids) and r.type in ('certificate', 'data_change')
                      and r.created_at >= gs and r.created_at < gs + interval '7 days')) order by gs)
      from generate_series(date_trunc('week', current_date) - interval '11 weeks', date_trunc('week', current_date), interval '1 week') gs),
    'vacation_monthly', public.vacation_monthly(),
    'learning_by_department', (
      select jsonb_agg(row_to_json(t)::jsonb order by t.pct)
      from (
        select coalesce(d.name, 'Без подразделения') as department, count(a.id) as assigned,
               count(a.id) filter (where a.status = 'completed') as completed,
               case when count(a.id) > 0 then round(100.0 * count(a.id) filter (where a.status = 'completed') / count(a.id)) else 0 end as pct
        from public.course_assignments a
        join public.courses c on c.id = a.course_id and c.is_mandatory
        join public.employees e on e.id = a.employee_id
        left join public.departments d on d.id = e.department_id
        where a.employee_id = any (v_ids)
        group by d.name) t),
    'headcount_by_department', (
      select jsonb_agg(t order by t.count desc)
      from (select coalesce(d.name, 'Без подразделения') as department, count(*) as count
            from public.employees e left join public.departments d on d.id = e.department_id
            where e.id = any (v_ids) and e.status <> 'terminated'
            group by d.name) t),
    'learning_by_course', (
      select jsonb_agg(t order by t.course)
      from (select c.title as course, count(a.id) as assigned,
                   count(a.id) filter (where a.status = 'assigned') as not_started,
                   count(a.id) filter (where a.status = 'in_progress') as in_progress,
                   count(a.id) filter (where a.status = 'completed') as completed,
                   round(avg(a.score)) as avg_score
            from public.courses c
            left join public.course_assignments a on a.course_id = c.id and a.employee_id = any (v_ids)
            group by c.id, c.title) t));
end $$;

-- ---------- «Зона внимания» — список с действием ----------

create or replace function public.attention_zone()
returns table (kind text, employee_id uuid, full_name text, department text, title text, details text,
               action text, ref_id uuid, severity text, last_reminded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[] := public.require_analytics_access(); v_me uuid := public.current_employee_id();
begin
  return query
  with emp as (
    select e.*, d.name as dept from public.employees e left join public.departments d on d.id = e.department_id
    where e.id = any (v_ids) and e.status <> 'terminated' and e.id <> v_me
  ), items as (
    -- Накоплено больше 30 дней отпуска
    select 'vacation'::text as kind, emp.id as emp_id, 'Накоплено ' || rtrim(to_char(vb.available, 'FM999990.9'), '.') || ' дн. отпуска' as title,
           'Риск выгорания и «сгорания» дней, предложите запланировать отпуск' as details,
           'remind_vacation'::text as action, null::uuid as ref, 'medium'::text as severity
    from emp cross join lateral public.vacation_balance(emp.id) vb
    where vb.available > 30
    union all
    -- Просроченный курс
    select 'course', emp.id, 'Просрочен курс «' || c.title || '»',
           'Срок был ' || to_char(a.due_date, 'DD.MM') || ' (' || (current_date - a.due_date) || ' дн. назад), прогресс ' || a.progress || '%',
           'remind_course', a.id, case when c.is_mandatory then 'high' else 'medium' end
    from emp join public.course_assignments a on a.employee_id = emp.id
    join public.courses c on c.id = a.course_id
    where a.status <> 'completed' and a.due_date < current_date
    union all
    -- Заявка висит у руководителя больше 48 часов
    select 'request', emp.id,
           'Заявка №' || r.number || ' висит у руководителя ' ||
             floor(extract(epoch from now() - r.created_at) / 3600)::int || ' ч',
           public.request_type_label(r.type) || ' · согласующий: ' || coalesce(public.employee_name(r.approver_id), '–'),
           'nudge', r.id, case when r.created_at < now() - interval '96 hours' then 'high' else 'medium' end
    from emp join public.requests r on r.employee_id = emp.id
    where r.status = 'pending' and r.created_at < now() - interval '48 hours'
      and not exists (select 1 from public.employees a where a.id = r.approver_id and a.role = 'hr')
    union all
    -- Новичок без онбординга
    select 'onboarding', emp.id, 'Новичок без онбординга',
           'В компании ' || (current_date - emp.hire_date) || ' дн., адаптационный курс не назначен',
           'assign_course', (select c.id from public.courses c where c.slug = 'welcome'), 'high'
    from emp
    where emp.hire_date > current_date - 60
      and not exists (select 1 from public.course_assignments a join public.courses c on c.id = a.course_id
                      where a.employee_id = emp.id and c.slug = 'welcome')
  )
  select i.kind, emp.id, trim(emp.last_name || ' ' || emp.first_name), emp.dept, i.title, i.details, i.action, i.ref, i.severity,
         (select max(rm.created_at) from public.reminders rm
           where rm.employee_id = case when i.action = 'nudge' then (select r.approver_id from public.requests r where r.id = i.ref) else emp.id end
             and rm.kind = case i.action when 'remind_vacation' then 'vacation' when 'remind_course' then 'course'
                                         when 'nudge' then 'nudge' else 'onboarding' end
             and rm.ref_id is not distinct from case when i.action = 'remind_vacation' then null else i.ref end)
  from items i join emp on emp.id = i.emp_id
  order by case i.severity when 'high' then 1 when 'medium' then 2 else 3 end, i.kind, emp.last_name;
end $$;

-- Действие из «Зоны внимания»
create or replace function public.attention_action(p_action text, p_employee uuid, p_ref uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_bal record; v_course public.courses; v_assignment public.course_assignments;
begin
  if not (public.is_hr() or public.is_manager_of(p_employee)) then
    raise exception 'Нет прав' using errcode = '42501';
  end if;

  if p_action = 'remind_vacation' then
    select * into v_bal from public.vacation_balance(p_employee);
    perform public.notify(p_employee, 'Запланируйте отпуск 🌴',
      'У вас накоплено ' || v_bal.available || ' дн. отпуска. Оформите заявку в JanaMen и подберите даты вместе с руководителем.',
      '/requests?new=vacation', 'warning');
    insert into public.reminders (kind, employee_id, ref_id, sent_by) values ('vacation', p_employee, null, v_me);
    return 'Напоминание об отпуске отправлено';

  elsif p_action = 'remind_course' then
    select * into v_assignment from public.course_assignments where id = p_ref;
    select * into v_course from public.courses where id = v_assignment.course_id;
    perform public.notify(p_employee, 'Напоминание: курс «' || v_course.title || '»',
      'Срок прохождения истёк ' || to_char(v_assignment.due_date, 'DD.MM.YYYY') || '. Пройдите курс в Jana Academy, это займёт около '
        || v_course.duration_minutes || ' минут.', '/academy/' || v_course.slug, 'warning');
    insert into public.reminders (kind, employee_id, ref_id, sent_by) values ('course', p_employee, p_ref, v_me);
    return 'Напоминание о курсе отправлено';

  elsif p_action = 'nudge' then
    perform public.nudge_approver(p_ref);
    return 'Руководителю отправлено напоминание';

  elsif p_action = 'assign_course' then
    select * into v_course from public.courses where id = coalesce(p_ref, (select id from public.courses where slug = 'welcome'));
    perform public.assign_course(v_course.id, array[p_employee], current_date + 7);
    insert into public.reminders (kind, employee_id, ref_id, sent_by) values ('onboarding', p_employee, v_course.id, v_me);
    return 'Курс «' || v_course.title || '» назначен';
  end if;
  raise exception 'Неизвестное действие %', p_action;
end $$;

-- Уведомления HR о просрочках у тех, за кем он «следит» (раз в день, вызывается при открытии кабинета)
create or replace function public.refresh_watch_alerts()
returns integer language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_count int := 0; x record;
begin
  if not public.is_hr() then return 0; end if;
  for x in
    select w.employee_id, 'просрочен курс «' || c.title || '»' as title, 'Срок: ' || to_char(a.due_date, 'DD.MM.YYYY') as body
    from public.watchlist w
    join public.course_assignments a on a.employee_id = w.employee_id and a.status <> 'completed' and a.due_date < current_date
    join public.courses c on c.id = a.course_id
    where w.added_by = v_me
    union all
    select w.employee_id, 'просрочена задача №' || t.number, t.title
    from public.watchlist w
    join public.tasks t on t.assignee_id = w.employee_id and t.status <> 'done' and t.due_date < current_date
    where w.added_by = v_me
  loop
    if not exists (select 1 from public.notifications n
                   where n.employee_id = v_me and n.created_at::date = current_date
                     and n.title = '👁 ' || public.employee_name(x.employee_id) || ': ' || x.title) then
      insert into public.notifications (employee_id, title, body, link, kind)
      values (v_me, '👁 ' || public.employee_name(x.employee_id) || ': ' || x.title, x.body, '/employees/' || x.employee_id, 'warning');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- ---------- Запросы AI Jana «по цифрам» (с учётом роли) ----------

create or replace function public.analytics_query(p_kind text, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[] := public.require_analytics_access();
  v_from date := coalesce((p_params ->> 'from')::date, current_date);
  v_to date := coalesce((p_params ->> 'to')::date, current_date);
  v_rows jsonb;
begin
  if p_kind = 'on_vacation' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', public.employee_name(r.employee_id), 'department', d.name,
             'start_date', r.start_date, 'end_date', r.end_date, 'days', r.days, 'status', r.status) order by r.start_date), '[]')
      into v_rows
    from public.requests r join public.employees e on e.id = r.employee_id
    left join public.departments d on d.id = e.department_id
    where r.employee_id = any (v_ids) and r.type = 'vacation' and r.status in ('approved', 'processing', 'done')
      and r.start_date <= v_to and r.end_date >= v_from;

  elsif p_kind = 'vacation_over' then
    select coalesce(jsonb_agg(jsonb_build_object('name', trim(e.last_name || ' ' || e.first_name), 'department', d.name,
                                                 'available', vb.available) order by vb.available desc), '[]')
      into v_rows
    from public.employees e left join public.departments d on d.id = e.department_id
    cross join lateral public.vacation_balance(e.id) vb
    where e.id = any (v_ids) and e.status <> 'terminated'
      and vb.available > coalesce((p_params ->> 'threshold')::numeric, 30);

  elsif p_kind = 'course_by_department' then
    select coalesce(jsonb_agg(t order by t.pct, t.department), '[]') into v_rows from (
      select coalesce(d.name, 'Без подразделения') as department, c.title as course, count(*) as assigned,
             count(*) filter (where a.status = 'completed') as completed,
             round(100.0 * count(*) filter (where a.status = 'completed') / count(*)) as pct,
             count(*) filter (where a.status <> 'completed' and a.due_date < current_date) as overdue
      from public.course_assignments a
      join public.courses c on c.id = a.course_id
      join public.employees e on e.id = a.employee_id
      left join public.departments d on d.id = e.department_id
      where a.employee_id = any (v_ids)
        and (coalesce(p_params ->> 'course', '') = '' or c.slug = p_params ->> 'course' or c.title ilike '%' || (p_params ->> 'course') || '%')
      group by d.name, c.title) t;

  elsif p_kind = 'requests_in_work' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'number', r.number, 'type', public.request_type_label(r.type), 'employee', public.employee_name(r.employee_id),
             'status', r.status, 'approver', public.employee_name(r.approver_id),
             'hours', floor(extract(epoch from now() - r.created_at) / 3600)) order by r.created_at), '[]')
      into v_rows
    from public.requests r where r.employee_id = any (v_ids) and r.status in ('pending', 'approved', 'processing');

  elsif p_kind = 'overdue_courses' then
    select coalesce(jsonb_agg(jsonb_build_object('name', public.employee_name(a.employee_id), 'course', c.title,
                                                 'due_date', a.due_date, 'progress', a.progress) order by a.due_date), '[]')
      into v_rows
    from public.course_assignments a join public.courses c on c.id = a.course_id
    where a.employee_id = any (v_ids) and a.status <> 'completed' and a.due_date < current_date;

  elsif p_kind = 'headcount' then
    select coalesce(jsonb_agg(jsonb_build_object('department', coalesce(d.name, 'Без подразделения'), 'count', n) order by n desc), '[]')
      into v_rows
    from (select e.department_id, count(*) as n from public.employees e
          where e.id = any (v_ids) and e.status <> 'terminated' group by e.department_id) x
    left join public.departments d on d.id = x.department_id;

  elsif p_kind = 'newcomers' then
    select coalesce(jsonb_agg(jsonb_build_object('name', trim(e.last_name || ' ' || e.first_name), 'position', e.position,
                                                 'hire_date', e.hire_date) order by e.hire_date desc), '[]')
      into v_rows
    from public.employees e where e.id = any (v_ids) and e.status <> 'terminated' and e.hire_date > current_date - 90;
  else
    raise exception 'Неизвестный запрос %', p_kind;
  end if;

  return jsonb_build_object('kind', p_kind, 'scope', case when public.is_hr() then 'company' else 'team' end,
                            'as_of', current_date, 'params', p_params, 'rows', v_rows);
end $$;

-- ---------- Логистика: нагрузка, прогноз и потребность в персонале ----------

create or replace function public.logistics_overview(p_days integer default 30, p_horizon integer default 45)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[] := public.require_analytics_access();
  v_slope numeric; v_intercept numeric; v_sd numeric;
  v_productivity numeric; v_staff numeric;
  v_result jsonb;
begin
  -- Модель: линейный тренд за 8 недель × индекс дня недели × сезонные события (11.11, Новый год)
  with s as (
    select day, sum(parcels_in)::numeric as y from public.logistics_daily
    where day >= current_date - 56 and day < current_date group by day
  )
  select regr_slope(y, day - (current_date - 56)), regr_intercept(y, day - (current_date - 56))
    into v_slope, v_intercept from s;

  with s as (
    select day, sum(parcels_in)::numeric as y from public.logistics_daily
    where day >= current_date - 56 and day < current_date group by day
  ), dow as (
    select extract(isodow from day) as d, avg(y / nullif(v_intercept + v_slope * (day - (current_date - 56)), 0)) as k
    from s group by 1
  )
  select stddev(s.y - (v_intercept + v_slope * (s.day - (current_date - 56))) * coalesce(dow.k, 1))
    into v_sd
  from s left join dow on dow.d = extract(isodow from s.day);

  select avg(processed::numeric / nullif(staff, 0)), avg(staff) into v_productivity, v_staff
  from (select day, sum(parcels_processed) as processed, sum(staff_on_shift) as staff
        from public.logistics_daily where day >= current_date - 28 and day < current_date group by day) x;

  with hist as (
    select day, sum(parcels_in) as parcels_in, sum(parcels_processed) as processed, sum(parcels_delivered) as delivered,
           sum(delivered_on_time) as on_time, sum(errors) as errors, sum(staff_on_shift) as staff
    from public.logistics_daily where day >= current_date - p_days and day < current_date group by day
  ), prev as (
    select sum(parcels_in) as parcels_in, sum(parcels_delivered) as delivered, sum(delivered_on_time) as on_time
    from public.logistics_daily where day >= current_date - 2 * p_days and day < current_date - p_days
  ), dow as (
    select extract(isodow from day) as d,
           avg(y / nullif(v_intercept + v_slope * (day - (current_date - 56)), 0)) as k
    from (select day, sum(parcels_in)::numeric as y from public.logistics_daily
          where day >= current_date - 56 and day < current_date group by day) z group by 1
  ), fc as (
    select gs::date as day,
           greatest(0, (v_intercept + v_slope * (gs::date - (current_date - 56))) * coalesce(dow.k, 1)
             * case when gs::date between make_date(extract(year from gs)::int, 11, 16) and make_date(extract(year from gs)::int, 11, 30) then 1.6
                    when gs::date between make_date(extract(year from gs)::int, 12, 10) and make_date(extract(year from gs)::int, 12, 28) then 1.3
                    else 1 end) as forecast
    from generate_series(current_date, current_date + p_horizon - 1, interval '1 day') gs
    left join dow on dow.d = extract(isodow from gs)
  ), shift as (
    -- обычная смена в этот день недели за 4 недели: сколько людей выходит и сколько посылок обрабатывает один человек
    select extract(isodow from day) as d, round(avg(staff)) as staff, avg(processed::numeric / nullif(staff, 0)) as productivity
    from (select day, sum(parcels_processed) as processed, sum(staff_on_shift) as staff from public.logistics_daily
          where day >= current_date - 28 and day < current_date group by day) z group by 1
  ), fc2 as (
    select fc.day, round(fc.forecast) as forecast,
           round(greatest(0, fc.forecast - 1.96 * coalesce(v_sd, 0))) as lower,
           round(fc.forecast + 1.96 * coalesce(v_sd, 0)) as upper,
           ceil(fc.forecast / nullif(coalesce(shift.productivity, v_productivity), 0)) as required_staff,
           coalesce(shift.staff, round(v_staff)) as usual_staff,
           (select count(distinct r.employee_id) from public.requests r
             join public.employees e on e.id = r.employee_id
             join public.departments d on d.id = e.department_id
            where r.type = 'vacation' and r.status in ('pending', 'approved', 'processing', 'done')
              and fc.day between r.start_date and r.end_date
              and d.name in ('Склад и сортировка', 'Курьерская доставка', 'Пункты выдачи')) as on_vacation
    from fc left join shift on shift.d = extract(isodow from fc.day)
  )
  select jsonb_build_object(
    'period_days', p_days,
    'totals', jsonb_build_object(
      'parcels_in', (select sum(parcels_in) from hist),
      'delivered', (select sum(delivered) from hist),
      'on_time_pct', (select round(100.0 * sum(on_time) / nullif(sum(delivered), 0), 1) from hist),
      'error_rate_pct', (select round(100.0 * sum(errors) / nullif(sum(processed), 0), 2) from hist),
      'plan_pct', (select round(100.0 * sum(processed) / nullif(sum(parcels_in), 0), 1) from hist),
      'parcels_change_pct', (select round(100.0 * ((select sum(parcels_in) from hist) - prev.parcels_in) / nullif(prev.parcels_in, 0), 1) from prev),
      'on_time_prev_pct', (select round(100.0 * prev.on_time / nullif(prev.delivered, 0), 1) from prev),
      'avg_staff', round(v_staff),
      'productivity', round(v_productivity)),
    'daily', (select jsonb_agg(jsonb_build_object(
                'day', to_char(day, 'DD.MM'), 'parcels_in', parcels_in, 'delivered', delivered,
                'on_time_pct', round(100.0 * on_time / nullif(delivered, 0), 1)) order by day) from hist),
    'by_location', (select jsonb_agg(row_to_json(t)::jsonb order by t.parcels_in desc) from (
                      select l.name as location, l.city, sum(ld.parcels_in) as parcels_in,
                             round(100.0 * sum(ld.delivered_on_time) / nullif(sum(ld.parcels_delivered), 0), 1) as on_time_pct,
                             round(100.0 * sum(ld.errors) / nullif(sum(ld.parcels_processed), 0), 2) as error_rate_pct
                      from public.logistics_daily ld join public.locations l on l.id = ld.location_id
                      where ld.day >= current_date - p_days and ld.day < current_date
                      group by l.name, l.city) t),
    'forecast', (select jsonb_agg(jsonb_build_object(
                   'day', to_char(day, 'DD.MM'), 'date', day, 'forecast', forecast, 'lower', lower, 'upper', upper,
                   'required_staff', required_staff, 'usual_staff', usual_staff,
                   'available_staff', usual_staff - on_vacation, 'on_vacation', on_vacation) order by day) from fc2),
    'summary', (select jsonb_build_object(
                  'peak_day', to_char(day, 'DD.MM.YYYY'), 'peak_volume', forecast,
                  'peak_required_staff', required_staff, 'current_staff', round(v_staff),
                  'usual_staff', usual_staff, 'available_staff', usual_staff - on_vacation,
                  'staff_gap', greatest(0, required_staff - (usual_staff - on_vacation)),
                  'on_vacation_at_peak', on_vacation)
                from fc2 order by forecast desc limit 1)
  ) into v_result;
  return v_result;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- migration: 20261016100600_integrations.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================================
-- JanaMen — 7/7. Интеграции с 1С:ЗУП и Documentolog (mock) + права на RPC
--
-- Архитектура: transactional outbox. Бизнес-операция (оформление заявки) пишет
-- событие в integration_events в той же транзакции; адаптер доставляет его во
-- внешнюю систему и сохраняет внешний номер документа.
-- В прототипе адаптеры — mock-функции ниже. В продакшене их заменяет воркер
-- (Supabase Edge Function / cron), который вызывает HTTP-сервис 1С:ЗУП и
-- REST API Documentolog; контракт событий остаётся тем же.
-- =====================================================================

-- ---------- Mock 1С:ЗУП — «мастер-система» кадровых данных ----------

create schema if not exists mock_zup;
revoke all on schema mock_zup from public, anon, authenticated;

create table if not exists mock_zup.departments (
  code        text primary key,
  name        text not null,
  parent_code text
);

create table if not exists mock_zup.employees (
  tab_no                 text primary key,     -- табельный номер
  last_name              text not null,
  first_name             text not null,
  middle_name            text,
  email                  text not null,
  phone                  text,
  position               text not null,
  department_code        text not null,
  location_name          text,
  manager_tab_no         text,
  hire_date              date not null,
  employment_type        text not null default 'full_time',
  salary                 numeric(12, 2),
  iin                    text,
  birth_date             date,
  vacation_days_per_year integer not null default 24,
  status                 text not null default 'active',
  changed_at             timestamptz not null default now()
);

create sequence if not exists public.mock_external_seq start 1240;

-- Синхронизация 1С:ЗУП → JanaMen (официальные данные только читаются из мастер-системы)
create or replace function public.sync_from_zup()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inserted int := 0;
  v_updated int := 0;
  v_total int;
  z record;
  v_emp uuid;
  v_dept uuid;
  v_loc uuid;
  v_changed boolean;
begin
  if public.in_request_context() and not public.is_hr() then
    raise exception 'Синхронизацию запускает HR' using errcode = '42501';
  end if;

  -- подразделения
  insert into public.departments (zup_id, name)
  select d.code, d.name from mock_zup.departments d
  on conflict (zup_id) do update set name = excluded.name;
  update public.departments pd set parent_id = pp.id
  from mock_zup.departments d join public.departments pp on pp.zup_id = d.parent_code
  where pd.zup_id = d.code and pd.parent_id is distinct from pp.id;

  for z in select * from mock_zup.employees order by hire_date loop
    select id into v_dept from public.departments where zup_id = z.department_code;
    select id into v_loc from public.locations where name = z.location_name limit 1;
    select id into v_emp from public.employees where zup_id = z.tab_no;

    if v_emp is null then
      insert into public.employees (zup_id, first_name, last_name, middle_name, email, phone, position, department_id,
                                    location_id, hire_date, employment_type, status, vacation_days_per_year, synced_at)
      values (z.tab_no, z.first_name, z.last_name, z.middle_name, z.email, z.phone, z.position, v_dept, v_loc,
              z.hire_date, z.employment_type, z.status, z.vacation_days_per_year, now())
      returning id into v_emp;
      insert into public.employee_private (employee_id, iin, birth_date, salary)
      values (v_emp, z.iin, z.birth_date, z.salary);
      v_inserted := v_inserted + 1;
      insert into public.integration_events (system, direction, entity, entity_id, payload, status, external_id, processed_at)
      values ('1c_zup', 'inbound', 'employee_created', v_emp,
              jsonb_build_object('tab_no', z.tab_no, 'position', z.position), 'sent', z.tab_no, now());
      -- адаптационный курс новичку назначает HR из «Зоны внимания» (один клик)
    else
      select (e.first_name, e.last_name, e.middle_name, e.email, e.phone, e.position, e.department_id, e.location_id,
              e.hire_date, e.employment_type, e.status, e.vacation_days_per_year)
             is distinct from
             (z.first_name, z.last_name, z.middle_name, z.email, z.phone, z.position, v_dept, v_loc,
              z.hire_date, z.employment_type, z.status, z.vacation_days_per_year)
        into v_changed
      from public.employees e where e.id = v_emp;

      update public.employees
         set first_name = z.first_name, last_name = z.last_name, middle_name = z.middle_name, email = z.email,
             phone = z.phone, position = z.position, department_id = v_dept, location_id = v_loc,
             hire_date = z.hire_date, employment_type = z.employment_type, status = z.status,
             vacation_days_per_year = z.vacation_days_per_year, synced_at = now()
       where id = v_emp;
      insert into public.employee_private (employee_id, iin, birth_date, salary)
      values (v_emp, z.iin, z.birth_date, z.salary)
      on conflict (employee_id) do update set iin = excluded.iin, birth_date = excluded.birth_date, salary = excluded.salary;
      if v_changed then
        v_updated := v_updated + 1;
        insert into public.integration_events (system, direction, entity, entity_id, payload, status, external_id, processed_at)
        values ('1c_zup', 'inbound', 'employee_updated', v_emp,
                jsonb_build_object('tab_no', z.tab_no, 'position', z.position), 'sent', z.tab_no, now());
      end if;
    end if;
  end loop;

  -- руководители и главы подразделений
  update public.employees e set manager_id = m.id
  from mock_zup.employees mz join public.employees m on m.zup_id = mz.manager_tab_no
  where e.zup_id = mz.tab_no and e.manager_id is distinct from m.id;
  update public.employees e set manager_id = null
  from mock_zup.employees mz
  where e.zup_id = mz.tab_no and mz.manager_tab_no is null and e.manager_id is not null;

  select count(*) into v_total from mock_zup.employees;
  return jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated,
                            'unchanged', v_total - v_inserted - v_updated, 'synced_at', now());
end $$;

-- Что изменилось в 1С:ЗУП с последней синхронизации (для экрана интеграций)
create or replace function public.zup_pending_changes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Только для HR' using errcode = '42501'; end if;
  return jsonb_build_object(
    'new', (select coalesce(jsonb_agg(jsonb_build_object('tab_no', z.tab_no, 'name', z.last_name || ' ' || z.first_name,
                                                         'position', z.position)), '[]'::jsonb)
            from mock_zup.employees z where not exists (select 1 from public.employees e where e.zup_id = z.tab_no)),
    'changed', (select coalesce(jsonb_agg(jsonb_build_object('tab_no', z.tab_no, 'name', z.last_name || ' ' || z.first_name,
                                                             'field', 'должность', 'from', e.position, 'to', z.position)), '[]'::jsonb)
                from mock_zup.employees z join public.employees e on e.zup_id = z.tab_no
                where e.position is distinct from z.position),
    'last_sync', (select max(synced_at) from public.employees));
end $$;

-- ---------- Mock-адаптеры внешних систем ----------

create or replace function public.mock_zup_call(p_entity text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_no text := lpad(nextval('public.mock_external_seq')::text, 6, '0');
begin
  return case p_entity
    when 'vacation_order' then jsonb_build_object('id', 'ZUP-' || v_no,
      'document', 'Приказ о предоставлении отпуска № ОТ-' || v_no || ' от ' || to_char(current_date, 'DD.MM.YYYY'))
    when 'advance_payment' then jsonb_build_object('id', 'ZUP-' || v_no,
      'document', 'Ведомость на выплату аванса № ВА-' || v_no)
    when 'employee_change' then jsonb_build_object('id', 'ZUP-' || v_no,
      'document', 'Заявление на изменение данных № ИД-' || v_no)
    else jsonb_build_object('id', 'ZUP-' || v_no, 'document', 'Документ № ' || v_no) end;
end $$;

create or replace function public.mock_documentolog_call(p_entity text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_no text := 'DL-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.mock_external_seq')::text, 6, '0');
begin
  return case p_entity
    when 'acquaintance' then jsonb_build_object('id', v_no,
      'document', 'Лист ознакомления с приказом ' || v_no, 'route', 'Ознакомление работника')
    when 'certificate' then jsonb_build_object('id', v_no,
      'document', 'Справка с места работы ' || v_no, 'route', 'Подписание HR → выдача работнику')
    else jsonb_build_object('id', v_no, 'document', 'Документ ' || v_no) end;
end $$;

-- Поставить оформленную заявку в очередь на передачу во внешние системы (transactional outbox)
create or replace function public.enqueue_request_integration(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests; e public.employees; v_payload jsonb;
begin
  select * into r from public.requests where id = p_request;
  select * into e from public.employees where id = r.employee_id;
  v_payload := jsonb_build_object(
    'request_number', r.number, 'employee_tab_no', e.zup_id,
    'employee', trim(e.last_name || ' ' || e.first_name || ' ' || coalesce(e.middle_name, '')),
    'type', r.type, 'start_date', r.start_date, 'end_date', r.end_date, 'days', r.days,
    'amount', r.amount, 'details', r.details);

  if r.type = 'vacation' then
    insert into public.integration_events (system, direction, entity, entity_id, payload)
    values ('1c_zup', 'outbound', 'vacation_order', r.id, v_payload),
           ('documentolog', 'outbound', 'acquaintance', r.id, v_payload);
  elsif r.type = 'advance' then
    insert into public.integration_events (system, direction, entity, entity_id, payload)
    values ('1c_zup', 'outbound', 'advance_payment', r.id, v_payload);
  elsif r.type = 'certificate' then
    insert into public.integration_events (system, direction, entity, entity_id, payload)
    values ('documentolog', 'outbound', 'certificate', r.id, v_payload);
  else
    insert into public.integration_events (system, direction, entity, entity_id, payload)
    values ('1c_zup', 'outbound', 'employee_change', r.id, v_payload);
  end if;
end $$;

-- Когда внешние системы ответили по всем событиям заявки — заявка «Оформлена»
create or replace function public.complete_request_integration(p_request uuid, p_notify boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests; v_zup jsonb; v_dl jsonb; v_msg text;
begin
  select * into r from public.requests where id = p_request for update;
  if r.id is null or r.status not in ('processing', 'done') then return; end if;
  if exists (select 1 from public.integration_events
             where entity_id = r.id and direction = 'outbound' and status <> 'sent') then
    return;
  end if;
  select ie.response into v_zup from public.integration_events ie
   where ie.entity_id = r.id and ie.system = '1c_zup' order by ie.created_at desc limit 1;
  select ie.response into v_dl from public.integration_events ie
   where ie.entity_id = r.id and ie.system = 'documentolog' order by ie.created_at desc limit 1;

  update public.requests
     set status = 'done', integration = jsonb_strip_nulls(jsonb_build_object('zup', v_zup, 'documentolog', v_dl))
   where id = r.id returning * into r;
  if v_zup is not null then
    perform public.log_request_event(r.id, 'integration', null, null, '1С:ЗУП: ' || (v_zup ->> 'document'));
  end if;
  if v_dl is not null then
    perform public.log_request_event(r.id, 'integration', null, null, 'Documentolog: ' || (v_dl ->> 'document'));
  end if;
  perform public.log_request_event(r.id, 'completed', 'done', null, null);

  if p_notify then
    v_msg := case r.type
      when 'vacation' then 'Отпуск оформлен: ' || coalesce(v_zup ->> 'document', 'приказ сформирован')
                           || '. Ознакомьтесь с приказом в Documentolog'
      when 'advance' then 'Аванс ' || public.fmt_money(r.amount) || ' ₸ передан на выплату ('
                          || coalesce(v_zup ->> 'document', '1С:ЗУП') || '). Зачисление до 3 рабочих дней'
      when 'certificate' then 'Справка готова: ' || coalesce(v_dl ->> 'document', 'Documentolog')
      else 'Изменения переданы в 1С:ЗУП: ' || coalesce(v_zup ->> 'document', '') end;
    perform public.notify(r.employee_id, 'Заявка №' || r.number || ' оформлена ✅', v_msg, '/requests', 'success');
    perform public.notify_followers(r.employee_id, 'заявка №' || r.number || ' оформлена',
      public.request_type_label(r.type), '/approvals', 'success');
  end if;
end $$;

-- Доставка событий из outbox (в проде — асинхронный воркер с повторными попытками)
create or replace function public.process_integration_events(p_limit integer default 50, p_notify boolean default true)
returns integer language plpgsql security definer set search_path = public as $$
declare ev record; v_resp jsonb; v_count int := 0; v_req uuid;
begin
  for ev in
    select * from public.integration_events where status = 'pending' and direction = 'outbound'
    order by created_at limit p_limit for update skip locked
  loop
    begin
      v_resp := case ev.system when '1c_zup' then public.mock_zup_call(ev.entity, ev.payload)
                               else public.mock_documentolog_call(ev.entity, ev.payload) end;
      update public.integration_events
         set status = 'sent', external_id = v_resp ->> 'id', response = v_resp, processed_at = now()
       where id = ev.id;
      v_count := v_count + 1;
    exception when others then
      update public.integration_events set status = 'error', error = sqlerrm, processed_at = now() where id = ev.id;
    end;
  end loop;
  for v_req in
    select distinct r.id from public.requests r
    join public.integration_events ie on ie.entity_id = r.id
    where r.status = 'processing' or (r.status = 'done' and r.integration = '{}'::jsonb)
  loop
    perform public.complete_request_integration(v_req, p_notify);
  end loop;
  return v_count;
end $$;

-- Ручной запуск воркера из интерфейса HR («Запросить статус в 1С»)
create or replace function public.run_integration_worker()
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Только для HR' using errcode = '42501'; end if;
  return public.process_integration_events(50, true);
end $$;

-- ---------- Права на функции ----------
-- По умолчанию EXECUTE есть у PUBLIC — закрываем и выдаём только вошедшим пользователям.

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- Внутренние функции — не вызываются из API напрямую
revoke execute on function public.notify(uuid, text, text, text, text) from authenticated;
revoke execute on function public.log_request_event(uuid, text, text, uuid, text) from authenticated;
revoke execute on function public.recalc_course_progress(uuid, uuid) from authenticated;
revoke execute on function public.mock_zup_call(text, jsonb) from authenticated;
revoke execute on function public.mock_documentolog_call(text, jsonb) from authenticated;
revoke execute on function public.process_integration_events(integer, boolean) from authenticated;
revoke execute on function public.enqueue_request_integration(uuid) from authenticated;
revoke execute on function public.complete_request_integration(uuid, boolean) from authenticated;
revoke execute on function public.notify_followers(uuid, text, text, text, text) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

-- ---------- Realtime: мгновенные уведомления ----------

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- seed: supabase/seed.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================================
-- JanaMen — демо-данные (вымышленные; реальных персональных данных нет)
--
-- ВНИМАНИЕ: скрипт очищает таблицы приложения и пересоздаёт демо-набор.
-- Его можно запускать повторно — например, чтобы «сбросить» стенд перед защитой.
-- Тестовые аккаунты (пароль Jana2026!):
--   employee@jana.test — работник (Дана Жумабекова, склад)
--   manager@jana.test  — руководитель (Ерлан Сапаров, руководитель склада)
--   hr@jana.test       — HR / администратор (Айгерим Нурланова)
--   newbie@jana.test   — новый сотрудник (Тимур Ахметов, 5-й день)
-- Даты рассчитываются от текущего дня, поэтому стенд всегда «свежий».
-- =====================================================================

-- Служебная схема для промежуточных таблиц (вместо временных: SQL Editor Supabase
-- может выполнять операторы в разных сессиях, а временные таблицы живут только в одной)
drop schema if exists seed_tmp cascade;
create schema seed_tmp;

-- ---------- Очистка ----------

delete from auth.users where email like '%@jana.test';
truncate table
  public.audit_log, public.integration_events, public.logistics_daily, public.watchlist,
  public.announcement_reads, public.announcements, public.task_comments, public.tasks,
  public.hr_tickets, public.ai_queries, public.kb_chunks, public.kb_articles,
  public.course_attempts, public.lesson_progress, public.course_assignments, public.course_answer_keys,
  public.course_questions, public.course_lessons, public.courses, public.notifications,
  public.request_events, public.requests, public.holidays, public.employee_private, public.employees,
  public.departments, public.locations
  restart identity cascade;
truncate table mock_zup.employees, mock_zup.departments;
alter sequence public.mock_external_seq restart with 1240;

-- Триггеры уведомлений на время загрузки истории выключаем (история пишется вручную)
alter table public.requests disable trigger trg_requests_after_insert;
alter table public.course_assignments disable trigger trg_course_assignments_notify;
alter table public.tasks disable trigger trg_tasks_notify;
alter table public.announcements disable trigger trg_announcements_notify;
alter table public.hr_tickets disable trigger trg_hr_tickets_after_insert;

create or replace function seed_tmp.emp(p_tab text) returns uuid language sql stable as $$
  select id from public.employees where zup_id = p_tab
$$;

-- ---------- Производственный календарь РК ----------

insert into public.holidays (day, name) values
  ('2026-01-01', 'Новый год'), ('2026-01-02', 'Новый год'), ('2026-01-07', 'Рождество Христово'),
  ('2026-03-08', 'Международный женский день'), ('2026-03-21', 'Наурыз мейрамы'), ('2026-03-22', 'Наурыз мейрамы'),
  ('2026-03-23', 'Наурыз мейрамы'), ('2026-05-01', 'Праздник единства народа Казахстана'),
  ('2026-05-07', 'День защитника Отечества'), ('2026-05-09', 'День Победы'), ('2026-05-27', 'Курбан айт'),
  ('2026-07-06', 'День Столицы'), ('2026-08-30', 'День Конституции'), ('2026-10-25', 'День Республики'),
  ('2026-10-26', 'Перенос выходного дня (День Республики)'), ('2026-12-16', 'День Независимости'),
  ('2027-01-01', 'Новый год'), ('2027-01-02', 'Новый год'), ('2027-01-07', 'Рождество Христово'),
  ('2027-03-08', 'Международный женский день'), ('2027-03-21', 'Наурыз мейрамы'), ('2027-03-22', 'Наурыз мейрамы'),
  ('2027-03-23', 'Наурыз мейрамы'), ('2027-05-01', 'Праздник единства народа Казахстана'),
  ('2027-05-07', 'День защитника Отечества'), ('2027-05-09', 'День Победы'), ('2027-07-06', 'День Столицы'),
  ('2027-08-30', 'День Конституции'), ('2027-10-25', 'День Республики'), ('2027-12-16', 'День Независимости');

-- ---------- Локации ----------

insert into public.locations (name, city, country, type) values
  ('Головной офис', 'Алматы', 'Казахстан', 'office'),
  ('Сортировочный центр Алматы', 'Алматы', 'Казахстан', 'sorting_center'),
  ('Офис Астана', 'Астана', 'Казахстан', 'office'),
  ('Склад консолидации Урумчи', 'Урумчи', 'Китай', 'warehouse'),
  ('ПВЗ Караганда', 'Караганда', 'Казахстан', 'pickup_point'),
  ('ПВЗ Шымкент', 'Шымкент', 'Казахстан', 'pickup_point'),
  ('ПВЗ Астана', 'Астана', 'Казахстан', 'pickup_point'),
  ('Филиал Бишкек', 'Бишкек', 'Кыргызстан', 'office');

-- ---------- Мастер-данные в mock 1С:ЗУП ----------

insert into mock_zup.departments (code, name, parent_code) values
  ('D00', 'Руководство', null),
  ('D10', 'HR и администрирование', 'D00'),
  ('D20', 'Финансы', 'D00'),
  ('D30', 'IT и продукт', 'D00'),
  ('D40', 'Логистика', 'D00'),
  ('D41', 'Склад и сортировка', 'D40'),
  ('D42', 'Курьерская доставка', 'D40'),
  ('D43', 'Пункты выдачи', 'D40'),
  ('D44', 'Международная логистика', 'D40'),
  ('D50', 'Клиентский сервис', 'D00'),
  ('D60', 'Маркетинг', 'D00');

insert into mock_zup.employees
  (tab_no, last_name, first_name, middle_name, email, phone, position, department_code, location_name, manager_tab_no,
   hire_date, salary, iin, birth_date) values
  ('JP-0001', 'Сулейменов', 'Бекжан', 'Маратович', 'b.suleimenov@jana.test', '+7 701 000 0001', 'Генеральный директор', 'D00', 'Головной офис', null, '2018-03-01', 3500000, '800314000001', '1980-03-14'),
  ('JP-0002', 'Нурланова', 'Айгерим', 'Ерлановна', 'hr@jana.test', '+7 701 000 0002', 'HR-директор', 'D10', 'Головной офис', 'JP-0001', '2019-06-17', 1400000, '880521400002', '1988-05-21'),
  ('JP-0003', 'Касымова', 'Мадина', 'Асхатовна', 'm.kassymova@jana.test', '+7 701 000 0003', 'Специалист по кадровому делопроизводству', 'D10', 'Офис Астана', 'JP-0002', '2022-09-12', 520000, '950817400003', '1995-08-17'),
  ('JP-0004', 'Омарова', 'Жанна', 'Бауыржановна', 'zh.omarova@jana.test', '+7 701 000 0004', 'Специалист по обучению (Jana Academy)', 'D10', 'Головной офис', 'JP-0002', '2023-03-01', 480000, '930302400004', '1993-03-02'),
  ('JP-0005', 'Есенова', 'Гульнара', 'Кайратовна', 'g.yessenova@jana.test', '+7 701 000 0005', 'Финансовый директор', 'D20', 'Головной офис', 'JP-0001', '2019-08-20', 1600000, '820909400005', '1982-09-09'),
  ('JP-0006', 'Ким', 'Алексей', 'Викторович', 'a.kim@jana.test', '+7 701 000 0006', 'Бухгалтер по заработной плате', 'D20', 'Головной офис', 'JP-0005', '2021-11-01', 550000, '900112300006', '1990-01-12'),
  ('JP-0007', 'Пак', 'Дмитрий', 'Сергеевич', 'd.pak@jana.test', '+7 701 000 0007', 'Технический директор', 'D30', 'Головной офис', 'JP-0001', '2019-05-13', 2200000, '850704300007', '1985-07-04'),
  ('JP-0008', 'Тулегенов', 'Арман', 'Нурланович', 'a.tulegenov@jana.test', '+7 701 000 0008', 'Ведущий backend-разработчик', 'D30', 'Головной офис', 'JP-0007', '2021-02-08', 1300000, '920628300008', '1992-06-28'),
  ('JP-0009', 'Цой', 'Карина', 'Олеговна', 'k.tsoi@jana.test', '+7 701 000 0009', 'Frontend-разработчик', 'D30', 'Офис Астана', 'JP-0007', '2023-07-17', 900000, '970211400009', '1997-02-11'),
  ('JP-0010', 'Садыкова', 'Аружан', 'Маратовна', 'a.sadykova@jana.test', '+7 701 000 0010', 'Product-менеджер', 'D30', 'Головной офис', 'JP-0007', '2024-01-22', 1000000, '960430400010', '1996-04-30'),
  ('JP-0011', 'Ибраев', 'Руслан', 'Тимурович', 'r.ibrayev@jana.test', '+7 701 000 0011', 'Директор по логистике', 'D40', 'Сортировочный центр Алматы', 'JP-0001', '2019-10-01', 1500000, '830118300011', '1983-01-18'),
  ('JP-0012', 'Сапаров', 'Ерлан', 'Бекович', 'manager@jana.test', '+7 701 000 0012', 'Руководитель склада и сортировки', 'D41', 'Сортировочный центр Алматы', 'JP-0011', '2020-03-02', 750000, '870925300012', '1987-09-25'),
  ('JP-0013', 'Жумабекова', 'Дана', 'Нурлановна', 'employee@jana.test', '+7 701 000 0013', 'Старший оператор сортировки', 'D41', 'Сортировочный центр Алматы', 'JP-0012', '2021-05-17', 380000, '940803400013', '1994-08-03'),
  ('JP-0014', 'Утепов', 'Бауыржан', 'Серикович', 'b.utepov@jana.test', '+7 701 000 0014', 'Кладовщик', 'D41', 'Сортировочный центр Алматы', 'JP-0012', '2022-08-01', 320000, '910517300014', '1991-05-17'),
  ('JP-0015', 'Кенжебаев', 'Олжас', 'Ерланович', 'o.kenzhebayev@jana.test', '+7 701 000 0015', 'Оператор сортировки', 'D41', 'Сортировочный центр Алматы', 'JP-0012', '2023-10-02', 290000, '990721300015', '1999-07-21'),
  ('JP-0016', 'Калиева', 'Айдана', 'Мухтаровна', 'a.kaliyeva@jana.test', '+7 701 000 0016', 'Оператор сортировки', 'D41', 'Сортировочный центр Алматы', 'JP-0012', '2024-06-10', 290000, '010309400016', '2001-03-09'),
  ('JP-0017', 'Жаксылыков', 'Мирас', 'Ануарович', 'm.zhaksylykov@jana.test', '+7 701 000 0017', 'Водитель погрузчика', 'D41', 'Сортировочный центр Алматы', 'JP-0012', '2020-11-16', 300000, '890214300017', '1989-02-14'),
  ('JP-0018', 'Ахметов', 'Тимур', 'Русланович', 'newbie@jana.test', '+7 701 000 0018', 'Оператор сортировки', 'D41', 'Сортировочный центр Алматы', 'JP-0012', current_date - 5, 280000, '030627300018', '2003-06-27'),
  ('JP-0019', 'Ли', 'Вэй', null, 'li.wei@jana.test', '+86 130 0000 0019', 'Координатор склада консолидации', 'D44', 'Склад консолидации Урумчи', 'JP-0011', '2023-02-20', 600000, null, '1990-10-05'),
  ('JP-0020', 'Жакупова', 'Индира', 'Аскаровна', 'i.zhakupova@jana.test', '+7 701 000 0020', 'Специалист по таможенному оформлению', 'D44', 'Головной офис', 'JP-0011', '2022-01-17', 480000, '920920400020', '1992-09-20'),
  ('JP-0021', 'Оспанов', 'Азамат', 'Болатович', 'a.ospanov@jana.test', '+7 701 000 0021', 'Руководитель курьерской службы', 'D42', 'Головной офис', 'JP-0011', '2021-01-11', 600000, '880401300021', '1988-04-01'),
  ('JP-0022', 'Рахимов', 'Бекзат', 'Ержанович', 'b.rakhimov@jana.test', '+7 701 000 0022', 'Курьер', 'D42', 'Головной офис', 'JP-0021', '2024-04-01', 300000, '000815300022', '2000-08-15'),
  ('JP-0023', 'Смагулов', 'Кайрат', 'Нуржанович', 'k.smagulov@jana.test', '+7 701 000 0023', 'Курьер', 'D42', 'Головной офис', 'JP-0021', current_date - 330, 290000, '980112300023', '1998-01-12'),
  ('JP-0024', 'Абенов', 'Ержан', 'Талгатович', 'ye.abenov@jana.test', '+7 701 000 0024', 'Курьер-водитель', 'D42', 'Головной офис', 'JP-0021', '2022-05-23', 330000, '930103300024', '1993-01-03'),
  ('JP-0025', 'Исмаилова', 'Динара', 'Ринатовна', 'd.ismailova@jana.test', '+7 701 000 0025', 'Руководитель сети ПВЗ', 'D43', 'Офис Астана', 'JP-0011', '2021-08-09', 550000, '890606400025', '1989-06-06'),
  ('JP-0026', 'Мусина', 'Сабина', 'Айдаровна', 's.mussina@jana.test', '+7 701 000 0026', 'Оператор ПВЗ', 'D43', 'ПВЗ Караганда', 'JP-0025', '2024-02-12', 240000, '020224400026', '2002-02-24'),
  ('JP-0027', 'Байжанова', 'Томирис', 'Ержановна', 't.baizhanova@jana.test', '+7 701 000 0027', 'Оператор ПВЗ', 'D43', 'ПВЗ Шымкент', 'JP-0025', current_date - 225, 240000, '011130400027', '2001-11-30'),
  ('JP-0028', 'Бекова', 'Анель', 'Маратовна', 'a.bekova@jana.test', '+7 701 000 0028', 'Оператор ПВЗ', 'D43', 'ПВЗ Астана', 'JP-0025', '2023-12-04', 250000, '990505400028', '1999-05-05'),
  ('JP-0029', 'Ермекова', 'Асель', 'Даулетовна', 'a.yermekova@jana.test', '+7 701 000 0029', 'Руководитель клиентского сервиса', 'D50', 'Головной офис', 'JP-0001', '2020-09-07', 650000, '860719400029', '1986-07-19'),
  ('JP-0030', 'Абдрахманова', 'Камила', 'Ильясовна', 'k.abdrakhmanova@jana.test', '+7 701 000 0030', 'Специалист поддержки клиентов', 'D50', 'Головной офис', 'JP-0029', '2023-04-10', 300000, '970914400030', '1997-09-14'),
  ('JP-0031', 'Искаков', 'Данияр', 'Асланович', 'd.iskakov@jana.test', '+7 701 000 0031', 'Специалист поддержки клиентов', 'D50', 'ПВЗ Караганда', 'JP-0029', '2024-09-02', 290000, '000101300031', '2000-01-01'),
  ('JP-0032', 'Сейткали', 'Алия', 'Бериковна', 'a.seitkali@jana.test', '+7 701 000 0032', 'Руководитель маркетинга', 'D60', 'Головной офис', 'JP-0001', '2021-04-19', 900000, '900328400032', '1990-03-28'),
  ('JP-0033', 'Ли', 'Виктория', 'Андреевна', 'v.li@jana.test', '+7 701 000 0033', 'SMM-менеджер', 'D60', 'Головной офис', 'JP-0032', current_date - 340, 400000, '980808400033', '1998-08-08'),
  ('JP-0034', 'Токтогулов', 'Нурбек', 'Алмазбекович', 'n.toktogulov@jana.test', '+996 555 000 034', 'Менеджер филиала', 'D40', 'Филиал Бишкек', 'JP-0011', '2023-05-15', 450000, null, '1991-12-12'),
  ('JP-0036', 'Ахмедова', 'Сауле', 'Канатовна', 's.akhmedova@jana.test', '+7 701 000 0036', 'Оператор ПВЗ', 'D43', 'ПВЗ Астана', 'JP-0025', current_date - 8, 240000, '020717400036', '2002-07-17');

-- Первичная загрузка из 1С:ЗУП (тот же путь, что и кнопка «Синхронизировать»)
select public.sync_from_zup();

update public.employees set company = 'ОсОО «Jana Post Кыргызстан»' where zup_id = 'JP-0034';
update public.employees set role = 'hr' where zup_id in ('JP-0002', 'JP-0003', 'JP-0004');
update public.employees set role = 'manager'
  where zup_id in ('JP-0001', 'JP-0005', 'JP-0007', 'JP-0011', 'JP-0012', 'JP-0021', 'JP-0025', 'JP-0029', 'JP-0032');
update public.employees set vacation_carryover = 7 where zup_id = 'JP-0013';
update public.employees set vacation_carryover = 14 where zup_id = 'JP-0017';
update public.employees set vacation_carryover = 10 where zup_id = 'JP-0024';
update public.employees set vacation_carryover = 8 where zup_id in ('JP-0006', 'JP-0020');
update public.employee_private set address = 'г. Алматы, мкр. Аксай-4 (демо)', emergency_contact = 'Жумабеков Нурлан, +7 701 000 1013'
  where employee_id = seed_tmp.emp('JP-0013');
update public.departments d set head_id = e.id
from public.employees e
where (d.zup_id, e.zup_id) in (('D00', 'JP-0001'), ('D10', 'JP-0002'), ('D20', 'JP-0005'), ('D30', 'JP-0007'),
                               ('D40', 'JP-0011'), ('D41', 'JP-0012'), ('D42', 'JP-0021'), ('D43', 'JP-0025'),
                               ('D44', 'JP-0011'), ('D50', 'JP-0029'), ('D60', 'JP-0032'));

-- Изменения в 1С:ЗУП, появившиеся после синхронизации (для демонстрации кнопки «Синхронизировать»)
insert into mock_zup.employees
  (tab_no, last_name, first_name, middle_name, email, phone, position, department_code, location_name, manager_tab_no,
   hire_date, salary, iin, birth_date)
values ('JP-0035', 'Нургалиев', 'Ильяс', 'Канатович', 'i.nurgaliyev@jana.test', '+7 701 000 0035', 'QA-инженер', 'D30',
        'Головной офис', 'JP-0007', current_date + 3, 650000, '980404300035', '1998-04-04');
update mock_zup.employees set position = 'Бригадир смены сортировки', changed_at = now() where tab_no = 'JP-0015';

-- ---------- Тестовые аккаунты (Supabase Auth) ----------

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', u.email,
       extensions.crypt('Jana2026!', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('demo_role', u.demo_role), now(), now(),
       '', '', '', '', '', '', '', ''
from (values ('employee@jana.test', 'employee'), ('manager@jana.test', 'manager'),
             ('hr@jana.test', 'hr'), ('newbie@jana.test', 'employee')) as u(email, demo_role);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u where u.email like '%@jana.test';

-- ---------- HR-заявки (история) ----------

create table seed_tmp.requests (
  tab text, type text, status text, start_date date, end_date date, amount numeric, comment text, details jsonb,
  created_at timestamptz, decision_comment text
);

insert into seed_tmp.requests values
  -- Дана (работник): заявки в разных статусах
  ('JP-0013', 'vacation', 'done', current_date - 120, current_date - 107, null, 'Летний отпуск', '{}', now() - interval '150 days', null),
  ('JP-0013', 'advance', 'done', null, null, 120000, 'Оплата обучения ребёнка', '{}', now() - interval '45 days', null),
  ('JP-0013', 'certificate', 'done', null, null, null, null, '{"purpose":"В банк для оформления кредита","language":"ru","copies":1}', now() - interval '20 days', null),
  ('JP-0013', 'vacation', 'rejected', current_date + 20, current_date + 26, null, 'Хочу съездить к родителям', '{}', now() - interval '12 days',
     'Пик сезона после 11.11. Перенесите, пожалуйста, на декабрь. Готов согласовать с 14.12'),
  ('JP-0013', 'certificate', 'pending', null, null, null, null, '{"purpose":"Для посольства (виза)","language":"en","copies":1}', now() - interval '1 day', null),
  -- команда Ерлана: ждут решения руководителя / HR
  ('JP-0014', 'vacation', 'pending', current_date + 21, current_date + 27, null, 'Семейный отпуск', '{}', now() - interval '2 days 6 hours', null),
  ('JP-0015', 'advance', 'pending', null, null, 80000, 'Ремонт автомобиля', '{}', now() - interval '20 hours', null),
  ('JP-0016', 'vacation', 'approved', current_date + 40, current_date + 44, null, null, '{}', now() - interval '6 days', null),
  ('JP-0017', 'vacation', 'done', current_date - 480, current_date - 467, null, null, '{}', now() - interval '500 days', null),
  -- другие подразделения
  ('JP-0030', 'vacation', 'done', current_date - 5, current_date + 8, null, 'Отпуск по графику', '{}', now() - interval '30 days', null),
  ('JP-0009', 'vacation', 'done', current_date + 10, current_date + 19, null, null, '{}', now() - interval '25 days', null),
  ('JP-0008', 'advance', 'done', null, null, 300000, null, '{}', now() - interval '8 days', null),
  ('JP-0026', 'certificate', 'done', null, null, null, null, '{"purpose":"По месту требования","language":"kk","copies":2}', now() - interval '9 days', null),
  ('JP-0022', 'advance', 'pending', null, null, 100000, 'Непредвиденные расходы', '{}', now() - interval '3 days 2 hours', null),
  ('JP-0026', 'advance', 'processing', null, null, 90000, null, '{}', now() - interval '26 hours', null),
  ('JP-0028', 'data_change', 'pending', null, null, null, 'Сменила фамилию после замужества, свидетельство приложу в HR',
     '{"field":"Фамилия","new_value":"Серикова"}', now() - interval '4 days', null),
  ('JP-0027', 'vacation', 'pending', current_date + 50, current_date + 56, null, null, '{}', now() - interval '1 day', null),
  ('JP-0029', 'vacation', 'done', current_date - 60, current_date - 47, null, null, '{}', now() - interval '80 days', null),
  ('JP-0005', 'vacation', 'done', current_date - 95, current_date - 82, null, null, '{}', now() - interval '110 days', null),
  ('JP-0024', 'vacation', 'cancelled', current_date + 15, current_date + 20, null, null, '{}', now() - interval '10 days', null),
  ('JP-0031', 'advance', 'rejected', null, null, 140000, null, '{}', now() - interval '15 days',
     'Сумма превышает 50% оклада, подайте новую заявку на меньшую сумму'),
  ('JP-0033', 'certificate', 'done', null, null, null, null, '{"purpose":"Для визы","language":"en","copies":1}', now() - interval '33 days', null),
  ('JP-0021', 'vacation', 'done', current_date - 75, current_date - 62, null, null, '{}', now() - interval '90 days', null),
  ('JP-0003', 'advance', 'done', null, null, 150000, null, '{}', now() - interval '52 days', null),
  ('JP-0025', 'vacation', 'done', current_date - 140, current_date - 127, null, null, '{}', now() - interval '160 days', null),
  ('JP-0020', 'vacation', 'done', current_date - 35, current_date - 22, null, null, '{}', now() - interval '50 days', null),
  ('JP-0010', 'certificate', 'done', null, null, null, null, '{"purpose":"В банк","language":"ru","copies":1}', now() - interval '62 days', null),
  ('JP-0006', 'vacation', 'done', current_date - 200, current_date - 187, null, null, '{}', now() - interval '220 days', null),
  ('JP-0019', 'advance', 'done', null, null, 200000, null, '{}', now() - interval '70 days', null),
  ('JP-0032', 'vacation', 'approved', current_date + 30, current_date + 39, null, null, '{}', now() - interval '3 days', null),
  ('JP-0023', 'vacation', 'done', current_date - 25, current_date - 18, null, null, '{}', now() - interval '40 days', null);

-- Фоновые отпуска за ~15 месяцев (для аналитики и сезонного прогноза):
-- лето — основной пик, конец декабря / январь, весна (Наурыз, май), немного осенью
insert into seed_tmp.requests
select e.zup_id, 'vacation', 'done', v.start_date, v.start_date + v.len - 1, null, null, '{}'::jsonb,
       (v.start_date - 20)::timestamptz + interval '10 hours', null
from public.employees e
cross join lateral (values
  -- прошлый год: лето
  (make_date(extract(year from current_date)::int - 1, 6, 1) + (abs(hashtext(e.zup_id || 'ly')) % 80), 14, true),
  -- прошлый год: октябрь–ноябрь (немного)
  (make_date(extract(year from current_date)::int - 1, 10, 5) + (abs(hashtext(e.zup_id || 'lo')) % 45), 7,
     abs(hashtext(e.zup_id || 'lo')) % 5 = 0),
  -- новогодние
  (make_date(extract(year from current_date)::int - 1, 12, 22) + (abs(hashtext(e.zup_id || 'ny')) % 18), 7,
     abs(hashtext(e.zup_id || 'ny')) % 3 = 0),
  -- весна текущего года
  (make_date(extract(year from current_date)::int, 3, 16) + (abs(hashtext(e.zup_id || 'sp')) % 70), 7,
     abs(hashtext(e.zup_id || 'sp')) % 3 = 0),
  -- лето текущего года
  (make_date(extract(year from current_date)::int, 6, 1) + (abs(hashtext(e.zup_id)) % 75), 14, true)
) as v(start_date, len, enabled)
where v.enabled
  and v.start_date + v.len - 1 < current_date
  and e.hire_date < v.start_date - 180
  and e.zup_id not in ('JP-0017', 'JP-0018', 'JP-0036')
  and not (e.zup_id in ('JP-0024') and v.start_date >= make_date(extract(year from current_date)::int, 1, 1))
  and not (e.zup_id in ('JP-0013', 'JP-0030', 'JP-0029', 'JP-0005', 'JP-0021', 'JP-0025', 'JP-0020', 'JP-0006', 'JP-0023')
           and v.start_date >= make_date(extract(year from current_date)::int, 1, 1));

-- Фоновые заявки за последние 12 недель (тренд нагрузки на HR)
insert into seed_tmp.requests
select e.zup_id, case when g % 3 = 0 then 'advance' else 'certificate' end, case when g % 7 = 0 then 'rejected' else 'done' end,
       null, null, case when g % 3 = 0 then 50000 + (g % 5) * 10000 end, null,
       case when g % 3 = 0 then '{}'::jsonb else '{"purpose":"По месту требования","language":"ru","copies":1}'::jsonb end,
       now() - ((g * 37) % 80 + 6) * interval '1 day' - (g % 9) * interval '1 hour',
       case when g % 7 = 0 then 'Не хватает данных, уточните цель' end
from generate_series(1, 26) g
join public.employees e on e.zup_id = 'JP-' || lpad((((g * 7) % 30) + 3)::text, 4, '0')
where e.zup_id not in ('JP-0013', 'JP-0015', 'JP-0018');

insert into public.requests (employee_id, type, status, start_date, end_date, amount, comment, details, approver_id,
                             created_at, updated_at)
select seed_tmp.emp(s.tab), s.type, s.status, s.start_date, s.end_date, s.amount, s.comment, s.details,
       case
         when s.status = 'pending' and s.type in ('vacation', 'advance') then
           coalesce((select manager_id from public.employees where zup_id = s.tab), seed_tmp.emp('JP-0002'))
         else seed_tmp.emp('JP-0002') end,
       s.created_at, s.created_at
from seed_tmp.requests s
order by s.created_at;

-- История и интеграции для каждой заявки (длительность этапов зависит от согласующего;
-- ни одно событие не попадает в будущее).
-- Триггер updated_at на время загрузки истории выключаем, чтобы сохранить исторические даты.
alter table public.requests disable trigger trg_requests_updated_at;

do $$
declare
  r record;
  v_hr uuid := seed_tmp.emp('JP-0002');
  v_mgr uuid;
  v_mgr_tab text;
  v_t timestamptz;
  v_dec text;
  v_mgr_delay interval;
begin
  for r in select q.*, e.manager_id from public.requests q join public.employees e on e.id = q.employee_id order by q.created_at loop
    v_mgr := r.manager_id;
    select zup_id into v_mgr_tab from public.employees where id = v_mgr;
    v_mgr_delay := case v_mgr_tab when 'JP-0021' then interval '41 hours' when 'JP-0025' then interval '22 hours'
                                  when 'JP-0012' then interval '3 hours' when 'JP-0001' then interval '30 hours'
                                  else interval '7 hours' end
                   + (abs(hashtext(r.id::text)) % 120) * interval '1 minute';
    select decision_comment into v_dec from seed_tmp.requests s
     where seed_tmp.emp(s.tab) = r.employee_id and s.type = r.type and s.created_at = r.created_at limit 1;

    insert into public.request_events (request_id, action, status, actor_id, comment, created_at)
    values (r.id, 'created', 'pending', r.employee_id, r.comment, r.created_at);
    v_t := r.created_at;

    if r.type in ('vacation', 'advance') and v_mgr is not null and r.status in ('approved', 'processing', 'done', 'rejected') then
      v_t := least(v_t + v_mgr_delay, now() - interval '15 minutes');
      insert into public.request_events (request_id, action, status, actor_id, comment, created_at)
      values (r.id, case when r.status = 'rejected' then 'rejected' else 'approved' end,
              case when r.status = 'rejected' then 'rejected' else 'approved' end,
              v_mgr, case when r.status = 'rejected' then v_dec end, v_t);
    elsif r.status = 'rejected' then
      v_t := least(v_t + interval '5 hours', now() - interval '15 minutes');
      insert into public.request_events (request_id, action, status, actor_id, comment, created_at)
      values (r.id, 'rejected', 'rejected', v_hr, v_dec, v_t);
    end if;

    if r.status in ('done', 'processing') then
      v_t := least(v_t + case when r.type = 'certificate' then interval '4 hours' else interval '9 hours' end
                       + (abs(hashtext(r.id::text || 'hr')) % 600) * interval '1 minute',
                   now() - interval '15 minutes');
      insert into public.request_events (request_id, action, status, actor_id, comment, created_at)
      values (r.id, 'processed', 'processing', v_hr,
              case when r.type = 'certificate' then 'Передано в Documentolog' else 'Передано в 1С:ЗУП' end, v_t);
      perform public.enqueue_request_integration(r.id);
      update public.integration_events set created_at = v_t where entity_id = r.id;
      if r.status = 'done' then
        perform public.process_integration_events(50, false);
        update public.integration_events set processed_at = v_t + interval '4 minutes' where entity_id = r.id;
        update public.request_events set created_at = v_t + interval '4 minutes'
         where request_id = r.id and action in ('integration', 'completed');
        v_t := v_t + interval '4 minutes';
      end if;
    elsif r.status = 'cancelled' then
      v_t := least(v_t + interval '1 day', now() - interval '15 minutes');
      insert into public.request_events (request_id, action, status, actor_id, comment, created_at)
      values (r.id, 'cancelled', 'cancelled', r.employee_id, 'Планы изменились', v_t);
    end if;
    update public.requests set updated_at = v_t,
                               approver_id = case when r.status in ('approved') then v_hr
                                                  when r.status in ('processing', 'done', 'rejected', 'cancelled') then null
                                                  else approver_id end
     where id = r.id;
  end loop;
end $$;

alter table public.requests enable trigger trg_requests_updated_at;

-- ---------- Jana Academy ----------

insert into public.courses (slug, title, description, category, emoji, duration_minutes, is_mandatory, pass_score) values
  ('welcome', 'Добро пожаловать в Jana Post',
   'Адаптационный курс: кто мы, наши ценности, как устроены HR-сервисы в JanaMen и что важно в первые дни.',
   'onboarding', '📦', 25, true, 70),
  ('safety', 'Охрана труда на складе и в ПВЗ',
   'Базовые правила безопасной работы с грузами, техникой и в зоне сортировки. Обязателен для логистики.',
   'safety', '🦺', 30, true, 80),
  ('infosec', 'Информационная безопасность и персональные данные',
   'Пароли, фишинг, работа с персональными данными клиентов и коллег. Обязателен для всех.',
   'compliance', '🔐', 20, true, 80),
  ('service', 'Стандарты клиентского сервиса',
   'Как говорить с клиентом на ПВЗ и в поддержке: приветствие, сложные ситуации, возвраты.',
   'skills', '💬', 20, false, 70);

insert into public.course_lessons (course_id, sort, title, duration_minutes, content)
select c.id, l.sort, l.title, l.minutes, l.content
from public.courses c
join (values
  ('welcome', 1, 'Кто мы: Jana Post сегодня', 6,
   E'**Jana Post** это международная технологическая и логистическая платформа, которая обеспечивает полный цикл трансграничной торговли между Китаем и странами Центральной Азии.\n\nКомпания объединяет собственную логистическую инфраструктуру, цифровые решения и экосистему сервисов для клиентов, предпринимателей, маркетплейсов и бизнеса.\n\n### Jana Post в цифрах\n- **3+ млн** пользователей\n- **1000+** филиалов\n- **5** стран\n- **собственная IT-платформа**\n\n### Маршрут\nКитай → Казахстан → Центральная Азия: Кыргызстан, Узбекистан, Таджикистан, Монголия.\n\nКаждый сотрудник, от оператора сортировки до разработчика, участвует в этом маршруте: посылка клиента проходит через склад консолидации, сортировочный центр, курьера или пункт выдачи.'),
  ('welcome', 2, 'Наши ценности', 5,
   E'В основе Jana Post лежат три ценности.\n\n### 01 Открытость\nГоворим прямо, делимся информацией и признаём ошибки. Если что-то мешает работе, скажите руководителю или HR, а типовые вопросы задайте AI Jana.\n\n### 02 Надёжность\nКлиент доверяет нам свою посылку. Мы выполняем обещания, соблюдаем сроки и стандарты безопасности.\n\n### 03 Результат\nОцениваем работу по результату для клиента и команды, а не по количеству потраченных часов.'),
  ('welcome', 3, 'JanaMen: все HR-сервисы в одном окне', 7,
   E'**JanaMen** это ваш личный кабинет сотрудника.\n\n- **Профиль**: должность, подразделение, руководитель, дата приёма и остаток отпуска. Официальные данные приходят из 1С:ЗУП и доступны только для чтения; чтобы их изменить, оформите заявку «Изменение данных».\n- **Заявки**: отпуск, аванс, справка. Статус и история видны в карточке заявки, а о каждом изменении приходит уведомление.\n- **Jana Academy**: назначенные курсы, прогресс и результаты тестов.\n- **AI Jana**: ответит на типовой HR-вопрос по базе знаний и покажет источник. Если надёжного ответа нет, предложит передать вопрос в HR.\n- **Уведомления**: колокольчик в правом верхнем углу.'),
  ('welcome', 4, 'Первые дни: что важно знать', 7,
   E'### Испытательный срок\nУстанавливается трудовым договором и не может превышать трёх месяцев (Трудовой кодекс РК). В этот период вы проходите адаптационный курс и обязательные инструктажи.\n\n### Охрана труда\nДо начала работы на складе или в ПВЗ пройдите курс «Охрана труда на складе и в ПВЗ».\n\n### Куда обращаться\n- Рабочие вопросы: непосредственный руководитель.\n- Кадровые вопросы: AI Jana, затем HR через кнопку «Спросить HR».\n- Срочные ситуации на смене: старший смены.'),
  ('safety', 1, 'Общие правила безопасности', 8,
   E'- Работайте только в выданной спецодежде и обуви.\n- Проходы и эвакуационные выходы всегда свободны, не ставьте на них коробки и паллеты.\n- В зоне сортировки не пользуйтесь наушниками: вы должны слышать сигналы техники.\n- Сообщайте старшему смены о любой неисправности оборудования.'),
  ('safety', 2, 'Работа с грузами и техникой', 8,
   E'### Ручной подъём\nПрисядьте, держите спину прямо и поднимайте груз за счёт ног, близко к телу. Тяжёлые и крупногабаритные места поднимайте вдвоём или с помощью тележки.\n\n### Погрузочная техника\nУправлять погрузчиком может только обученный сотрудник с допуском. Не находитесь в зоне движения техники и под поднятым грузом.'),
  ('safety', 3, 'Пожарная безопасность и эвакуация', 7,
   E'- Знайте, где находятся огнетушители и план эвакуации вашей зоны.\n- При пожаре: сообщите по номеру **101** или **112**, предупредите коллег, отключите оборудование, если это безопасно, и выходите по плану эвакуации.\n- Не пользуйтесь лифтами при пожаре.'),
  ('safety', 4, 'Что делать при травме', 7,
   E'1. Остановите работу и сообщите старшему смены.\n2. Окажите первую помощь, при необходимости вызовите скорую (**103** или **112**).\n3. Сообщите руководителю: каждый случай фиксируется, даже если травма кажется лёгкой.'),
  ('infosec', 1, 'Пароли и доступы', 5,
   E'- Не передавайте пароль никому, включая коллег и «службу поддержки».\n- Используйте разные пароли для рабочих и личных сервисов, включите двухфакторную аутентификацию.\n- Блокируйте компьютер, когда отходите (Win+L / Ctrl+Cmd+Q).'),
  ('infosec', 2, 'Фишинг: как распознать', 5,
   E'Признаки фишингового письма или сообщения:\n- срочность и давление («аккаунт заблокируют через час»);\n- ссылка ведёт на похожий, но чужой адрес;\n- просьба сообщить пароль, код из SMS или данные карты.\n\nСомневаетесь? Не переходите по ссылке и перешлите письмо в IT.'),
  ('infosec', 3, 'Персональные данные', 5,
   E'Персональные данные клиентов и коллег (ИИН, адрес, телефон, данные посылок) используются только для работы и не передаются третьим лицам.\n\n- Не фотографируйте накладные и экраны с данными клиентов.\n- Не пересылайте данные в личные мессенджеры.\n- В JanaMen каждый видит только то, что разрешено его роли: например, руководитель не видит зарплату и персональные данные сотрудников.'),
  ('infosec', 4, 'Если что-то пошло не так', 5,
   E'Отправили данные не туда, потеряли телефон с рабочими доступами, заметили подозрительную активность, сразу сообщите в IT и руководителю. Быстрая реакция важнее, чем поиск виноватых.'),
  ('service', 1, 'Приветствие и тон', 7,
   E'Здоровайтесь первым, называйте себя и улыбайтесь: даже по телефону это слышно. Говорите на языке клиента: казахском или русском.'),
  ('service', 2, 'Сложные ситуации', 7,
   E'Клиент недоволен задержкой? Выслушайте, не перебивая, признайте проблему, объясните, что вы уже делаете, и назовите срок следующего шага.'),
  ('service', 3, 'Возвраты и претензии', 6,
   E'Примите претензию, зарегистрируйте её в системе и выдайте клиенту номер обращения. Не обещайте того, что не можете гарантировать.')
) as l(slug, sort, title, minutes, content) on l.slug = c.slug;

create table seed_tmp.questions (slug text, sort int, question text, options jsonb, correct int, explanation text);
insert into seed_tmp.questions values
  ('welcome', 1, 'Какие ценности лежат в основе Jana Post?',
   '["Открытость, Надёжность, Результат", "Скорость, Цена, Объём", "Инновации, Рост, Прибыль", "Лояльность, Дисциплина, Контроль"]', 0,
   'Три ценности Jana Post: Открытость, Надёжность и Результат (урок 2).'),
  ('welcome', 2, 'Где оформить заявку на отпуск или аванс?',
   '["В JanaMen → «Заявки»", "Только на бумаге в бухгалтерии", "В личном сообщении руководителю", "По телефону в HR"]', 0,
   'Все типовые заявки оформляются в JanaMen, там же видны статус и история (урок 3).'),
  ('welcome', 3, 'Какова минимальная продолжительность ежегодного оплачиваемого отпуска по Трудовому кодексу РК?',
   '["14 календарных дней", "21 календарный день", "24 календарных дня", "28 календарных дней"]', 2,
   'Ежегодный оплачиваемый трудовой отпуск: не менее 24 календарных дней.'),
  ('welcome', 4, 'Что делает AI Jana, если в базе знаний нет надёжного ответа?',
   '["Честно сообщает об этом и предлагает передать вопрос в HR", "Придумывает правдоподобный ответ", "Отвечает ссылкой на интернет", "Молчит"]', 0,
   'AI Jana отвечает только по базе знаний и показывает источник; без надёжного ответа передаёт вопрос в HR (урок 3).'),
  ('welcome', 5, 'Кто первым согласует заявку на отпуск?',
   '["Непосредственный руководитель", "Генеральный директор", "Бухгалтерия", "Никто, согласуется автоматически"]', 0,
   'Маршрут: руководитель → HR → приказ в 1С:ЗУП.'),
  ('safety', 1, 'Как правильно поднимать тяжёлый груз вручную?',
   '["Присесть, держать спину прямо и поднимать за счёт ног", "Наклониться и поднять рывком", "Поднимать на вытянутых руках", "Тянуть груз на себя спиной"]', 0,
   'Подъём за счёт ног с прямой спиной снижает нагрузку на позвоночник.'),
  ('safety', 2, 'Можно ли ставить коробки в проходе к эвакуационному выходу?',
   '["Нет, проходы и выходы всегда свободны", "Да, если ненадолго", "Да, если это лёгкие коробки", "Только ночью"]', 0,
   'Загромождённый проход может стоить жизни при эвакуации.'),
  ('safety', 3, 'Кто может управлять погрузчиком?',
   '["Только обученный сотрудник с допуском", "Любой сотрудник склада", "Тот, кто умеет водить машину", "Старший смены по устному разрешению"]', 0,
   'К управлению техникой допускаются только обученные сотрудники.'),
  ('safety', 4, 'Что сделать первым при травме коллеги?',
   '["Остановить работу и сообщить старшему смены", "Продолжить смену и сообщить в конце дня", "Самому отвезти коллегу домой", "Ничего, если травма лёгкая"]', 0,
   'Сначала безопасность и сообщение старшему смены; каждый случай фиксируется.'),
  ('safety', 5, 'Почему в зоне сортировки нельзя работать в наушниках?',
   '["Нужно слышать сигналы техники и коллег", "Это мешает музыке", "Так требует дресс-код", "Наушники быстро ломаются"]', 0,
   'Звуковые сигналы техники входят в систему безопасности.'),
  ('infosec', 1, 'Коллега просит ваш пароль, чтобы «быстро проверить заказ». Что делать?',
   '["Отказать: пароль никому не передаётся", "Дать, если это руководитель", "Дать на один раз", "Отправить пароль в мессенджере"]', 0,
   'Пароль не передаётся никому, даже руководителю или «поддержке».'),
  ('infosec', 2, 'Какой признак говорит о фишинге?',
   '["Срочность и просьба ввести пароль по ссылке", "Письмо от коллеги с отчётом", "Приглашение на встречу в календаре", "Рассылка HR о курсе"]', 0,
   'Давление и запрос пароля или кода: главные признаки фишинга.'),
  ('infosec', 3, 'Можно ли сфотографировать экран с данными клиента, чтобы отправить другу?',
   '["Нет, данные используются только для работы", "Да, если без ИИН", "Да, если друг тоже сотрудник", "Да, в личный мессенджер"]', 0,
   'Персональные данные не передаются третьим лицам.'),
  ('infosec', 4, 'Вы потеряли телефон с рабочими доступами. Что делать?',
   '["Сразу сообщить в IT и руководителю", "Подождать, вдруг найдётся", "Ничего, телефон под паролем", "Сообщить через неделю"]', 0,
   'Быстрое сообщение позволяет вовремя заблокировать доступы.'),
  ('service', 1, 'Клиент недоволен задержкой. С чего начать?',
   '["Выслушать, не перебивая, и признать проблему", "Сразу объяснить, что виноват перевозчик", "Попросить прийти позже", "Предложить написать жалобу"]', 0,
   'Сначала выслушать и признать проблему, потом назвать следующий шаг и срок.'),
  ('service', 2, 'На каком языке общаться с клиентом?',
   '["На языке клиента: казахском или русском", "Только на русском", "Только на казахском", "На английском"]', 0,
   'Говорим на языке клиента.'),
  ('service', 3, 'Что выдать клиенту после регистрации претензии?',
   '["Номер обращения", "Ничего", "Личный номер телефона", "Скидку без согласования"]', 0,
   'Номер обращения позволяет клиенту отслеживать претензию.');

insert into public.course_questions (course_id, sort, question, options, explanation)
select c.id, q.sort, q.question, q.options, q.explanation
from seed_tmp.questions q join public.courses c on c.slug = q.slug;

insert into public.course_answer_keys (question_id, correct_index)
select cq.id, q.correct
from seed_tmp.questions q
join public.courses c on c.slug = q.slug
join public.course_questions cq on cq.course_id = c.id and cq.sort = q.sort;

-- Назначения: адаптационный курс — всем, кто пришёл в последние ~14 месяцев; ОТ — логистике; ИБ — всем
create table seed_tmp.assign (tab text, slug text, status text, progress int, score int, attempts int,
                                    due_date date, assigned_at timestamptz, completed_at timestamptz);

insert into seed_tmp.assign
select e.zup_id, 'welcome',
       case when e.zup_id = 'JP-0018' then 'assigned' else 'completed' end,
       case when e.zup_id = 'JP-0018' then 0 else 100 end,
       case when e.zup_id = 'JP-0018' then null else 80 + abs(hashtext(e.zup_id || 'w')) % 21 end,
       case when e.zup_id = 'JP-0018' then 0 else 1 end,
       e.hire_date + 14, e.hire_date::timestamptz,
       case when e.zup_id = 'JP-0018' then null else e.hire_date + 6 + interval '15 hours' end
from public.employees e
where (e.hire_date > current_date - 430 or e.zup_id = 'JP-0013') and e.zup_id <> 'JP-0036';

insert into seed_tmp.assign
select e.zup_id, 'safety',
       case when e.zup_id in ('JP-0015', 'JP-0022') then 'in_progress'
            when e.zup_id = 'JP-0018' then 'assigned'
            else 'completed' end,
       case when e.zup_id in ('JP-0015', 'JP-0022') then 75 when e.zup_id = 'JP-0018' then 0 else 100 end,
       case when e.zup_id = 'JP-0022' then 60 when e.zup_id in ('JP-0015', 'JP-0018') then null
            else 80 + abs(hashtext(e.zup_id || 's')) % 21 end,
       case when e.zup_id = 'JP-0022' then 2 when e.zup_id in ('JP-0015', 'JP-0018') then 0 else 1 end,
       case when e.zup_id = 'JP-0018' then current_date + 7 when e.zup_id = 'JP-0015' then current_date - 6
            else current_date - 120 end,
       case when e.zup_id = 'JP-0018' then now() - interval '5 days' else now() - interval '150 days' end,
       case when e.zup_id in ('JP-0015', 'JP-0022', 'JP-0018') then null
            else now() - interval '140 days' + (abs(hashtext(e.zup_id)) % 20) * interval '1 day' end
from public.employees e
join public.departments d on d.id = e.department_id
where d.zup_id in ('D41', 'D42', 'D43', 'D44');

insert into seed_tmp.assign
select e.zup_id, 'infosec',
       case when e.zup_id in ('JP-0013', 'JP-0018') then 'assigned'
            -- HR и руководство запустили кампанию и прошли курс первыми
            when e.zup_id in ('JP-0001', 'JP-0002', 'JP-0004') then 'completed'
            when abs(hashtext(e.zup_id || 'i')) % 4 = 0 then 'in_progress'
            when abs(hashtext(e.zup_id || 'i')) % 4 = 1 then 'assigned'
            else 'completed' end,
       0, null, 0,
       current_date + 11, now() - interval '3 days', null
from public.employees e where e.zup_id <> 'JP-0034';

update seed_tmp.assign set progress = case status when 'completed' then 100 when 'in_progress' then 50 else 0 end,
                       score = case when status = 'completed' then 80 + abs(hashtext(tab || 'x')) % 21 end,
                       attempts = case when status = 'completed' then 1 else 0 end,
                       -- кампания идёт третий день: прохождения распределены по двум дням с момента старта
                       completed_at = case when status <> 'completed' then null
                                           when tab in ('JP-0001', 'JP-0002', 'JP-0004') then now() - interval '45 hours'
                                           else now() - interval '42 hours' + (abs(hashtext(tab || 'c')) % 41) * interval '1 hour' end
 where slug = 'infosec';

insert into public.course_assignments (course_id, employee_id, status, progress, score, attempts, due_date, assigned_by,
                                       started_at, completed_at, created_at)
select c.id, seed_tmp.emp(a.tab), a.status, a.progress, a.score, a.attempts, a.due_date,
       case when a.slug = 'welcome' then seed_tmp.emp('JP-0004') else seed_tmp.emp('JP-0004') end,
       case when a.status <> 'assigned' then a.assigned_at + interval '1 day' end,
       a.completed_at, a.assigned_at
from seed_tmp.assign a join public.courses c on c.slug = a.slug;

-- Пройденные уроки и попытки теста — согласованы с прогрессом
insert into public.lesson_progress (employee_id, lesson_id, completed_at)
select ca.employee_id, l.id, coalesce(ca.completed_at, now() - interval '2 days') - interval '1 hour'
from public.course_assignments ca
join public.course_lessons l on l.course_id = ca.course_id
where ca.status = 'completed'
   or (ca.status = 'in_progress' and l.sort <= greatest(1, round(ca.progress / 100.0 * (select count(*) + 1 from public.course_lessons x where x.course_id = ca.course_id)) ));

insert into public.course_attempts (course_id, employee_id, score, passed, answers, created_at)
select ca.course_id, ca.employee_id, ca.score, true, '{}'::jsonb, ca.completed_at
from public.course_assignments ca where ca.status = 'completed';
insert into public.course_attempts (course_id, employee_id, score, passed, answers, created_at)
select ca.course_id, ca.employee_id, s.score, false, '{}'::jsonb, now() - s.ago
from public.course_assignments ca
join public.courses c on c.id = ca.course_id and c.slug = 'safety'
cross join (values (40, interval '20 days'), (60, interval '9 days')) s(score, ago)
where ca.employee_id = seed_tmp.emp('JP-0022');

-- ---------- База знаний AI Jana ----------

insert into public.kb_articles (slug, title, title_kk, category, summary, source_title, visibility, keywords, content) values
  ('vacation-annual', 'Ежегодный оплачиваемый отпуск', 'Жыл сайынғы ақылы еңбек демалысы', 'Отпуск',
   'Продолжительность, порядок оформления в JanaMen, сроки подачи и расчёт остатка дней.',
   'Положение об отпусках ТОО «Jana Post», разд. 2 (демо)', 'all', '{отпуск,отдых,демалыс}', ''),
  ('advance', 'Аванс по заявке', 'Өтінім бойынша аванс', 'Оплата труда',
   'Кто и сколько может получить, как оформить и когда придут деньги.',
   'Положение об оплате труда ТОО «Jana Post», разд. 4 (демо)', 'all', '{аванс,предоплата,деньги,зарплата}', ''),
  ('salary', 'Заработная плата и расчётный листок', 'Жалақы және есеп парағы', 'Оплата труда',
   'Сроки выплаты заработной платы и где взять расчётный листок.',
   'Положение об оплате труда ТОО «Jana Post», разд. 2 (демо)', 'all', '{зарплата,зп,оклад,выплата,расчетный,листок}', ''),
  ('sick-leave', 'Больничный', 'Еңбекке уақытша жарамсыздық', 'Отсутствия',
   'Что делать, если заболели, и как оформляется лист временной нетрудоспособности.',
   'Памятка по временной нетрудоспособности (демо)', 'all', '{больничный,болезнь,заболел,болею,лист,нетрудоспособность}', ''),
  ('certificate', 'Справка с места работы', 'Жұмыс орнынан анықтама', 'HR-сервис',
   'Как заказать справку, сроки и языки.',
   'Регламент HR-сервиса JanaMen, п. 3 (демо)', 'all', '{справка,анықтама,документ,виза,банк}', ''),
  ('probation', 'Испытательный срок', 'Сынақ мерзімі', 'Трудовые отношения',
   'Продолжительность испытательного срока и что важно в этот период.',
   'Правила внутреннего трудового распорядка, разд. 3 (демо)', 'all', '{испытательный,срок,испытание,новичок}', ''),
  ('work-schedule', 'Режим работы', 'Жұмыс режимі', 'Трудовые отношения',
   'График работы офиса, склада и ПВЗ, опоздания и перерывы.',
   'Правила внутреннего трудового распорядка, разд. 4 (демо)', 'all', '{график,смена,режим,обед,перерыв,опоздание}', ''),
  ('resignation', 'Увольнение по собственному желанию', 'Өз еркімен жұмыстан шығу', 'Трудовые отношения',
   'Срок предупреждения, обходной лист и расчёт.',
   'Правила внутреннего трудового распорядка, разд. 9 (демо)', 'all', '{увольнение,уволиться,уход,заявление}', ''),
  ('data-change', 'Изменение персональных данных', 'Дербес деректерді өзгерту', 'HR-сервис',
   'Почему данные в профиле только для чтения и как их изменить.',
   'Регламент HR-сервиса JanaMen, п. 5 (демо)', 'all', '{данные,фамилия,адрес,телефон,изменить,профиль}', ''),
  ('academy', 'Обучение в Jana Academy', 'Jana Academy-де оқу', 'Обучение',
   'Обязательные курсы, сроки, тесты и сертификаты.',
   'Положение об обучении персонала (демо)', 'all', '{обучение,курс,тест,сертификат,academy}', ''),
  ('ai-jana', 'Как работает AI Jana', 'AI Jana қалай жұмыс істейді', 'О платформе',
   'Что умеет помощник, откуда берёт ответы и чего не делает.',
   'Политика использования AI Jana (демо)', 'all', '{ассистент,бот,ai,jana,помощник}', ''),
  ('values', 'Ценности Jana Post', 'Jana Post құндылықтары', 'О компании',
   'Открытость, Надёжность, Результат.',
   'Кодекс корпоративной этики Jana Post (демо)', 'all', '{ценности,этика,открытость,надежность,результат}', ''),
  ('business-trip', 'Командировки', 'Іссапарлар', 'Отсутствия',
   'Как оформляется командировка и отчёт о ней.',
   'Положение о служебных командировках (демо)', 'all', '{командировка,поездка,суточные,іссапар}', ''),
  ('benefits', 'Льготы и ДМС', 'Жеңілдіктер және ЕМС', 'Льготы',
   'Добровольное медицинское страхование и другие льготы сотрудникам.',
   'Положение о социальном пакете (демо)', 'all', '{дмс,страховка,льготы,бонусы,медицина}', ''),
  ('manager-approvals', 'Согласование заявок команды', null, 'Для руководителей',
   'SLA согласования, на что смотреть и как отказывать.',
   'Регламент согласования заявок (для руководителей, демо)', 'manager', '{согласование,одобрить,отклонить,команда,sla}', ''),
  ('manager-peak', 'Пиковые периоды и график отпусков', null, 'Для руководителей',
   'Ограничения отпусков в пиковые периоды логистики.',
   'Регламент планирования отпусков (для руководителей, демо)', 'manager', '{пик,11.11,график,отпусков,сезон}', ''),
  ('hr-zup-vacation', 'Оформление отпуска в 1С:ЗУП', null, 'Для HR',
   'Регламент HR: от согласованной заявки до приказа и ознакомления.',
   'Регламент HR-процессов JanaMen ↔ 1С:ЗУП (демо)', 'hr', '{приказ,зуп,1с,оформление,documentolog}', ''),
  ('hr-advance', 'Выплата аванса: работа с ведомостью', null, 'Для HR',
   'Регламент HR и бухгалтерии по авансам.',
   'Регламент выплаты авансов (для HR, демо)', 'hr', '{ведомость,аванс,бухгалтерия,выплата}', '');

create table seed_tmp.chunks (slug text, sort int, heading text, keywords text, content text);
insert into seed_tmp.chunks values
  ('vacation-annual', 1, 'Сколько дней отпуска положено', 'сколько дней положено продолжительность отпуска',
   'Ежегодный оплачиваемый трудовой отпуск: не менее 24 календарных дней (Трудовой кодекс РК). Праздничные дни, приходящиеся на период отпуска, в число дней отпуска не включаются. За первый рабочий год отпуск рассчитывается пропорционально отработанным месяцам.'),
  ('vacation-annual', 2, 'Как оформить отпуск в JanaMen', 'оформить заявку на отпуск как взять',
   'Откройте «Заявки» → «Новая заявка» → «Отпуск», выберите даты. JanaMen сам посчитает дни (без праздников) и проверит остаток. Маршрут: руководитель согласует → HR оформляет приказ в 1С:ЗУП → вы получаете уведомление и знакомитесь с приказом в Documentolog. Статус и история видны в карточке заявки.'),
  ('vacation-annual', 3, 'Сроки подачи заявки', 'заранее за сколько дней подать',
   'Подавайте заявку не позднее чем за 14 календарных дней до начала отпуска, так руководитель успеет спланировать смены. Отпускные перечисляются не позднее чем за 3 календарных дня до начала отпуска.'),
  ('vacation-annual', 4, 'Разделение и перенос отпуска', 'разделить перенести части',
   'По согласованию с руководителем отпуск можно разделить на части; рекомендуется, чтобы одна из частей была не менее 14 календарных дней. Заявку, которая ещё не оформлена HR, можно отменить в JanaMen и подать новую. Перенос уже оформленного отпуска оформляется через HR.'),
  ('vacation-annual', 5, 'Остаток дней отпуска', 'остаток баланс осталось дней',
   'Остаток показан в профиле и на главной странице: положено за год − оформленные отпуска − заявки на согласовании. Данные сверяются с 1С:ЗУП. Неиспользованные дни рекомендуется использовать до конца года по согласованию с руководителем.'),
  ('advance', 1, 'Условия получения аванса', 'сколько можно размер лимит условия',
   'Аванс в счёт заработной платы можно запросить не чаще одного раза в календарный месяц и не более 50% оклада. Сумма проверяется автоматически при создании заявки.'),
  ('advance', 2, 'Как оформить аванс', 'оформить заявку на аванс как получить',
   'Откройте «Заявки» → «Новая заявка» → «Аванс», укажите сумму и комментарий. Маршрут: руководитель согласует → HR передаёт заявку в 1С:ЗУП (ведомость на выплату) → вы получаете уведомление. Деньги поступают на зарплатную карту в течение 3 рабочих дней после оформления.'),
  ('advance', 3, 'Удержание аванса', 'удержание вычет',
   'Сумма аванса удерживается из заработной платы за текущий месяц и отражается в расчётном листке отдельной строкой.'),
  ('salary', 1, 'Когда выплачивается заработная плата', 'когда зарплата выплата дата число',
   'Заработная плата выплачивается не реже одного раза в месяц (Трудовой кодекс РК). В Jana Post два раза в месяц: 25-го числа за первую половину месяца и 10-го числа следующего месяца (окончательный расчёт). Если дата выпадает на выходной, выплата производится накануне.'),
  ('salary', 2, 'Расчётный листок', 'расчетный листок начисления',
   'Расчётный листок формируется в 1С:ЗУП и направляется на рабочую почту в день выплаты. Если листок не пришёл, оформите заявку «Справка» с пометкой «расчётный листок» или задайте вопрос HR.'),
  ('sick-leave', 1, 'Что делать, если вы заболели', 'заболел болезнь больничный что делать',
   'В первый день болезни сообщите непосредственному руководителю любым удобным способом и обратитесь в медицинскую организацию. Лист временной нетрудоспособности оформляет врач; после выздоровления сообщите номер листа HR.'),
  ('sick-leave', 2, 'Оплата больничного', 'оплата больничного пособие',
   'Пособие по временной нетрудоспособности выплачивается в соответствии с законодательством РК вместе с ближайшей выплатой заработной платы после закрытия листа.'),
  ('certificate', 1, 'Как заказать справку', 'заказать получить справку с места работы',
   'Откройте «Заявки» → «Новая заявка» → «Справка», укажите цель (банк, виза, по месту требования), язык (русский, казахский, английский) и количество экземпляров. HR оформляет справку в Documentolog в течение 1 рабочего дня, о готовности придёт уведомление.'),
  ('probation', 1, 'Продолжительность испытательного срока', 'сколько длится испытательный',
   'Испытательный срок устанавливается трудовым договором и не может превышать трёх месяцев (Трудовой кодекс РК). Время болезни и другие периоды отсутствия в испытательный срок не засчитываются.'),
  ('probation', 2, 'Что важно в испытательный срок', 'адаптация новичок испытательный',
   'Пройдите адаптационный курс «Добро пожаловать в Jana Post» и обязательные инструктажи в Jana Academy, познакомьтесь с наставником. Через месяц руководитель проводит встречу по итогам первых недель.'),
  ('work-schedule', 1, 'График работы', 'график режим работы смены часы',
   'Офис: понедельник–пятница, 09:00–18:00, обед 13:00–14:00. Сортировочный центр и склад: сменный график 2/2 по 12 часов (дневная 08:00–20:00, ночная 20:00–08:00). ПВЗ: по графику пункта выдачи.'),
  ('work-schedule', 2, 'Опоздания и отсутствие', 'опоздание опаздываю не выйду',
   'Если опаздываете или не можете выйти на смену, заранее сообщите руководителю или старшему смены. Повторяющиеся опоздания обсуждаются с руководителем.'),
  ('resignation', 1, 'Срок предупреждения', 'уволиться предупредить за сколько',
   'Работник вправе расторгнуть трудовой договор по своей инициативе, письменно предупредив работодателя не позднее чем за один месяц (Трудовой кодекс РК). Заявление передаётся в HR.'),
  ('resignation', 2, 'Обходной лист и расчёт', 'обходной лист расчет последний день',
   'Перед последним рабочим днём сдайте имущество (пропуск, спецодежду, ТСД, ноутбук) и передайте дела. Окончательный расчёт производится в сроки, установленные Трудовым кодексом РК.'),
  ('data-change', 1, 'Почему данные в профиле нельзя изменить самому', 'изменить данные профиль фамилия',
   'Официальные кадровые данные (ФИО, должность, подразделение, дата приёма, оклад) ведутся в 1С:ЗУП и в JanaMen доступны только для чтения. Так данные остаются одинаковыми во всех системах.'),
  ('data-change', 2, 'Как изменить данные', 'сменить фамилию адрес телефон документы',
   'Оформите заявку «Изменение данных»: укажите, что изменить, и новое значение. Подтверждающий документ (например, свидетельство о браке) передайте в HR. После внесения изменений в 1С:ЗУП данные обновятся в профиле при синхронизации.'),
  ('academy', 1, 'Обязательные курсы', 'обязательный курс назначен срок',
   'Обязательные курсы назначает HR или руководитель, срок прохождения указан в карточке курса. О назначении и завершении курса приходит уведомление. Просроченные обязательные курсы видны руководителю и HR.'),
  ('academy', 2, 'Тест и сертификат', 'тест сертификат пересдать проходной балл',
   'Курс завершается тестом. Проходной балл указан в курсе (обычно 70–80%). Если не набрали, повторите материал и пересдайте тест, количество попыток не ограничено. После успешного прохождения в профиле появляется результат и сертификат.'),
  ('ai-jana', 1, 'Откуда AI Jana берёт ответы', 'источник ответа база знаний',
   'AI Jana отвечает только по утверждённой базе знаний HR и к каждому ответу прикладывает ссылку на источник. Свои личные данные (остаток отпуска, статус заявок, курсы) помощник берёт из вашего профиля.'),
  ('ai-jana', 2, 'Чего AI Jana не делает', 'не делает решения чужие данные',
   'AI Jana не принимает кадровые решения, не придумывает правила и не раскрывает данные других сотрудников. Если надёжного ответа нет, помощник честно скажет об этом и предложит передать вопрос в HR.'),
  ('values', 1, 'Три ценности Jana Post', 'ценности открытость надежность результат',
   'Открытость: говорим прямо и делимся информацией. Надёжность: выполняем обещания клиенту и коллегам. Результат: оцениваем работу по результату для клиента и команды.'),
  ('business-trip', 1, 'Как оформить командировку', 'командировка оформить суточные',
   'Командировка оформляется приказом по служебной записке руководителя. Суточные, проезд и проживание оплачиваются по нормам компании. Авансовый отчёт сдаётся в бухгалтерию в течение 3 рабочих дней после возвращения. Электронная заявка на командировку появится в JanaMen в следующей версии.'),
  ('benefits', 1, 'Добровольное медицинское страхование', 'дмс страховка медицина',
   'ДМС предоставляется сотрудникам после успешного прохождения испытательного срока. Программа включает амбулаторное лечение и стоматологию. Полис оформляет HR.'),
  ('benefits', 2, 'Другие льготы', 'льготы бонусы обучение спорт',
   'Бесплатное обучение в Jana Academy, корпоративные мероприятия, бонус за рекомендацию кандидата после прохождения им испытательного срока.'),
  ('manager-approvals', 1, 'Срок согласования', 'sla срок согласовать заявку',
   'Руководитель рассматривает заявку команды в течение 2 рабочих дней. Заявки, которые ждут дольше, подсвечиваются в мониторинге HR.'),
  ('manager-approvals', 2, 'На что смотреть при согласовании', 'одобрить отклонить проверить',
   'Перед согласованием отпуска проверьте остаток дней (виден в заявке), пересечения с отпусками команды и пиковые периоды. Отказ всегда сопровождается понятной причиной и альтернативой, например другими датами.'),
  ('manager-peak', 1, 'Ограничения в пиковые периоды', 'пик 11.11 новый год ограничение отпусков',
   'С 16 по 30 ноября (после распродаж 11.11) и с 10 по 28 декабря в подразделениях склада, доставки и ПВЗ одновременно может отсутствовать не более 10% сотрудников смены. Отпуска на эти даты согласуются с директором по логистике.'),
  ('hr-zup-vacation', 1, 'Порядок оформления', 'приказ оформление зуп',
   'После согласования руководителем HR проверяет заявку и нажимает «Оформить»: JanaMen передаёт событие в 1С:ЗУП (приказ об отпуске) и в Documentolog (лист ознакомления). Номера документов сохраняются в карточке заявки, работник получает уведомление.'),
  ('hr-advance', 1, 'Работа с ведомостью', 'ведомость выплата аванса',
   'Оформленные авансы попадают в ведомость 1С:ЗУП. Бухгалтерия формирует платёжное поручение в течение 1 рабочего дня; зачисление на карту занимает до 3 рабочих дней.');

insert into public.kb_chunks (article_id, sort, heading, keywords, content)
select a.id, c.sort, c.heading, c.keywords || ' ' || array_to_string(a.keywords, ' '), c.content
from seed_tmp.chunks c join public.kb_articles a on a.slug = c.slug;

update public.kb_articles a set content = (
  select string_agg('## ' || c.heading || E'\n\n' || c.content, E'\n\n' order by c.sort)
  from public.kb_chunks c where c.article_id = a.id);

-- ---------- Вопросы к AI Jana и обращения в HR (история для аналитики) ----------

insert into public.ai_queries (employee_id, question, answer, status, mode, sources, created_at)
select seed_tmp.emp('JP-' || lpad((3 + (g * 7) % 31)::text, 4, '0')), q.question, q.answer, q.status, 'kb',
       case when q.slug is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('slug', q.slug)) end,
       now() - (g % 14) * interval '1 day' - (g % 7) * interval '1 hour'
from generate_series(1, 42) g
join (values
  (0, 'Сколько дней отпуска мне положено?', 'Не менее 24 календарных дней…', 'answered', 'vacation-annual'),
  (1, 'Как оформить аванс?', 'Заявки → Новая заявка → Аванс…', 'answered', 'advance'),
  (2, 'Когда выплачивают зарплату?', '25-го и 10-го числа…', 'answered', 'salary'),
  (3, 'Как заказать справку с места работы?', 'Заявки → Справка…', 'answered', 'certificate'),
  (4, 'Положена ли компенсация за проезд на ночную смену?', null, 'no_answer', null),
  (5, 'Сколько у меня осталось дней отпуска?', 'Доступно …', 'personal', null),
  (6, 'Как оформить отпуск по уходу за ребёнком?', null, 'no_answer', null),
  (7, 'Что делать, если заболел?', 'Сообщите руководителю…', 'answered', 'sick-leave'),
  (8, 'Какая зарплата у моего руководителя?', 'Я не раскрываю данные других сотрудников.', 'refused', null),
  (9, 'Как пересдать тест по охране труда?', 'Повторите материал…', 'answered', 'academy'),
  (10, 'Когда корпоратив?', null, 'no_answer', null),
  (11, 'За сколько дней предупреждать об увольнении?', 'Не позднее чем за один месяц…', 'answered', 'resignation'),
  (12, 'Как сменить фамилию в профиле?', 'Заявка «Изменение данных»…', 'answered', 'data-change'),
  (13, 'Положена ли компенсация за проезд на ночную смену?', null, 'no_answer', null)
) as q(k, question, answer, status, slug) on q.k = g % 14;

insert into public.hr_tickets (employee_id, question, status, answer, answered_by, created_at, answered_at) values
  (seed_tmp.emp('JP-0015'), 'Положена ли компенсация за проезд, если смена заканчивается ночью?', 'open', null, null, now() - interval '1 day', null),
  (seed_tmp.emp('JP-0026'), 'Как оформить отпуск по уходу за ребёнком и какие документы нужны?', 'open', null, null, now() - interval '5 hours', null),
  (seed_tmp.emp('JP-0030'), 'Можно ли перенести неиспользованные дни отпуска на следующий год?', 'answered',
   'Да, по согласованию с руководителем неиспользованные дни переносятся на следующий год. Оформите заявку на отпуск на нужные даты, остаток учтётся автоматически.',
   seed_tmp.emp('JP-0002'), now() - interval '6 days', now() - interval '5 days');

-- ---------- Задачи ----------

insert into public.tasks (title, description, assignee_id, created_by, priority, status, category, due_date, created_at, started_at, completed_at) values
  ('Провести инструктаж новичка по работе с ТСД', 'Тимур Ахметов, 5-й день. Показать сканирование, пересорт и маркировку мест.', seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'high', 'in_progress', 'warehouse', current_date + 2, now() - interval '3 days', now() - interval '2 days', null),
  ('Инвентаризация зоны B-12', 'Сверить остатки с WMS, расхождения внести в отчёт до конца смены.', seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'medium', 'todo', 'warehouse', current_date + 5, now() - interval '1 day', null, null),
  ('Пройти курс «Информационная безопасность»', 'Обязательный курс для всех сотрудников, он есть в Jana Academy.', seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0004'), 'medium', 'todo', 'training', current_date + 11, now() - interval '3 days', null, null),
  ('Отчёт по ошибкам сортировки за неделю', null, seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'medium', 'done', 'warehouse', current_date - 2, now() - interval '7 days', now() - interval '6 days', now() - interval '2 days'),
  ('Пройти курс «Добро пожаловать в Jana Post»', 'Адаптационный курс на 25 минут.', seed_tmp.emp('JP-0018'), seed_tmp.emp('JP-0004'), 'high', 'todo', 'training', current_date + 9, now() - interval '5 days', null, null),
  ('Получить спецодежду и пропуск', null, seed_tmp.emp('JP-0018'), seed_tmp.emp('JP-0012'), 'high', 'done', 'hr', current_date - 4, now() - interval '5 days', now() - interval '5 days', now() - interval '4 days'),
  ('Подготовить план смен на пик 11.11', 'Учесть рост объёма на 60% с 16 по 30 ноября и согласованные отпуска.', seed_tmp.emp('JP-0012'), seed_tmp.emp('JP-0011'), 'urgent', 'in_progress', 'logistics', current_date + 7, now() - interval '4 days', now() - interval '3 days', null),
  ('Согласовать график отпусков склада на декабрь', null, seed_tmp.emp('JP-0012'), seed_tmp.emp('JP-0011'), 'medium', 'todo', 'logistics', current_date + 14, now() - interval '2 days', null, null),
  ('Перемаркировать стеллажи зоны C', null, seed_tmp.emp('JP-0015'), seed_tmp.emp('JP-0012'), 'medium', 'todo', 'warehouse', current_date - 3, now() - interval '9 days', null, null),
  ('Сдать отчёт по возвратам за сентябрь', null, seed_tmp.emp('JP-0015'), seed_tmp.emp('JP-0012'), 'low', 'in_progress', 'warehouse', current_date - 1, now() - interval '8 days', now() - interval '6 days', null),
  ('Проверить исправность погрузчика №2', 'Перед ночной сменой.', seed_tmp.emp('JP-0017'), seed_tmp.emp('JP-0012'), 'high', 'review', 'warehouse', current_date, now() - interval '1 day', now() - interval '20 hours', null),
  ('Принять партию из Урумчи (рейс 1015)', null, seed_tmp.emp('JP-0014'), seed_tmp.emp('JP-0012'), 'high', 'todo', 'logistics', current_date + 1, now() - interval '5 hours', null, null),
  ('Обновить скрипты ответов по возвратам', null, seed_tmp.emp('JP-0030'), seed_tmp.emp('JP-0029'), 'medium', 'in_progress', 'client', current_date + 4, now() - interval '3 days', now() - interval '2 days', null),
  ('Подготовить отчёт по обучению за квартал', 'Курсы, прогресс, просрочки по подразделениям.', seed_tmp.emp('JP-0004'), seed_tmp.emp('JP-0002'), 'medium', 'in_progress', 'hr', current_date + 6, now() - interval '2 days', now() - interval '1 day', null),
  ('Ответить на обращения сотрудников в JanaMen', null, seed_tmp.emp('JP-0003'), seed_tmp.emp('JP-0002'), 'high', 'todo', 'hr', current_date + 1, now() - interval '1 day', null, null);

-- ---------- Объявления ----------

insert into public.announcements (title, body, category, pinned, audience_department_id, author_id, created_at) values
  ('JanaMen: все HR-сервисы в одном окне',
   E'Коллеги, запускаем JanaMen, единую HR-платформу.\n\nЗдесь вы оформляете отпуск и аванс, видите статусы заявок, проходите курсы Jana Academy и задаёте вопросы AI Jana. Официальные данные подтягиваются из 1С:ЗУП.',
   'hr', true, null, seed_tmp.emp('JP-0002'), now() - interval '6 days'),
  ('Подготовка к пику 11.11',
   E'С 16 по 30 ноября ожидаем рост объёма на 50–60%. Склад, доставка и ПВЗ работают по усиленному графику. Отпуска на эти даты только по согласованию с директором по логистике.',
   'logistics', true, null, seed_tmp.emp('JP-0011'), now() - interval '3 days'),
  ('Плановая инвентаризация в субботу',
   E'В субботу с 08:00 инвентаризация зон B и C. Старшие смен, проверьте ТСД и распечатайте листы пересчёта.',
   'urgent', false, (select id from public.departments where zup_id = 'D41'), seed_tmp.emp('JP-0012'), now() - interval '1 day'),
  ('25 октября: День Республики',
   E'25 октября: государственный праздник. Так как он выпадает на воскресенье, понедельник 26 октября выходной. Склад и ПВЗ работают по отдельному графику.',
   'event', false, null, seed_tmp.emp('JP-0003'), now() - interval '2 days'),
  ('Обязательный курс по информационной безопасности',
   E'Всем сотрудникам назначен курс «Информационная безопасность и персональные данные» (20 минут). Пройдите его до конца месяца в Jana Academy.',
   'hr', false, null, seed_tmp.emp('JP-0004'), now() - interval '3 days'),
  ('Открыт новый пункт выдачи в Шымкенте',
   E'ПВЗ в Шымкенте работает ежедневно с 09:00 до 21:00. Спасибо команде сети ПВЗ за быстрый запуск!',
   'news', false, null, seed_tmp.emp('JP-0025'), now() - interval '9 days');

insert into public.announcement_reads (announcement_id, employee_id, read_at)
select a.id, e.id, a.created_at + interval '3 hours'
from public.announcements a cross join public.employees e
where abs(hashtext(a.id::text || e.id::text)) % 3 <> 0 and e.zup_id not in ('JP-0013', 'JP-0018')
  and (a.audience_department_id is null or a.audience_department_id = e.department_id);

-- ---------- Мониторинг HR ----------

insert into public.watchlist (employee_id, added_by, reason, created_at) values
  (seed_tmp.emp('JP-0017'), seed_tmp.emp('JP-0002'),
   'Давно без отпуска, высокая нагрузка в смене. Обсудить отпуск после пика 11.11', now() - interval '4 days'),
  (seed_tmp.emp('JP-0015'), seed_tmp.emp('JP-0002'),
   'Просрочено обучение по охране труда, две задачи после срока', now() - interval '2 days'),
  (seed_tmp.emp('JP-0018'), seed_tmp.emp('JP-0002'), 'Новичок, первая неделя', now() - interval '5 days');

-- ---------- Логистика: 120 дней операционных показателей ----------

insert into public.logistics_daily (day, location_id, parcels_in, parcels_processed, parcels_delivered, delivered_on_time,
                                    errors, staff_on_shift)
select d.day, l.id, v.parcels_in, v.processed,
       round(v.processed * 0.965)::int,
       round(v.processed * 0.965 * (0.925 + (abs(hashtext(d.day::text || l.name || 't')) % 50) / 1000.0))::int,
       round(v.processed * (0.003 + (abs(hashtext(d.day::text || l.name || 'e')) % 40) / 10000.0))::int,
       ceil(v.processed / lb.productivity)::int
from generate_series(current_date - 120, current_date - 1, interval '1 day') d(day)
cross join (values ('Сортировочный центр Алматы', 1450, 175.0), ('Склад консолидации Урумчи', 1100, 150.0),
                   ('ПВЗ Астана', 320, 115.0), ('ПВЗ Караганда', 230, 110.0), ('ПВЗ Шымкент', 170, 105.0))
  as lb(name, base, productivity)
join public.locations l on l.name = lb.name
cross join lateral (
  select round(lb.base
               * (1 + 0.0016 * (d.day::date - (current_date - 120)))
               * (case extract(isodow from d.day) when 1 then 1.16 when 2 then 1.10 when 3 then 1.05 when 4 then 1.0
                                                  when 5 then 0.96 when 6 then 0.84 else 0.72 end)
               * (0.94 + (abs(hashtext(d.day::text || l.name)) % 120) / 1000.0))::int as parcels_in
) p
cross join lateral (
  select p.parcels_in,
         round(p.parcels_in * (0.972 + (abs(hashtext(d.day::text || l.name || 'p')) % 25) / 1000.0))::int as processed
) v;

-- ---------- Уведомления для демо-аккаунтов ----------

insert into public.notifications (employee_id, title, body, link, kind, read_at, created_at) values
  (seed_tmp.emp('JP-0013'), 'Назначен курс: Информационная безопасность и персональные данные', 'Jana Academy · пройти до ' || to_char(current_date + 11, 'DD.MM.YYYY'), '/academy/infosec', 'course', null, now() - interval '3 days'),
  (seed_tmp.emp('JP-0013'), 'Новая задача №103', 'Пройти курс «Информационная безопасность»', '/tasks', 'task', null, now() - interval '3 days'),
  (seed_tmp.emp('JP-0013'), 'Новая задача №102', 'Инвентаризация зоны B-12 · до ' || to_char(current_date + 5, 'DD.MM'), '/tasks', 'task', null, now() - interval '1 day'),
  (seed_tmp.emp('JP-0013'), 'Заявка №1004 отклонена', 'Отпуск: Пик сезона после 11.11. Перенесите, пожалуйста, на декабрь. Готов согласовать с 14.12', '/requests', 'warning', now() - interval '10 days', now() - interval '11 days'),
  (seed_tmp.emp('JP-0013'), 'Заявка оформлена', 'Справка готова, см. карточку заявки', '/requests', 'success', now() - interval '18 days', now() - interval '19 days'),
  (seed_tmp.emp('JP-0012'), 'Новая заявка: Отпуск', 'Бауыржан Утепов · ' || to_char(current_date + 21, 'DD.MM') || '–' || to_char(current_date + 34, 'DD.MM.YYYY'), '/approvals', 'request', null, now() - interval '2 days'),
  (seed_tmp.emp('JP-0012'), 'Новая заявка: Аванс', 'Олжас Кенжебаев · 80 000 ₸', '/approvals', 'request', null, now() - interval '20 hours'),
  (seed_tmp.emp('JP-0012'), 'Задача №111 на проверке', 'Мирас Жаксылыков: Проверить исправность погрузчика №2', '/tasks', 'task', null, now() - interval '3 hours'),
  (seed_tmp.emp('JP-0002'), 'Оформите заявку', 'Айдана Калиева · Отпуск: согласовано руководителем', '/approvals', 'request', null, now() - interval '6 days' + interval '3 hours'),
  (seed_tmp.emp('JP-0002'), 'Новое обращение', 'Олжас Кенжебаев: «Положена ли компенсация за проезд, если смена заканчивается ночью?»', '/tickets', 'ticket', null, now() - interval '1 day'),
  (seed_tmp.emp('JP-0002'), 'Новое обращение', 'Сабина Мусина: «Как оформить отпуск по уходу за ребёнком?»', '/tickets', 'ticket', null, now() - interval '5 hours'),
  (seed_tmp.emp('JP-0018'), 'Добро пожаловать в Jana Post! 👋', 'Начните с курса «Добро пожаловать в Jana Post» в Jana Academy', '/academy/welcome', 'course', null, now() - interval '5 days'),
  (seed_tmp.emp('JP-0018'), 'Назначен курс: Охрана труда на складе и в ПВЗ', 'Jana Academy · пройти до ' || to_char(current_date + 7, 'DD.MM.YYYY'), '/academy/safety', 'course', null, now() - interval '5 days');

-- ---------- Включаем триггеры обратно ----------

alter table public.requests enable trigger trg_requests_after_insert;
alter table public.course_assignments enable trigger trg_course_assignments_notify;
alter table public.tasks enable trigger trg_tasks_notify;
alter table public.announcements enable trigger trg_announcements_notify;
alter table public.hr_tickets enable trigger trg_hr_tickets_after_insert;

-- Журнал аудита начинаем с чистого листа
truncate table public.audit_log restart identity;

drop schema if exists seed_tmp cascade;


notify pgrst, 'reload schema';
