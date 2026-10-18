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
  emoji            text not null default '',
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
  select w.added_by, 'Слежу · ' || public.employee_name(p_employee) || ': ' || p_title, p_body, p_link, coalesce(p_kind, 'info')
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
    perform public.notify(p_employee, 'Запланируйте отпуск',
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
                     and n.title = 'Слежу · ' || public.employee_name(x.employee_id) || ': ' || x.title) then
      insert into public.notifications (employee_id, title, body, link, kind)
      values (v_me, 'Слежу · ' || public.employee_name(x.employee_id) || ': ' || x.title, x.body, '/employees/' || x.employee_id, 'warning');
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
    perform public.notify(r.employee_id, 'Заявка №' || r.number || ' оформлена', v_msg, '/requests', 'success');
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
-- migration: 20261017100000_profile_chat.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================================
-- JanaMen: фото профиля и сообщения между сотрудниками
-- =====================================================================

-- ---------- Фото профиля ----------
-- Браузер уменьшает картинку до 256×256 и присылает data URL; фото хранится прямо в базе,
-- поэтому одинаково работает в Supabase Cloud и в Docker-стеке без файлового хранилища.

create table if not exists public.employee_avatars (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  image text not null,
  updated_at timestamptz not null default now(),
  constraint employee_avatars_image_check
    check (image ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' and length(image) <= 400000)
);

drop trigger if exists trg_employee_avatars_updated_at on public.employee_avatars;
create trigger trg_employee_avatars_updated_at before update on public.employee_avatars
  for each row execute function public.set_updated_at();

alter table public.employee_avatars enable row level security;
drop policy if exists employee_avatars_select on public.employee_avatars;
drop policy if exists employee_avatars_insert on public.employee_avatars;
drop policy if exists employee_avatars_update on public.employee_avatars;
drop policy if exists employee_avatars_delete on public.employee_avatars;
-- фото, как и рабочий профиль, видят все сотрудники; менять можно только своё
create policy employee_avatars_select on public.employee_avatars for select to authenticated using (true);
create policy employee_avatars_insert on public.employee_avatars for insert to authenticated
  with check (employee_id = public.current_employee_id());
create policy employee_avatars_update on public.employee_avatars for update to authenticated
  using (employee_id = public.current_employee_id()) with check (employee_id = public.current_employee_id());
create policy employee_avatars_delete on public.employee_avatars for delete to authenticated
  using (employee_id = public.current_employee_id());

-- ---------- Сообщения ----------

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct', 'group')),
  title text check (title is null or length(btrim(title)) between 1 and 80),
  created_by uuid,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint chats_created_by_fk foreign key (created_by) references public.employees (id) on delete set null
);

create table if not exists public.chat_members (
  chat_id uuid not null,
  employee_id uuid not null,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (chat_id, employee_id),
  constraint chat_members_chat_fk foreign key (chat_id) references public.chats (id) on delete cascade,
  constraint chat_members_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade
);
create index if not exists chat_members_employee_idx on public.chat_members (employee_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null,
  author_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  reply_to uuid,
  created_at timestamptz not null default now(),
  constraint chat_messages_chat_fk foreign key (chat_id) references public.chats (id) on delete cascade,
  constraint chat_messages_author_fk foreign key (author_id) references public.employees (id) on delete cascade,
  constraint chat_messages_reply_fk foreign key (reply_to) references public.chat_messages (id) on delete set null
);
create index if not exists chat_messages_chat_idx on public.chat_messages (chat_id, created_at);

-- Участник ли текущий пользователь чата (security definer: без рекурсии политик)
create or replace function public.is_chat_member(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members m
                 where m.chat_id = p_chat and m.employee_id = public.current_employee_id())
$$;

-- Переписку видят только её участники, даже HR; писать можно только через функции ниже
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
drop policy if exists chats_select on public.chats;
drop policy if exists chat_members_select on public.chat_members;
drop policy if exists chat_messages_select on public.chat_messages;
create policy chats_select on public.chats for select to authenticated using (public.is_chat_member(id));
create policy chat_members_select on public.chat_members for select to authenticated using (public.is_chat_member(chat_id));
create policy chat_messages_select on public.chat_messages for select to authenticated using (public.is_chat_member(chat_id));

-- Личный чат с коллегой: находит существующий или создаёт новый
create or replace function public.open_direct_chat(p_employee uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_chat uuid;
begin
  if v_me is null then raise exception 'Сотрудник не найден' using errcode = '42501'; end if;
  if p_employee is null or p_employee = v_me then raise exception 'Выберите коллегу'; end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.status <> 'terminated') then
    raise exception 'Сотрудник не найден';
  end if;
  select c.id into v_chat from public.chats c
   where c.kind = 'direct'
     and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.employee_id = v_me)
     and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.employee_id = p_employee)
   limit 1;
  if v_chat is null then
    insert into public.chats (kind, created_by) values ('direct', v_me) returning id into v_chat;
    insert into public.chat_members (chat_id, employee_id) values (v_chat, v_me), (v_chat, p_employee);
  end if;
  return v_chat;
end $$;

-- Групповой чат: создатель и минимум двое коллег
create or replace function public.create_group_chat(p_title text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_chat uuid; v_ids uuid[];
begin
  if v_me is null then raise exception 'Сотрудник не найден' using errcode = '42501'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'Укажите название группы'; end if;
  select array_agg(distinct e.id) into v_ids from public.employees e
   where e.id = any (coalesce(p_members, '{}')) and e.id <> v_me and e.status <> 'terminated';
  if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception 'Для группы выберите хотя бы двух коллег'; end if;
  if array_length(v_ids, 1) > 100 then raise exception 'В группе может быть не больше 100 человек'; end if;
  insert into public.chats (kind, title, created_by) values ('group', left(btrim(p_title), 80), v_me) returning id into v_chat;
  insert into public.chat_members (chat_id, employee_id) select v_chat, x from unnest(v_ids || v_me) x;
  return v_chat;
end $$;

-- Отправка сообщения (можно ответом на другое сообщение того же чата)
create or replace function public.send_message(p_chat uuid, p_body text, p_reply_to uuid default null)
returns public.chat_messages language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_body text := btrim(coalesce(p_body, '')); v_msg public.chat_messages;
begin
  if v_me is null or not public.is_chat_member(p_chat) then raise exception 'Чат не найден' using errcode = '42501'; end if;
  if v_body = '' then raise exception 'Сообщение пустое'; end if;
  if length(v_body) > 4000 then raise exception 'Сообщение длиннее 4000 символов'; end if;
  if p_reply_to is not null
     and not exists (select 1 from public.chat_messages m where m.id = p_reply_to and m.chat_id = p_chat) then
    raise exception 'Сообщение для ответа не найдено';
  end if;
  insert into public.chat_messages (chat_id, author_id, body, reply_to)
  values (p_chat, v_me, v_body, p_reply_to) returning * into v_msg;
  update public.chats set last_message_at = v_msg.created_at where id = p_chat;
  update public.chat_members set last_read_at = v_msg.created_at where chat_id = p_chat and employee_id = v_me;
  return v_msg;
end $$;

create or replace function public.mark_chat_read(p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.chat_members set last_read_at = now()
   where chat_id = p_chat and employee_id = public.current_employee_id();
end $$;

-- Список чатов пользователя: собеседник или название группы, последнее сообщение, непрочитанные
drop function if exists public.chat_list();
create or replace function public.chat_list()
returns table (id uuid, kind text, title text, peer_id uuid, member_count integer,
               last_body text, last_author_id uuid, last_author_name text, last_at timestamptz, unread integer)
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id();
begin
  return query
  select c.id, c.kind,
         case when c.kind = 'direct' then public.employee_name(peer.employee_id) else c.title end,
         peer.employee_id,
         (select count(*)::int from public.chat_members m where m.chat_id = c.id),
         lm.body, lm.author_id, public.employee_name(lm.author_id), coalesce(lm.created_at, c.created_at),
         (select count(*)::int from public.chat_messages x
           where x.chat_id = c.id and x.author_id <> v_me and x.created_at > mine.last_read_at)
  from public.chat_members mine
  join public.chats c on c.id = mine.chat_id
  left join lateral (select m.employee_id from public.chat_members m
                      where c.kind = 'direct' and m.chat_id = c.id and m.employee_id <> v_me limit 1) peer on true
  left join lateral (select x.body, x.author_id, x.created_at from public.chat_messages x
                      where x.chat_id = c.id order by x.created_at desc limit 1) lm on true
  where mine.employee_id = v_me
  order by coalesce(lm.created_at, c.created_at) desc;
end $$;

-- ---------- Права ----------

grant select, insert, update, delete on public.employee_avatars to authenticated, service_role;
grant select on public.chats, public.chat_members, public.chat_messages to authenticated;
revoke insert, update, delete on public.chats, public.chat_members, public.chat_messages from authenticated;
grant select, insert, update, delete on public.chats, public.chat_members, public.chat_messages to service_role;
revoke all on public.employee_avatars, public.chats, public.chat_members, public.chat_messages from anon;

do $$
declare f text;
begin
  foreach f in array array[
    'public.is_chat_member(uuid)', 'public.open_direct_chat(uuid)', 'public.create_group_chat(text, uuid[])',
    'public.send_message(uuid, text, uuid)', 'public.mark_chat_read(uuid)', 'public.chat_list()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------- Realtime: новые сообщения приходят сразу ----------

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.chat_messages;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- migration: 20261018100000_v2_tasks_academy.sql
-- ─────────────────────────────────────────────────────────────────────
-- =====================================================================
-- JanaMen — 8. Задачи с типами и дедлайнами, практика в Jana Academy,
-- объявления с обложками, массовые напоминания HR
-- =====================================================================

-- ---------- Задачи: тип, дедлайн со временем, чек-лист, результат ----------

alter table public.tasks add column if not exists kind text not null default 'simple';
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('simple', 'course', 'report', 'checklist'));
alter table public.tasks add column if not exists course_id uuid;
alter table public.tasks drop constraint if exists tasks_course_fk;
alter table public.tasks add constraint tasks_course_fk foreign key (course_id) references public.courses (id) on delete set null;
-- Дедлайн с точным временем (due_date остаётся для аналитики и совместимости, заполняется триггером)
alter table public.tasks add column if not exists due_at timestamptz;
-- Чек-лист: [{"text": "...", "done": false}]
alter table public.tasks add column if not exists checklist jsonb not null default '[]'::jsonb;
-- Результат для задач-отчётов
alter table public.tasks add column if not exists result_note text;
alter table public.tasks add column if not exists submitted_at timestamptz;
alter table public.tasks add column if not exists review_comment text;

-- Вложения к результату задачи (фото, PDF): хранятся в базе как data URL, до ~3 МБ
create table if not exists public.task_attachments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  author_id  uuid,
  name       text not null,
  mime       text not null,
  size       integer not null check (size between 1 and 3145728),
  data       text not null,
  created_at timestamptz not null default now(),
  constraint task_attachments_task_fk   foreign key (task_id)   references public.tasks (id) on delete cascade,
  constraint task_attachments_author_fk foreign key (author_id) references public.employees (id) on delete set null
);
create index if not exists task_attachments_task_idx on public.task_attachments (task_id, created_at);
alter table public.task_attachments enable row level security;
grant select, insert, delete on public.task_attachments to authenticated;

drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
drop policy if exists task_attachments_insert on public.task_attachments;
create policy task_attachments_insert on public.task_attachments for insert to authenticated
  with check (author_id = (select public.current_employee_id())
              and exists (select 1 from public.tasks t where t.id = task_id
                          and (t.assignee_id = (select public.current_employee_id())
                               or t.created_by = (select public.current_employee_id()))));
drop policy if exists task_attachments_delete on public.task_attachments;
create policy task_attachments_delete on public.task_attachments for delete to authenticated
  using (author_id = (select public.current_employee_id())
         and exists (select 1 from public.tasks t where t.id = task_id and t.status <> 'done'));

create or replace function public.tasks_before_insert()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.created_by := public.current_employee_id();
  end if;
  if new.due_at is null and new.due_date is not null then
    new.due_at := (new.due_date + time '18:00') at time zone 'Asia/Almaty';
  end if;
  if new.due_at is not null then new.due_date := (new.due_at at time zone 'Asia/Almaty')::date; end if;
  if new.kind = 'course' and new.course_id is null then
    raise exception 'Для задачи «Пройти курс» выберите курс';
  end if;
  if new.kind = 'checklist' and jsonb_array_length(coalesce(new.checklist, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте хотя бы один шаг чек-листа';
  end if;
  if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
  if new.status = 'done' and new.completed_at is null then new.completed_at := now(); end if;
  return new;
end $$;

-- Кто что может менять в задаче:
--   постановщик, руководитель исполнителя и HR — всё;
--   исполнитель — статус (по правилам типа задачи), отметки чек-листа и результат.
create or replace function public.guard_task_update()
returns trigger language plpgsql as $$
declare
  v_me uuid := public.current_employee_id();
  v_reviewer boolean;
  v_has_result boolean;
begin
  if current_user = 'authenticated' then
    v_reviewer := public.is_hr() or old.created_by = v_me or public.is_manager_of(old.assignee_id);

    if not v_reviewer then
      if (new.title, new.description, new.assignee_id, new.created_by, new.priority, new.category, new.due_date,
          new.due_at, new.kind, new.course_id, new.review_comment)
         is distinct from
         (old.title, old.description, old.assignee_id, old.created_by, old.priority, old.category, old.due_date,
          old.due_at, old.kind, old.course_id, old.review_comment) then
        raise exception 'Исполнитель может менять только ход выполнения задачи' using errcode = '42501';
      end if;
      -- В чек-листе исполнитель отмечает шаги, но не меняет их текст и количество
      if (select coalesce(jsonb_agg(x -> 'text'), '[]'::jsonb) from jsonb_array_elements(new.checklist) x)
         is distinct from
         (select coalesce(jsonb_agg(x -> 'text'), '[]'::jsonb) from jsonb_array_elements(old.checklist) x) then
        raise exception 'Шаги чек-листа меняет постановщик' using errcode = '42501';
      end if;
    end if;

    if new.status is distinct from old.status then
      -- Курс: статус задачи ведёт сама Jana Academy
      if old.kind = 'course' and new.status = 'done'
         and not exists (select 1 from public.course_assignments a
                         where a.course_id = old.course_id and a.employee_id = old.assignee_id and a.status = 'completed') then
        raise exception 'Задача закроется сама, когда курс будет пройден' using errcode = '42501';
      end if;
      -- Отчёт: на проверку только с результатом, принимает постановщик
      if old.kind = 'report' then
        select coalesce(nullif(trim(new.result_note), ''), null) is not null
               or exists (select 1 from public.task_attachments a where a.task_id = old.id)
          into v_has_result;
        if new.status = 'review' and not v_has_result then
          raise exception 'Приложите результат: комментарий или файл' using errcode = '23514';
        end if;
        if new.status = 'done' and not v_reviewer and old.created_by is distinct from old.assignee_id then
          raise exception 'Отчёт принимает постановщик задачи' using errcode = '42501';
        end if;
        if new.status = 'review' then new.submitted_at := now(); end if;
      end if;
      -- Чек-лист закрывается, когда отмечены все шаги
      if old.kind = 'checklist' and new.status = 'done'
         and exists (select 1 from jsonb_array_elements(new.checklist) x where not coalesce((x ->> 'done')::boolean, false)) then
        raise exception 'Отметьте все шаги чек-листа' using errcode = '23514';
      end if;
    end if;
  end if;

  if new.due_at is distinct from old.due_at and new.due_at is not null then
    new.due_date := (new.due_at at time zone 'Asia/Almaty')::date;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
    new.completed_at := case when new.status = 'done' then now() end;
  end if;
  -- Отметили первый шаг чек-листа — задача в работе
  if old.kind = 'checklist' and new.status = 'todo'
     and exists (select 1 from jsonb_array_elements(new.checklist) x where coalesce((x ->> 'done')::boolean, false)) then
    new.status := 'in_progress';
    new.started_at := coalesce(new.started_at, now());
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Результат проверки отчёта: принять или вернуть с комментарием
create or replace function public.review_task(p_task uuid, p_accept boolean, p_comment text default null)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); t public.tasks;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null then raise exception 'Задача не найдена'; end if;
  if not (public.is_hr() or t.created_by = v_me or public.is_manager_of(t.assignee_id)) then
    raise exception 'Принимать задачу может постановщик, руководитель или HR' using errcode = '42501';
  end if;
  if not p_accept and coalesce(trim(p_comment), '') = '' then
    raise exception 'Напишите, что доработать';
  end if;
  update public.tasks
     set status = case when p_accept then 'done' else 'in_progress' end,
         review_comment = nullif(trim(p_comment), '')
   where id = p_task returning * into t;
  perform public.notify(t.assignee_id,
    case when p_accept then 'Задача №' || t.number || ' принята' else 'Задача №' || t.number || ' возвращена на доработку' end,
    coalesce(nullif(trim(p_comment), ''), t.title), '/tasks?open=' || t.id, case when p_accept then 'success' else 'warning' end);
  return t;
end $$;

-- Курс ⇄ задача: назначили курс со сроком — у сотрудника появилась задача с кнопкой «Перейти к курсу»;
-- курс начат или пройден — задача сама переходит в «В работе» / «Готово»
create or replace function public.course_assignment_sync_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_course public.courses;
begin
  select * into v_course from public.courses where id = new.course_id;
  if tg_op = 'INSERT' then
    if new.assigned_by is not null and new.assigned_by is distinct from new.employee_id
       and new.status <> 'completed'
       and not exists (select 1 from public.tasks t where t.kind = 'course' and t.course_id = new.course_id
                       and t.assignee_id = new.employee_id and t.status <> 'done') then
      insert into public.tasks (title, description, assignee_id, created_by, priority, status, category, kind, course_id, due_at)
      values ('Пройти курс «' || v_course.title || '»',
              coalesce(v_course.description, '') || E'\n\nКурс займёт около ' || v_course.duration_minutes
                || ' минут. Задача закроется сама, когда вы сдадите итоговый тест.',
              new.employee_id, new.assigned_by, case when v_course.is_mandatory then 'high' else 'medium' end,
              'todo', 'training', 'course', new.course_id,
              case when new.due_date is not null then (new.due_date + time '18:00') at time zone 'Asia/Almaty' end);
    end if;
  elsif new.status is distinct from old.status then
    update public.tasks
       set status = case when new.status = 'completed' then 'done' else 'in_progress' end
     where kind = 'course' and course_id = new.course_id and assignee_id = new.employee_id and status <> 'done';
  end if;
  return new;
end $$;
drop trigger if exists trg_course_assignment_sync_task on public.course_assignments;
create trigger trg_course_assignment_sync_task after insert or update on public.course_assignments
  for each row execute function public.course_assignment_sync_task();

-- Поставить задачу нескольким сотрудникам сразу (с типом, чек-листом, курсом и дедлайном)
drop function if exists public.assign_tasks(text, text, text, text, date, uuid[]);
create or replace function public.assign_tasks(
  p_title text, p_description text, p_priority text, p_category text, p_due date, p_assignees uuid[],
  p_kind text default 'simple', p_course uuid default null, p_checklist jsonb default '[]'::jsonb,
  p_due_at timestamptz default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_id uuid; v_count integer := 0;
begin
  if v_me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Укажите название задачи'; end if;
  foreach v_id in array coalesce(p_assignees, '{}') loop
    if v_id = v_me or public.is_hr() or public.is_manager_of(v_id) then
      insert into public.tasks (title, description, assignee_id, created_by, priority, category, due_date, due_at,
                                kind, course_id, checklist)
      values (trim(p_title), nullif(trim(p_description), ''), v_id, v_me,
              coalesce(p_priority, 'medium'), coalesce(p_category, 'general'), p_due, p_due_at,
              coalesce(p_kind, 'simple'), p_course, coalesce(p_checklist, '[]'::jsonb));
      -- Задача «Пройти курс» назначает и сам курс, если его ещё нет
      if p_kind = 'course' and p_course is not null and v_id <> v_me then
        insert into public.course_assignments (course_id, employee_id, due_date, assigned_by, status)
        values (p_course, v_id, coalesce(p_due, (p_due_at at time zone 'Asia/Almaty')::date), v_me, 'assigned')
        on conflict (course_id, employee_id) do nothing;
      end if;
      v_count := v_count + 1;
    end if;
  end loop;
  if v_count = 0 then raise exception 'Нет прав ставить задачи выбранным сотрудникам' using errcode = '42501'; end if;
  return v_count;
end $$;
grant execute on function public.assign_tasks(text, text, text, text, date, uuid[], text, uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.review_task(uuid, boolean, text) to authenticated;

-- Не дублировать: задача «Пройти курс», созданная вручную, не порождает вторую через триггер назначения
create or replace function public.tasks_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id();
begin
  if tg_op = 'INSERT' then
    if new.created_by is distinct from new.assignee_id and new.status <> 'done' then
      perform public.notify(new.assignee_id, 'Новая задача №' || new.number, new.title
        || coalesce(' · дедлайн ' || to_char(new.due_at at time zone 'Asia/Almaty', 'DD.MM HH24:MI'), ''),
        '/tasks?open=' || new.id, 'task');
    end if;
  else
    if new.assignee_id is distinct from old.assignee_id then
      perform public.notify(new.assignee_id, 'Вам назначена задача №' || new.number, new.title, '/tasks?open=' || new.id, 'task');
    end if;
    if new.status is distinct from old.status and new.status in ('review', 'done')
       and new.created_by is not null and new.created_by is distinct from v_me
       and new.created_by is distinct from new.assignee_id then
      perform public.notify(new.created_by,
        'Задача №' || new.number || case when new.status = 'done' then ' выполнена' else ' на проверке' end,
        public.employee_name(new.assignee_id) || ': ' || new.title, '/tasks?open=' || new.id,
        case when new.status = 'done' then 'success' else 'task' end);
    end if;
  end if;
  return new;
end $$;

-- ---------- Jana Academy: типы уроков, видео и мини-проверки как в Khan Academy ----------

alter table public.courses add column if not exists icon text not null default 'book';
alter table public.courses add column if not exists summary text;
alter table public.course_lessons add column if not exists kind text not null default 'article';
alter table public.course_lessons drop constraint if exists course_lessons_kind_check;
alter table public.course_lessons add constraint course_lessons_kind_check check (kind in ('article', 'video', 'practice'));
alter table public.course_lessons add column if not exists video_id text;      -- YouTube id
alter table public.course_lessons add column if not exists video_title text;
alter table public.course_lessons add column if not exists video_channel text;

-- Мини-вопросы внутри урока: проверяются сразу, с объяснением; ключи клиенту не отдаются
create table if not exists public.lesson_checks (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null,
  sort        integer not null default 0,
  question    text not null,
  options     jsonb not null,
  explanation text,
  constraint lesson_checks_lesson_fk foreign key (lesson_id) references public.course_lessons (id) on delete cascade
);
create index if not exists lesson_checks_lesson_idx on public.lesson_checks (lesson_id, sort);
create table if not exists public.lesson_check_keys (
  check_id      uuid primary key,
  correct_index integer not null,
  constraint lesson_check_keys_check_fk foreign key (check_id) references public.lesson_checks (id) on delete cascade
);
create table if not exists public.lesson_check_answers (
  employee_id uuid not null,
  check_id    uuid not null,
  correct     boolean not null,
  tries       integer not null default 1,
  answered_at timestamptz not null default now(),
  primary key (employee_id, check_id),
  constraint lesson_check_answers_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade,
  constraint lesson_check_answers_check_fk    foreign key (check_id)    references public.lesson_checks (id) on delete cascade
);
alter table public.lesson_checks enable row level security;
alter table public.lesson_check_keys enable row level security;
alter table public.lesson_check_answers enable row level security;
grant select on public.lesson_checks to authenticated;
grant select on public.lesson_check_answers to authenticated;
drop policy if exists lesson_checks_select on public.lesson_checks;
create policy lesson_checks_select on public.lesson_checks for select to authenticated using (true);
drop policy if exists lesson_check_answers_select on public.lesson_check_answers;
create policy lesson_check_answers_select on public.lesson_check_answers for select to authenticated
  using (employee_id = (select public.current_employee_id()) or (select public.is_hr()));

create or replace function public.answer_lesson_check(p_check uuid, p_index integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_key integer; v_expl text; v_ok boolean;
begin
  if v_me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select k.correct_index, c.explanation into v_key, v_expl
  from public.lesson_checks c join public.lesson_check_keys k on k.check_id = c.id where c.id = p_check;
  if v_key is null then raise exception 'Вопрос не найден'; end if;
  v_ok := p_index = v_key;
  insert into public.lesson_check_answers (employee_id, check_id, correct)
  values (v_me, p_check, v_ok)
  on conflict (employee_id, check_id) do update
    set correct = public.lesson_check_answers.correct or excluded.correct,
        tries = public.lesson_check_answers.tries + 1, answered_at = now();
  -- Правильный ответ показываем только после верного ответа или третьей попытки
  return jsonb_build_object('correct', v_ok, 'explanation', v_expl,
    'correct_index', case when v_ok or (select tries from public.lesson_check_answers
                                        where employee_id = v_me and check_id = p_check) >= 3 then v_key end);
end $$;
grant execute on function public.answer_lesson_check(uuid, integer) to authenticated;

-- Урок с практикой засчитывается, когда на все мини-вопросы дан верный ответ
create or replace function public.complete_lesson(p_lesson uuid)
returns public.course_assignments language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_course uuid;
begin
  if v_me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select course_id into v_course from public.course_lessons where id = p_lesson;
  if v_course is null then raise exception 'Урок не найден'; end if;
  if exists (select 1 from public.lesson_checks c where c.lesson_id = p_lesson
             and not exists (select 1 from public.lesson_check_answers a
                             where a.check_id = c.id and a.employee_id = v_me and a.correct)) then
    raise exception 'Ответьте верно на все вопросы проверки';
  end if;
  insert into public.lesson_progress (employee_id, lesson_id) values (v_me, p_lesson)
  on conflict do nothing;
  return public.recalc_course_progress(v_course, v_me);
end $$;

-- Длительность курса = сумма уроков + 1 минута на вопрос итогового теста
create or replace function public.recalc_course_duration(p_course uuid)
returns void language sql security definer set search_path = public as $$
  update public.courses c
     set duration_minutes = greatest(5,
           coalesce((select sum(duration_minutes) from public.course_lessons where course_id = p_course), 0)
         + coalesce((select count(*) from public.course_questions where course_id = p_course), 0))
   where c.id = p_course;
$$;
create or replace function public.course_duration_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_course_duration(coalesce(new.course_id, old.course_id));
  return null;
end $$;
drop trigger if exists trg_lessons_duration on public.course_lessons;
create trigger trg_lessons_duration after insert or update or delete on public.course_lessons
  for each row execute function public.course_duration_trigger();
drop trigger if exists trg_questions_duration on public.course_questions;
create trigger trg_questions_duration after insert or delete on public.course_questions
  for each row execute function public.course_duration_trigger();

-- ---------- Объявления: обложка, картинка, анонс ----------

alter table public.announcements add column if not exists summary text;
alter table public.announcements add column if not exists cover text not null default 'news';
alter table public.announcements add column if not exists image text;   -- своя картинка (data URL), до ~1,5 МБ
alter table public.announcements drop constraint if exists announcements_image_size;
alter table public.announcements add constraint announcements_image_size check (image is null or length(image) < 2000000);

-- ---------- HR: массовые напоминания ----------

-- Выполнить действия «Зоны внимания» пачкой: [{"action": "...", "employee_id": "...", "ref_id": "..."}]
create or replace function public.attention_bulk(p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare x jsonb; v_count integer := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    perform public.attention_action(x ->> 'action', (x ->> 'employee_id')::uuid, nullif(x ->> 'ref_id', '')::uuid);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
grant execute on function public.attention_bulk(jsonb) to authenticated;

-- Своё напоминание группе сотрудников (HR — любым, руководитель — своей команде)
create or replace function public.send_reminder(p_employees uuid[], p_title text, p_body text, p_link text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_id uuid; v_count integer := 0;
begin
  if coalesce(trim(p_title), '') = '' then raise exception 'Напишите заголовок напоминания'; end if;
  foreach v_id in array coalesce(p_employees, '{}') loop
    if v_id <> v_me and (public.is_hr() or public.is_manager_of(v_id)) then
      perform public.notify(v_id, trim(p_title), coalesce(nullif(trim(p_body), ''), 'Напоминание от ' || public.employee_name(v_me)),
                            coalesce(nullif(trim(p_link), ''), '/'), 'warning');
      insert into public.reminders (kind, employee_id, ref_id, sent_by) values ('custom', v_id, null, v_me);
      v_count := v_count + 1;
    end if;
  end loop;
  if v_count = 0 then raise exception 'Нет получателей, которым вы можете отправить напоминание' using errcode = '42501'; end if;
  return v_count;
end $$;
grant execute on function public.send_reminder(uuid[], text, text, text) to authenticated;

-- ---------- AI Jana: расширенный контекст пользователя ----------
-- Кроме профиля, отпуска, заявок и курсов: открытые задачи с дедлайнами и тем, кто их поставил,
-- очередь «на проверке» у постановщика, ближайшие праздники, ближайший отпуск и свежие объявления.
-- Всё только своё или разрешённое роли: функция сама фильтрует данные по текущему сотруднику.

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
    'now', to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM-DD"T"HH24:MI'),
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
    'next_vacation', (select jsonb_build_object('start_date', r.start_date, 'end_date', r.end_date, 'status', r.status)
                        from public.requests r
                       where r.employee_id = v_me and r.type = 'vacation' and r.status in ('pending', 'approved', 'processing', 'done')
                         and r.end_date >= current_date
                       order by r.start_date limit 1),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'number', r.number, 'type', public.request_type_label(r.type), 'status', r.status,
        'start_date', r.start_date, 'end_date', r.end_date, 'days', r.days, 'amount', r.amount,
        'created_at', r.created_at::date) order by r.created_at desc)
      from (select * from public.requests where employee_id = v_me order by created_at desc limit 5) r), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object(
        'title', c.title, 'slug', c.slug, 'status', ca.status, 'progress', ca.progress, 'score', ca.score,
        'due_date', ca.due_date, 'minutes', c.duration_minutes) order by ca.due_date nulls last)
      from public.course_assignments ca join public.courses c on c.id = ca.course_id
      where ca.employee_id = v_me), '[]'::jsonb),
    'open_tasks', (select count(*) from public.tasks t where t.assignee_id = v_me and t.status <> 'done'),
    'tasks', coalesce((select jsonb_agg(x order by x ->> 'due_at' nulls last) from (
        select jsonb_build_object(
          'id', t.id, 'title', t.title, 'kind', t.kind, 'status', t.status, 'priority', t.priority,
          'due_at', to_char(coalesce(t.due_at, (t.due_date + time '18:00') at time zone 'Asia/Almaty') at time zone 'Asia/Almaty', 'YYYY-MM-DD"T"HH24:MI'),
          'from', case when t.created_by = v_me then null else public.employee_name(t.created_by) end,
          'course', (select jsonb_build_object('slug', c.slug, 'title', c.title) from public.courses c where c.id = t.course_id),
          'steps_done', (select count(*) from jsonb_array_elements(t.checklist) s where (s ->> 'done')::boolean),
          'steps_total', jsonb_array_length(t.checklist),
          'review_comment', t.review_comment) as x
        from public.tasks t
        where t.assignee_id = v_me and t.status <> 'done'
        order by coalesce(t.due_at, (t.due_date + time '18:00') at time zone 'Asia/Almaty') nulls last
        limit 20) q), '[]'::jsonb),
    'tasks_done_7d', (select count(*) from public.tasks t where t.assignee_id = v_me and t.status = 'done' and t.completed_at > now() - interval '7 days'),
    'to_review', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'assignee', public.employee_name(t.assignee_id), 'submitted_at', t.submitted_at::date)
        order by t.submitted_at)
      from public.tasks t where t.created_by = v_me and t.assignee_id <> v_me and t.status = 'review'), '[]'::jsonb),
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('day', h.day, 'name', h.name) order by h.day)
      from (select * from public.holidays where day >= current_date order by day limit 4) h), '[]'::jsonb),
    'news', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'summary', a.summary, 'category', a.category, 'pinned', a.pinned,
        'date', a.created_at::date,
        'read', exists (select 1 from public.announcement_reads r where r.announcement_id = a.id and r.employee_id = v_me))
        order by a.pinned desc, a.created_at desc)
      from (select * from public.announcements an
             where an.audience_department_id is null or an.audience_department_id = e.department_id
             order by an.pinned desc, an.created_at desc limit 4) a), '[]'::jsonb),
    'unread_notifications', (select count(*) from public.notifications n where n.employee_id = v_me and n.read_at is null));

  if v_role in ('manager', 'hr') then
    v_result := v_result || jsonb_build_object('team', jsonb_build_object(
      'size', (select count(*) from public.subordinate_ids(v_me)),
      'pending_approvals', (select count(*) from public.requests r
                             where r.approver_id = v_me and r.status in ('pending', 'approved')),
      'overdue_tasks', (select count(*) from public.tasks t
                         where t.assignee_id in (select public.subordinate_ids(v_me)) and t.status <> 'done'
                           and coalesce(t.due_at, (t.due_date + time '18:00') at time zone 'Asia/Almaty') < now()),
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
  public.chat_messages, public.chat_members, public.chats, public.employee_avatars,
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
alter table public.course_assignments disable trigger trg_course_assignment_sync_task;
alter table public.tasks disable trigger trg_tasks_notify;
alter table public.announcements disable trigger trg_announcements_notify;
alter table public.hr_tickets disable trigger trg_hr_tickets_after_insert;

create or replace function seed_tmp.emp(p_tab text) returns uuid language sql stable as $$
  select id from public.employees where zup_id = p_tab
$$;

-- ---------- Производственный календарь РК ----------
-- С 2026 года День Конституции отмечается 15 марта, 30 августа больше не праздник (Закон РК «О праздниках»)

insert into public.holidays (day, name) values
  ('2026-01-01', 'Новый год'), ('2026-01-02', 'Новый год'), ('2026-01-07', 'Рождество Христово'),
  ('2026-03-08', 'Международный женский день'), ('2026-03-21', 'Наурыз мейрамы'), ('2026-03-22', 'Наурыз мейрамы'),
  ('2026-03-23', 'Наурыз мейрамы'), ('2026-05-01', 'Праздник единства народа Казахстана'),
  ('2026-05-07', 'День защитника Отечества'), ('2026-05-09', 'День Победы'), ('2026-05-27', 'Курбан айт'),
  ('2026-07-06', 'День Столицы'), ('2026-10-25', 'День Республики'),
  ('2026-10-26', 'Перенос выходного дня (День Республики)'), ('2026-12-16', 'День Независимости'),
  ('2027-01-01', 'Новый год'), ('2027-01-02', 'Новый год'), ('2027-01-07', 'Рождество Христово'),
  ('2027-03-08', 'Международный женский день'), ('2027-03-15', 'День Конституции'), ('2027-03-21', 'Наурыз мейрамы'), ('2027-03-22', 'Наурыз мейрамы'),
  ('2027-03-23', 'Наурыз мейрамы'), ('2027-05-01', 'Праздник единства народа Казахстана'),
  ('2027-05-07', 'День защитника Отечества'), ('2027-05-09', 'День Победы'), ('2027-07-06', 'День Столицы'),
  ('2027-10-25', 'День Республики'), ('2027-12-16', 'День Независимости');

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
     'Даты попадают на распродажу 11.11 и подготовку к пику. Перенесите, пожалуйста, на 1–9 декабря, между пиками: согласую сразу'),
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
-- 4 курса в формате Khan Academy: статьи, видео с YouTube, микротесты «Проверь себя» после блоков и итоговый тест.
-- Длительность курса пересчитывается триггером: сумма уроков + 1 минута на вопрос итогового теста.

create table seed_tmp.questions (slug text, sort int, question text, options jsonb, correct int, explanation text);
create table seed_tmp.lchecks (slug text, lesson_sort int, sort int, question text, options jsonb, correct int, explanation text);

-- ===== Jana Academy: welcome, service =====
-- Контент курсов «Добро пожаловать в Jana Post» и «Стандарты клиентского сервиса».
-- Длительность статьи = ceil(слов / 120); видео = длительность ролика с округлением вверх + 2; практика = число вопросов + 1.
-- Внутренние правила Jana Post в текстах помечены как демо-регламент прототипа.
-- Видео: встраивание проверено через https://www.youtube.com/oembed, длительность по YouTube Data API (contentDetails.duration) через ytapi.apps.mattw.io.

insert into public.courses (slug, title, description, summary, category, icon, emoji, duration_minutes, is_mandatory, pass_score) values
  ('welcome', 'Добро пожаловать в Jana Post', 'Адаптационный курс для новых сотрудников: как устроен бизнес Jana Post и путь посылки от продавца в Китае до клиента, наши ценности, первые недели работы по Трудовому кодексу РК и HR-сервисы в JanaMen.', 'Вы сможете объяснить, как посылка проходит путь от Китая до клиента, будете знать свои права на испытательном сроке и сами оформите заявку, найдёте задачу и получите ответ на HR-вопрос в JanaMen.', 'onboarding', 'box', '', 0, true, 70),
  ('service', 'Стандарты клиентского сервиса', 'Практический курс для сотрудников ПВЗ и службы поддержки: стандарт общения на казахском и русском, активное слушание, работа с жалобами по модели HEARD, выдача и возврат посылок, этикет телефона и чата, защита персональных данных клиента.', 'Вы проведёте разговор с клиентом по стандарту, снизите накал конфликта по модели HEARD, правильно выдадите и примете посылку и сохраните конфиденциальность данных клиента.', 'skills', 'headset', '', 0, false, 70);

insert into public.course_lessons (course_id, sort, title, kind, duration_minutes, video_id, video_title, video_channel, content)
select c.id, l.sort, l.title, l.kind, l.minutes, l.video_id, l.video_title, l.video_channel, l.content
from public.courses c
join (values
  -- источник (ЕБРР, Astana Hub, 13.02.2026): https://astanahub.com/en/blog/jana-post-poluchila-priznanie-ebrr-i-rasshiriaet-logistiku-v-tsentralnoi
  -- урок welcome 1: статья, 565 слов → 5 мин
  ('welcome', 1, 'Кто мы: Jana Post сегодня', 'article', 5, null::text, null::text, null::text, E'### Коротко о компании\n\n**Jana Post** работает как международная технологическая и логистическая платформа. Её задача: обеспечить **полный цикл трансграничной торговли** между Китаем и странами Центральной Азии.\n\nПолный цикл означает, что клиенту не нужно собирать доставку из разных подрядчиков. Товар нужно принять у продавца, подготовить к перевозке, провезти через границу, рассортировать по городам и вручить получателю. В Jana Post эти этапы связаны в одну цепочку, и клиент видит её как один понятный сервис.\n\nКомпания объединяет три составляющие:\n\n- **собственную логистическую инфраструктуру**: склады, сортировочные центры, филиалы и пункты выдачи;\n- **цифровые решения**: собственную IT-платформу и мобильное приложение;\n- **экосистему сервисов** для разных клиентов: частных покупателей, предпринимателей, маркетплейсов и бизнеса.\n\n### Jana Post в цифрах\n\n- **3+ млн** пользователей;\n- **1000+** филиалов;\n- **5 стран**: Казахстан, Кыргызстан, Узбекистан, Таджикистан и Монголия;\n- **собственная IT-платформа**, на которой работают отслеживание, статусы и внутренние сервисы.\n\nЭти цифры можно называть клиентам и партнёрам. Другие показатели (объёмы, сроки по направлениям, финансовые данные) называйте только из официальных источников компании.\n\n### Маршрут: Китай → Казахстан → Центральная Азия\n\nОсновной поток товаров идёт из Китая. Казахстан граничит с Китаем, поэтому становится первой точкой входа товаров в регион, а оттуда направления расходятся в соседние страны.\n\nДля сотрудника это значит: одна посылка может пройти через руки коллег в нескольких городах и странах. Если на одном участке потеряна информация (посылку не отсканировали, перепутали этикетку), проблему почувствуют все следующие участники цепочки, а в конце клиент.\n\n### Для кого мы работаем\n\n- **Частные клиенты** покупают товары у продавцов из Китая и хотят получить их быстро, целыми и с понятным статусом.\n- **Предприниматели** везут товар для своего бизнеса: им важны предсказуемые сроки и стоимость.\n- **Маркетплейсы и бизнес** передают Jana Post потоки отправлений и ждут стабильного качества на больших объёмах.\n\nУ каждой группы свои вопросы, но общий запрос один: **доверить посылку и знать, где она находится**.\n\n### Как коротко рассказать о Jana Post\n\nДрузья, клиенты и партнёры будут спрашивать, где вы работаете. Достаточно двух фраз:\n\n«Jana Post соединяет Китай и Центральную Азию: мы доставляем посылки и грузы полным циклом, от продавца в Китае до получателя в Казахстане, Кыргызстане, Узбекистане, Таджикистане и Монголии. У нас более 1000 филиалов, более 3 млн пользователей и собственная IT-платформа, поэтому посылку видно на каждом этапе».\n\nНе добавляйте к этому рассказу непроверенных цифр и обещаний о сроках.\n\n### Приложение Jańa Post\n\nМобильное приложение Jańa Post служит основным каналом связи клиента с компанией. В нём есть:\n\n- **отслеживание отправлений**;\n- **калькулятор юань/тенге**, чтобы оценить стоимость покупки в привычной валюте;\n- **уведомления о смене статуса** отправления.\n\nСовет для работы: когда клиент спрашивает, где его посылка, посмотрите статус в системе и покажите, где он может видеть его сам в приложении. Следующий такой вопрос клиент решит без звонка и без очереди.\n\n### Признание\n\nВ феврале 2026 года блог Astana Hub опубликовал материал о том, что Jana Post получила признание Европейского банка реконструкции и развития (ЕБРР) и расширяет логистику в Центральной Азии.\n\n### Как ваша работа связана с целым\n\nКлиентка из Шымкента заказала обувь у продавца в Китае. Её посылку примут на складе, повезут через границу, рассортируют, доставят в пункт выдачи и вручат. На каждом шаге работает конкретный человек:\n\n- оператор склада, который принял и промаркировал посылку;\n- водитель и сортировщик, которые довезли и направили её в нужный поток;\n- сотрудник пункта выдачи, который проверил документ и вручил посылку;\n- специалист поддержки, который ответил на вопрос о статусе;\n- разработчик, благодаря которому статус вовремя появился в приложении;\n- HR, который вовремя оформил этим людям отпуск, выплаты и обучение.\n\nКлиентка не знает никого из них по имени, но оценивает компанию по результату всей цепочки. В следующем уроке разберём этот путь по шагам.'),
  -- урок welcome 2: статья, 667 слов → 6 мин
  ('welcome', 2, 'Путь посылки: от продавца в Китае до клиента', 'article', 6, null, null, null, E'### Зачем знать весь путь\n\nКаждый сотрудник видит свой участок, а клиент видит результат целиком. Когда вы понимаете, что происходит с посылкой до и после вас, вы точнее отвечаете клиентам и реже допускаете ошибки, которые всплывают через несколько дней в другом городе.\n\n### Основные понятия\n\n- **Отправление (посылка)**: товар в упаковке с этикеткой, который можно отследить.\n- **Трек-номер**: уникальный номер отправления. По нему посылку находят в системе, а клиент отслеживает её в приложении.\n- **Сканирование**: считывание штрихкода при каждой передаче посылки. Каждый скан создаёт запись: где, когда и кто принял посылку. Из этих записей складываются **статусы**, которые видит клиент.\n- **Склад консолидации**: склад, куда поступают посылки от разных продавцов. Здесь их принимают, проверяют, взвешивают, маркируют и объединяют в крупные грузовые места (мешки, коробки, паллеты), которые поедут одним рейсом. Одну крупную партию везти дешевле и быстрее, чем тысячи мелких отправлений по отдельности.\n- **Магистральная перевозка**: перевозка партии на большое расстояние между странами или крупными городами автотранспортом, по железной дороге или самолётом.\n- **Таможенное оформление**: при пересечении границы товары декларируют, и они проходят таможенный контроль. Пока партия не выпущена, дальше она не едет.\n- **Сортировочный центр (СЦ)**: объект, где поступившие партии разгружают, каждую посылку сканируют и распределяют по направлениям: город, регион, пункт выдачи или курьерский маршрут. В крупных СЦ работают автоматические линии, которые читают штрихкод и направляют посылку в нужный лоток.\n- **ПВЗ (пункт выдачи заказов)**: точка, где клиент забирает посылку после проверки документа и где принимают возвраты.\n- **Курьерская доставка**: доставка до двери клиента. Финальный участок пути до получателя называют **последней милей**: его клиент видит и оценивает лучше всего.\n\n### Путь одной посылки: пример\n\nДаулет из Караганды заказал наушники у продавца в Китае. Статусы в примере условные: в системе они могут называться иначе, а сроки зависят от направления и услуги.\n\n1. **Продавец передаёт посылку на склад консолидации.** Сотрудник склада сканирует трек-номер, и в приложении Даулета появляется первый статус о приёме.\n2. **Обработка на складе.** Посылку взвешивают, измеряют, сверяют с данными заказа, клеят этикетку и вместе с другими посылками в Казахстан упаковывают в грузовое место. Грузовое место получает свой номер, и система помнит, какие посылки внутри.\n3. **Магистральная перевозка и граница.** Партия едет к границе и проходит таможенное оформление. Статус меняется, когда партия отправлена и когда она выпущена.\n4. **Сортировочный центр в Казахстане.** Партию разгружают, грузовые места вскрывают, каждую посылку сканируют. Система определяет направление, и посылка Даулета уходит в поток на Караганду.\n5. **Доставка в город получателя.** Посылка едет в региональное подразделение, где её снова сканируют на приёме.\n6. **ПВЗ или курьер.** Даулет выбрал ПВЗ. Сотрудник принимает посылку, сканирует и кладёт в ячейку хранения. Даулету приходит уведомление, что посылку можно забрать.\n7. **Вручение.** Даулет называет трек-номер или код получения, показывает документ, вместе с сотрудником осматривает упаковку и забирает посылку. Последний скан фиксирует вручение.\n\nЕсли Даулет откажется от посылки или оформит возврат, запускается **обратная логистика**: посылка проходит цепочку в обратном направлении, и каждый этап так же сканируется.\n\n### Где чаще всего рвётся цепочка\n\n- **Пропущенный скан.** Посылка физически движется, а в системе «застряла». Клиент видит старый статус и звонит в поддержку.\n- **Нечитаемая или перепутанная этикетка.** Посылку отправляют не в тот поток, и она теряет дни.\n- **Повреждение, не зафиксированное на приёме.** Если мятую коробку приняли без отметки, потом невозможно установить, на каком участке её повредили.\n- **Посылка не на своём месте.** На ПВЗ её не могут найти, хотя статус говорит, что она там.\n\n### Что говорить клиенту на каждом этапе\n\nКлиенту не нужны внутренние термины, ему нужно понять, всё ли в порядке и чего ждать. Переводите этап на простой язык:\n\n- **склад консолидации**: «Продавец передал посылку, её готовят к отправке в Казахстан»;\n- **магистральная перевозка и граница**: «Посылка едет в составе партии и проходит таможенное оформление»;\n- **сортировочный центр**: «Посылка в сортировочном центре, её направляют в ваш город»;\n- **ПВЗ или курьер**: «Посылка в вашем пункте выдачи» или «Посылка передана курьеру».\n\nНе называйте точную дату прибытия, если её не показывает система: подробнее об этом в курсе «Стандарты клиентского сервиса».\n\n### Главный принцип\n\nКаждая передача посылки фиксируется сканом в момент передачи. Каждое отклонение (повреждение, несовпадение веса, отсутствие этикетки) фиксируется сразу и на том участке, где его обнаружили. Тогда цепочка остаётся прозрачной для коллег и для клиента, а любую проблему можно найти и исправить.'),
  -- урок welcome 3: видео https://www.youtube.com/watch?v=V4eMVnDbnVA, длительность 3:16 → 6 мин; oEmbed: title и author_name совпадают с video_title / video_channel
  ('welcome', 3, 'Видео: как работает сортировочный центр', 'video', 6, 'V4eMVnDbnVA', '70 000 посылок в день! Невероятно! Сортировочный центр СДЭК в Дзержинском! Смотреть до конца!', 'СДЭК Жизнь в стиле Экспресс', E'Видео на русском языке снято в автоматизированном сортировочном центре СДЭК в Дзержинском (Россия). Это другая логистическая компания, но принцип сортировки в отрасли одинаков: посылки поступают партиями, каждую идентифицируют по штрихкоду и распределяют по направлениям. По описанию к видео, центр обрабатывает более 6500 посылок в час.\n\nСмотрите видео с вопросами из прошлого урока: где посылки разгружают, где их сканируют, как линия определяет, куда направить посылку, и какие операции выполняют люди.\n\n### Ключевые выводы\n\n- Автоматика даёт скорость, а точность начинается с людей: с читаемой этикетки, правильной упаковки и аккуратной выгрузки.\n- Сортировка всегда идёт по направлению назначения: город, регион, пункт выдачи или курьерский маршрут.\n- Каждое перемещение посылки фиксируется, поэтому клиент видит статус в приложении.\n- При тысячах посылок в час одна ошибка на входе (нечитаемый штрихкод, повреждённая коробка) превращается в задержку на выходе.'),
  -- урок welcome 4: практика, 4 вопроса → 5 мин
  ('welcome', 4, 'Проверь себя: бизнес и путь посылки', 'practice', 5, null, null, null, E'Короткая проверка по урокам 1–3: как устроен бизнес Jana Post и путь посылки. Ответ проверяется сразу, а пояснение подскажет, что повторить.'),
  -- урок welcome 5: статья, 554 слов → 5 мин
  ('welcome', 5, 'Наши ценности в ежедневной работе', 'article', 5, null, null, null, E'### Зачем компании ценности\n\nЦенности помогают принимать решения там, где инструкции не хватает. Регламент не опишет каждую ситуацию на складе, в пункте выдачи или в офисе, а ценности подсказывают, как поступить. В Jana Post их три: **Открытость, Надёжность, Результат** (Кодекс корпоративной этики Jana Post, демо).\n\n### Открытость\n\n**Что это значит:** говорим прямо, делимся информацией и признаём ошибки.\n\nКак это выглядит в работе:\n\n- вы ошиблись (положили посылку не в ту ячейку, поставили не тот статус) и сразу сообщаете старшему смены, а не ждёте, пока ошибку обнаружат другие;\n- вы видите, что процесс неудобен или небезопасен, и предлагаете, как его улучшить;\n- вы не поняли задачу и задаёте вопрос в начале, а не за час до срока;\n- вы честно говорите клиенту, что знаете и чего пока не знаете.\n\nОткрытость не означает грубость («я просто говорю правду») и обсуждение коллег за спиной. Открытый разговор ведут с тем, кого он касается, спокойно и по существу.\n\n### Надёжность\n\n**Что это значит:** клиент доверяет нам свою посылку. Мы выполняем обещания, соблюдаем сроки и стандарты безопасности.\n\nКак это выглядит в работе:\n\n- каждый скан сделан в момент передачи посылки;\n- обещание клиенту или коллеге выполнено в срок, а если не получается, вы предупреждаете заранее и называете новый срок;\n- правила выдачи и безопасности соблюдаются всегда, в том числе при очереди и в спешке;\n- вы бережёте персональные данные клиентов и коллег.\n\nНадёжность проверяется в мелочах. Один пропущенный скан или посылка, выданная без документа «по знакомству», перечёркивают сотни правильно выполненных операций.\n\n### Результат\n\n**Что это значит:** оцениваем работу по результату для клиента и команды, а не по количеству потраченных часов.\n\nКак это выглядит в работе:\n\n- вы думаете о том, что получит клиент: целую посылку, понятный ответ, решённый вопрос;\n- вы доводите задачу до конца: «передал дальше» и «решил» не одно и то же;\n- вы помогаете соседнему участку, если ваш участок справился, а у коллег завал;\n- вы предлагаете улучшения, которые экономят время команды и клиента.\n\nРезультат не оправдывает нарушений. Быстро выдать посылку без проверки документа значит создать риск для клиента и компании, а не показать результат.\n\n### Ценности не только для работы с клиентами\n\nТе же три ценности действуют внутри команды и в офисе:\n\n- **Открытость** в IT: разработчик сообщает о найденной ошибке в статусах сразу, даже если её ещё никто не заметил.\n- **Надёжность** в HR: заявка на отпуск оформлена в срок, и сотрудник получил отпускные вовремя.\n- **Результат** у руководителя: он оценивает сотрудника по решённым задачам и качеству, а не по тому, кто дольше задержался после смены.\n- **Открытость** между сменами: при передаче смены вы рассказываете о незакрытых вопросах, а не оставляете их следующей смене как сюрприз.\n\n### Когда ценности работают вместе\n\n**Ситуация.** Вы оператор ПВЗ. В конце смены вы замечаете, что днём выдали клиенту не ту посылку: трек-номера отличались одной цифрой. Клиент уже ушёл.\n\n- **Открытость:** сразу сообщить старшему смены и не скрывать ошибку.\n- **Надёжность:** по регламенту (демо) связаться с клиентом через поддержку, договориться о возврате чужой посылки, вручить правильную и зафиксировать инцидент.\n- **Результат:** оба клиента получают свои посылки, а команда договаривается, как исключить повтор, например сверять номер на этикетке с номером в системе полностью, а не по последним цифрам.\n\nСкрыть ошибку проще в моменте, но тогда второй клиент придёт за посылкой, которой нет, а первый получит чужую вещь. Открыто признанная ошибка обходится компании и клиентам дешевле.\n\n### Вопросы для себя\n\n- Какая операция в моей роли каждый день проверяет Надёжность?\n- Кому я скажу, если увижу проблему в процессе?\n- По какому результату для клиента видно, что я сделал работу хорошо?'),
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/36.htm
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/37.htm
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/68.htm
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/75.htm
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/88.htm
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/92.htm
  -- (тексты статей ТК РК от 23.11.2015 № 414-V, страницы проверены сайтом 06.10.2026 и 15.10.2026; adilet.zan.kz не отдаёт текст без JavaScript)
  -- урок welcome 6: статья, 561 слов → 5 мин
  ('welcome', 6, 'Испытательный срок, рабочее время и отпуск по ТК РК', 'article', 5, null, null, null, E'В этом уроке собраны нормы **Трудового кодекса Республики Казахстан** (Кодекс от 23 ноября 2015 года № 414-V), которые важны в первые месяцы работы. Внутренние правила Jana Post в прототипе JanaMen помечены как демо.\n\n### Испытательный срок (статьи 36 и 37)\n\n- Условие об испытательном сроке включается в **трудовой договор**. Его цель: проверить, соответствует ли работник поручаемой работе. Дату окончания испытания ищите в своём договоре.\n- Срок начинается с первого дня работы, указанного в договоре.\n- Он **не может превышать трёх месяцев**. Для руководителей организации и их заместителей, главных бухгалтеров и их заместителей, руководителей филиалов и представительств испытательный срок может составлять до шести месяцев.\n- Испытательный срок засчитывается в **трудовой стаж**.\n- На время, когда вы фактически отсутствовали на работе (например, болели), испытательный срок **приостанавливается**.\n- Если результат испытания отрицательный, работодатель вправе расторгнуть трудовой договор до окончания срока, **письменно уведомив** работника и обосновав причины.\n- Если срок истёк, а такого уведомления не было, работник **считается выдержавшим испытание**.\n\nЧто делать вам: знайте дату окончания испытательного срока, вовремя пройдите обязательные курсы и инструктажи, задавайте вопросы наставнику. По внутреннему регламенту (демо) через месяц после выхода руководитель проводит встречу по итогам первых недель: подготовьте вопросы и свои наблюдения.\n\n### Рабочее время (статьи 68 и 75)\n\n- Нормальная продолжительность рабочего времени: **не более 40 часов в неделю**.\n- На непрерывных производствах и работах, где нельзя соблюсти дневную или недельную норму, применяется **суммированный учёт рабочего времени**. Норма соблюдается в среднем за **учётный период**, который не превышает одного года. Отдых между сменами при этом обязателен, а работников младше 18 лет на такой режим не назначают.\n\nРежим работы по Правилам внутреннего трудового распорядка Jana Post (демо):\n\n- **офис**: понедельник–пятница, 09:00–18:00, обед 13:00–14:00;\n- **сортировочный центр и склад**: сменный график 2/2 по 12 часов, дневная смена 08:00–20:00, ночная 20:00–08:00 (для таких графиков и нужен суммированный учёт);\n- **ПВЗ**: по графику конкретного пункта выдачи.\n\nЕсли опаздываете или не можете выйти на смену, **заранее** сообщите руководителю или старшему смены (демо-регламент).\n\n### Ежегодный отпуск (статьи 88 и 92)\n\n- Основной оплачиваемый ежегодный трудовой отпуск длится **24 календарных дня**. Более длительный отпуск может быть предусмотрен законодательством, коллективным договором или актами работодателя.\n- **Рабочий год** равен 12 календарным месяцам и отсчитывается с первого дня работы.\n- Отпуск за первый и последующие рабочие годы предоставляется **по соглашению сторон в любое время рабочего года**.\n- По соглашению работника и работодателя отпуск можно **разделить на части**, при этом одна из частей должна быть **не менее 14 календарных дней**.\n\nКак подать заявку на отпуск в JanaMen, разберём в уроке о HR-сервисах.\n\n### Пример\n\nАрман вышел на работу оператором сортировочного центра 1 марта. В трудовом договоре указан испытательный срок три месяца, то есть до 31 мая. В апреле Арман неделю болел, и на эти семь дней испытание приостанавливалось, поэтому оно закончится на семь дней позже. Уведомления о расторжении договора Арман не получил, значит после этой даты он считается выдержавшим испытание.\n\nАрман работает по графику 2/2 по 12 часов. За отдельную неделю у него может выйти больше 40 часов, а за другую меньше: норма соблюдается в среднем за учётный период.\n\nВ июле Арман хочет отдохнуть 14 дней. Условия о шести месяцах работы перед первым отпуском в статье 92 нет: отпуск предоставляется по соглашению с работодателем в любое время рабочего года. Оставшиеся 10 дней он сможет взять позже, ведь одна часть отпуска уже составила 14 дней.\n\n### Важно\n\nНормы приведены по тексту Кодекса, проверенному в октябре 2026 года. В спорной ситуации сверяйтесь с официальным текстом Кодекса и обращайтесь в HR.'),
  -- урок welcome 7: статья, 533 слов → 5 мин
  ('welcome', 7, 'Первые дни: пропуск, спецодежда, наставник и к кому обращаться', 'article', 5, null, null, null, E'Правила этого урока описаны по внутреннему регламенту Jana Post (демо) и показывают, как устроена адаптация в прототипе JanaMen.\n\n### Первый день: что произойдёт\n\n1. HR знакомит вас с трудовым договором и Правилами внутреннего трудового распорядка и выдаёт доступ в JanaMen.\n2. Вы получаете **пропуск** и, если работаете на складе, в сортировочном центре или ПВЗ, **спецодежду**.\n3. Вы знакомитесь с руководителем и **наставником**.\n4. В Jana Academy вам назначены обязательные курсы, включая этот.\n\nВозьмите с собой документ, удостоверяющий личность: он понадобится для оформления пропуска. Если вы работаете на складе или в сортировочном центре, приходите в удобной закрытой обуви, пока не получили спецобувь.\n\n### Пропуск\n\n- Пропуск персональный: не передавайте его коллегам и не проходите по чужому пропуску.\n- На территории склада и сортировочного центра держите пропуск при себе, чтобы его можно было предъявить.\n- Потеряли пропуск: сразу сообщите руководителю и HR, чтобы его заблокировали. Нашли чужой: отдайте старшему смены.\n- При увольнении пропуск сдаётся вместе с другим имуществом компании.\n\n### Спецодежда\n\n- На складе, в сортировочном центре и ПВЗ работайте в выданной спецодежде. В зонах погрузки и сортировки нужны сигнальный жилет и закрытая обувь с нескользящей подошвой.\n- Спецодежда с логотипом показывает клиенту, что перед ним сотрудник Jana Post, поэтому она должна быть чистой и целой. В ПВЗ бейдж с именем держите на виду.\n- Спецодежда числится за вами. Если она износилась или порвалась, скажите руководителю; при увольнении её сдают.\n\n### Наставник\n\nНа период испытательного срока руководитель назначает наставника: опытного сотрудника вашей команды. Наставник:\n\n- показывает рабочее место, процессы и неписаные правила команды;\n- первые дни выполняет операции вместе с вами, затем проверяет ваши самостоятельные операции;\n- отвечает на вопросы «как здесь принято».\n\nКак получить от наставничества максимум:\n\n- ведите заметки и список вопросов, задавайте их в удобный для наставника момент, а не на пике смены;\n- попросите показать типичные ошибки новичков на вашем участке;\n- перед встречей с руководителем через месяц обсудите с наставником, что уже получается, а что нет.\n\n### Безопасность с первого дня\n\nОхране труда и информационной безопасности посвящены отдельные обязательные курсы Jana Academy: «Охрана труда на складе и в ПВЗ» (пройдите до начала работы на складе, в СЦ или ПВЗ) и «Информационная безопасность и персональные данные» (для всех). Минимум, который действует с первой минуты: держите проходы и эвакуационные выходы свободными, не заходите в зону движения погрузочной техники, о неисправности или травме сразу сообщайте старшему смены; никому не называйте пароль и коды из SMS, блокируйте компьютер, когда отходите, и не фотографируйте документы и данные клиентов.\n\n### К кому обращаться\n\n- **Задачи, смены, график** → непосредственный руководитель или старший смены.\n- **«Как здесь принято», рабочие приёмы** → наставник.\n- **Отпуск, аванс, справки, данные в профиле** → сначала AI Jana и раздел «Заявки» в JanaMen; если ответа нет, кнопка «Задать вопрос HR».\n- **Доступы, пароли, подозрительные письма и сообщения** → IT.\n- **Травма, задымление, опасная ситуация** → немедленно старший смены; при угрозе жизни звоните **112**.\n- **Конфликт с коллегой, нарушение этики** → руководитель или HR.\n\n### Пример\n\nНа второй день у Сабины, нового оператора ПВЗ, не открывается JanaMen. В обед ей приходит SMS от «службы поддержки Jana Post» с просьбой назвать код подтверждения.\n\n- С доступом в JanaMen Сабина идёт в IT.\n- На SMS она не отвечает и код не называет: сотрудники компании никогда не просят коды из SMS. О сообщении Сабина тоже сообщает в IT, чтобы коллег предупредили.\n- Вопрос, когда ей выплатят первую зарплату, Сабина задаёт AI Jana и получает ответ со ссылкой на положение.'),
  -- урок welcome 8: статья, 596 слов → 5 мин
  ('welcome', 8, 'JanaMen: HR-сервисы в одном окне', 'article', 5, null, null, null, E'**JanaMen** служит HR-платформой и личным кабинетом сотрудника Jana Post. Здесь вы видите свои кадровые данные, оформляете заявки, выполняете задачи, учитесь и получаете ответы на HR-вопросы. Сроки ниже взяты из регламентов HR-сервиса (демо).\n\n### Профиль: данные из 1С:ЗУП\n\n- В профиле: ФИО, должность, подразделение, руководитель, дата приёма и остаток отпуска.\n- Официальные кадровые данные ведутся в **1С:ЗУП** (системе кадрового учёта и расчёта зарплаты), а в JanaMen они отмечены как **«только чтение»**. Так данные совпадают во всех документах: в приказах, расчётных листках и справках.\n- Чтобы изменить данные, оформите заявку **«Изменение данных»**: укажите, что изменить, и новое значение. Подтверждающий документ (например, свидетельство о браке при смене фамилии) передайте в HR. После того как HR внесёт изменения в 1С:ЗУП, профиль обновится при синхронизации.\n\n### Заявки: отпуск, аванс, справка\n\nНовая заявка: «Заявки» → «Новая заявка» → выберите тип. Маршрут любой заявки: **руководитель → HR → 1С:ЗУП**. Статусы:\n\n1. **На согласовании**: заявка у руководителя, он рассматривает её в течение 2 рабочих дней.\n2. **Согласовано, у HR**: руководитель согласовал, HR проверяет заявку.\n3. **Оформляется в 1С**: HR передал её в 1С:ЗУП (приказ, ведомость или справка).\n4. **Оформлено**: готово, номер документа виден в карточке заявки.\n\nБывают также статусы **Отклонено** (всегда с причиной) и **Отменено** (вы отменили заявку сами). Заявку, которую HR ещё не оформил, можно отменить и подать новую.\n\nОсобенности типов заявок:\n\n- **Отпуск**: выберите даты, и JanaMen посчитает дни без праздников и проверит остаток. Подавайте заявку не позднее чем за 14 календарных дней до начала отпуска, чтобы руководитель успел спланировать смены.\n- **Аванс**: не чаще одного раза в календарный месяц и не более 50% оклада. Деньги поступают на зарплатную карту в течение 3 рабочих дней после оформления, сумма удерживается из зарплаты за текущий месяц.\n- **Справка с места работы**: укажите цель (банк, виза, по месту требования), язык (русский, казахский, английский) и число экземпляров. HR оформляет справку в течение 1 рабочего дня.\n\n### Мои задачи\n\nВ разделе задач, вкладка «Мои задачи», собраны поручения руководителя и ваши личные задачи. У каждой задачи есть **срок**, приоритет, постановщик и комментарии. Статусы идут по порядку: **К выполнению → В работе → На проверке → Готово**. О новой задаче приходит уведомление. Если видите, что не успеваете к сроку, напишите об этом в комментарии заранее, а не в последний день.\n\n### Jana Academy\n\nЗдесь назначенные вам курсы со сроками. Курс состоит из уроков трёх типов: статья, видео и практика с мгновенной проверкой, а завершается итоговым тестом с проходным баллом. Если не набрали балл, повторите материал и пересдайте тест: количество попыток не ограничено. Результат появляется в профиле. Просроченные обязательные курсы видны руководителю и HR.\n\n### AI Jana\n\n- Отвечает **только по утверждённой базе знаний HR** и к каждому ответу прикладывает **источник**: положение или регламент.\n- Ваши личные данные (остаток отпуска, статус заявок, курсы) берёт из профиля и 1С:ЗУП.\n- Не принимает кадровых решений и не раскрывает данные других сотрудников.\n- Если надёжного ответа нет, честно говорит об этом и предлагает **«Задать вопрос HR»**. Создаётся обращение с номером, ответ придёт в уведомления, а история хранится в разделе «Мои вопросы в HR».\n\n### Уведомления\n\nКолокольчик в правом верхнем углу: смена статуса заявки, новая задача, назначенный курс, ответ HR. Прочитанные уведомления можно отметить кнопкой «Прочитать все».\n\n### Пример: отпуск от идеи до приказа\n\nАсель, оператор ПВЗ, хочет отпуск на 14 дней с 7 июля.\n\n1. Она спрашивает AI Jana: «Сколько у меня дней отпуска?» и видит остаток со ссылкой на источник.\n2. 10 июня, раньше чем за 14 дней, она создаёт заявку «Отпуск» с датами 7–20 июля.\n3. Статус «На согласовании»: руководитель проверяет график ПВЗ и согласует.\n4. Статус «Согласовано, у HR», затем «Оформляется в 1С»: HR оформляет приказ в 1С:ЗУП.\n5. Статус «Оформлено». На каждом шаге Асель получала уведомление и ни разу не ходила в отдел кадров лично.'),
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/36.htm
  -- урок welcome 9: практика, 5 вопросов → 6 мин
  ('welcome', 9, 'Проверь себя: первые недели и JanaMen', 'practice', 6, null, null, null, E'Проверка по урокам 5–8: ценности, первые недели по Трудовому кодексу РК и HR-сервисы JanaMen. Ответ проверяется сразу, а пояснение подскажет, к какому уроку вернуться.'),
  -- урок service 1: статья, 560 слов → 5 мин
  ('service', 1, 'Стандарт общения: приветствие, язык клиента и тон', 'article', 5, null, null, null, E'Клиент оценивает Jana Post по разговору с вами: на стойке пункта выдачи, по телефону или в чате. Стандарт ниже взят из внутреннего регламента клиентского сервиса (демо) и действует для ПВЗ и службы поддержки.\n\n### Три правила стандарта\n\n1. **Клиент видит, что ему рады.** Вы здороваетесь первым, ваше внимание на клиенте, а не на экране или телефоне.\n2. **Клиент получает ответ на своём языке.** Казахский или русский: тот, на котором к вам обратились.\n3. **Клиент уходит со следующим шагом.** Даже если вопрос не решён сразу, он знает, что будет дальше и когда.\n\n### Приветствие на ПВЗ\n\n- Поприветствуйте клиента в первые секунды, даже если заняты: короткое «Сәлеметсіз бе! Бір минут» или «Здравствуйте! Одну минуту» показывает, что его заметили.\n- Посмотрите на клиента, улыбнитесь, личный телефон уберите.\n- Бейдж с именем держите на виду.\n\nБазовые фразы на двух языках:\n\n- «Сәлеметсіз бе!» / «Здравствуйте!»\n- «Қош келдіңіз!» / «Добро пожаловать!»\n- «Сізге қалай көмектесе аламын?» / «Чем могу помочь?»\n- «Рахмет!» / «Спасибо!»\n- «Сау болыңыз!» / «До свидания!»\n\n### Очередь и невербальное общение\n\nКлиент считывает отношение раньше, чем слышит слова. Сложенные руки, взгляд в телефон и вздох при виде очереди говорят «вы мне мешаете», даже если фраза вежливая.\n\n- Держите открытую позу и смотрите на того, с кем говорите.\n- Если очередь растёт, коротко обратитесь к ожидающим: «Здравствуйте, я вас вижу, обслужу по очереди». Люди легче ждут, когда знают, что их заметили.\n- Не обсуждайте с коллегами личные темы и других клиентов при посетителях.\n- Если нужно отойти от стойки, скажите клиенту, куда и на сколько: «Посылка на дальнем стеллаже, вернусь через минуту».\n\n### Приветствие в поддержке\n\nПо телефону назовите компанию, отдел и своё имя: «Jana Post, служба поддержки, меня зовут Айдана. Чем могу помочь?» По-казахски: «Jana Post, қолдау қызметі, менің атым Айдана. Сізге қалай көмектесе аламын?» В чате поздоровайтесь по имени клиента и подтвердите, что вопрос получен. Подробнее о телефоне и чате в уроке 8.\n\n### Язык клиента\n\n- Отвечайте на языке, на котором к вам обратились. Если клиент перешёл на другой язык, переходите вместе с ним.\n- Если не уверены, спросите: «Сізге қай тілде ыңғайлы: қазақша ма, орысша ма?» / «Вам удобнее на казахском или на русском?»\n- Если вашего уровня языка не хватает, скажите об этом честно и предложите решение: позвать коллегу, который свободно говорит на этом языке, или спросить, удобно ли продолжить на другом языке. Молча переходить на другой язык нельзя.\n- Не комментируйте выбор языка, акцент или ошибки клиента.\n\n### Тон и слова\n\n- Обращайтесь на «вы» ко всем клиентам, независимо от возраста.\n- Говорите спокойно, в среднем темпе, без внутреннего жаргона: не «трек висит на СЦ», а «посылка сейчас в сортировочном центре в Алматы».\n- Заменяйте фразы, которые звучат как отказ:\n  - «Я не знаю» → «Сейчас уточню, это займёт около пяти минут».\n  - «Это не ко мне» → «Этим занимается отдел претензий. Я передам ваш вопрос и скажу, когда ждать ответа».\n  - «Вы сами неправильно указали адрес» → «Давайте вместе проверим данные заказа».\n  - «Успокойтесь» → «Понимаю, ситуация неприятная. Давайте разберёмся».\n  - «Не положено» → «По правилам я могу сделать вот что».\n\n### Завершение разговора\n\nПодведите итог: что сделано и что будет дальше. Спросите, остались ли вопросы. Поблагодарите и попрощайтесь на языке клиента.\n\n### Пример\n\nКлиентка подходит к стойке ПВЗ, пока оператор Ерлан выдаёт посылку другому клиенту. Ерлан поднимает взгляд: «Сәлеметсіз бе! Бір минут». Освободившись, он спрашивает: «Сізге қалай көмектесе аламын?»\n\nКлиентка отвечает по-русски: «Я за посылкой, вот номер». Ерлан продолжает по-русски, находит отправление, проверяет документ и вместе с клиенткой осматривает упаковку. Прощаясь, говорит: «Посылка у вас, упаковка целая. Спасибо, всего доброго!»\n\nКлиентка провела у стойки три минуты, получила посылку и ни разу не почувствовала, что мешает.'),
  -- источник (Rogers, Farson, «Active Listening»): https://www.gordontraining.com/free-workplace-articles/active-listening/
  -- урок service 2: статья, 551 слов → 5 мин
  ('service', 2, 'Активное слушание: услышать, что нужно клиенту', 'article', 5, null, null, null, E'### Что такое активное слушание\n\n**Активное слушание** означает слушать так, чтобы понять не только слова собеседника, но и его чувства и потребность, и показать ему, что вы это поняли. Подход описали американские психологи Карл Роджерс и Ричард Фарсон в работе «Active Listening».\n\nВ сервисе это даёт два результата. Клиент, который чувствует, что его услышали, успокаивается быстрее. А вы точнее понимаете задачу и не решаете не ту проблему.\n\n### Три слоя в словах клиента\n\nКлиент говорит: «Я третий раз прихожу, а посылки всё нет! Мне в субботу подарок дарить!»\n\n- **Факты**: приходит третий раз, посылки нет, событие в субботу.\n- **Эмоции**: раздражение и тревога.\n- **Потребность**: понять, успеет ли посылка к субботе, и больше не приходить зря.\n\nЕсли ответить только на факт («посылка ещё в пути»), клиент уйдёт недовольным. Если ответить на потребность («давайте посмотрим, где она сейчас, и я скажу, реально ли успеть к субботе»), разговор становится совместной работой.\n\n### Шесть приёмов\n\n1. **Не перебивать.** Дайте договорить, даже если ответ уже готов. Пауза в 2–3 секунды после реплики клиента часто приносит самую важную деталь.\n2. **Показывать внимание.** На ПВЗ: взгляд на клиента, кивок, руки свободны. По телефону: короткие реакции «да», «понимаю», «так». В чате: «Получила ваше сообщение, смотрю».\n3. **Уточнять.** Открытые вопросы собирают картину: «Что именно было с упаковкой?», «Когда пришло уведомление?» Закрытые вопросы подтверждают детали: «Номер заканчивается на 4821?»\n4. **Перефразировать.** Перескажите своими словами, чтобы проверить понимание: «Правильно ли я понимаю: уведомление пришло вчера, а сегодня посылки в ячейке нет?»\n5. **Отражать чувства.** Назовите эмоцию без оценки: «Вижу, что вы расстроены: вы рассчитывали на подарок к субботе».\n6. **Резюмировать.** Завершите итогом: что выяснили, что вы делаете и когда клиент получит ответ.\n\n### Активное слушание в чате\n\nВ чате вы не видите лица и не слышите голоса, поэтому сигналы внимания передаются словами.\n\n- Прочитайте сообщение клиента целиком, включая предыдущие сообщения в диалоге, прежде чем отвечать.\n- Подтвердите получение и покажите, что делаете: «Вижу ваш вопрос о посылке, проверяю статус».\n- Перефразируйте в письменном виде, если вопрос неоднозначный: «Уточню: вы хотите изменить пункт выдачи или получить посылку курьером?»\n- Отвечайте на все вопросы из сообщения клиента, а не только на первый. Если вопросов три, удобно пронумеровать ответы.\n\n### Полезные вопросы\n\n- «Расскажите, пожалуйста, подробнее, что произошло».\n- «Что для вас сейчас важнее всего?»\n- «Когда вам нужно получить посылку?»\n- «Что вы уже успели попробовать?»\n- «Правильно ли я понимаю, что...?»\n\n### Что мешает слушать\n\n- готовить ответ, пока клиент ещё говорит;\n- перебивать готовым решением;\n- обесценивать: «да у всех так», «ничего страшного»;\n- молча смотреть в монитор вместо клиента. Если нужно проверить систему, скажите: «Сейчас посмотрю данные, это займёт минуту»;\n- переходить к правилам раньше, чем клиент почувствовал, что его услышали.\n\n### Пример: звонок в поддержку\n\n**Клиент:** Вчера в приложении был Шымкент, а сегодня Алматы! Вы отправили посылку не туда?\n\n**Оператор:** Понимаю, это сбивает с толку. Давайте разберёмся. Правильно ли я понимаю: вчера вы видели Шымкент, а сегодня статус показывает Алматы?\n\n**Клиент:** Да, именно.\n\n**Оператор:** Назовите, пожалуйста, трек-номер. Спасибо, вижу отправление. Вчера вы видели город назначения, а сегодня посылку отсканировали в сортировочном центре в Алматы: маршрут в Шымкент проходит через него. Это обычный этап.\n\n**Клиент:** То есть она не потерялась?\n\n**Оператор:** Нет, она движется по маршруту. Итак: посылка прошла сортировку в Алматы и едет в Шымкент. Как только она поступит в ваш пункт выдачи, придёт уведомление в приложении. Могу ещё чем-то помочь?\n\nЧто сработало: оператор не спорил с эмоцией, сначала перефразировал вопрос, затем объяснил факты простыми словами и закончил резюме со следующим шагом.'),
  -- урок service 3: видео https://www.youtube.com/watch?v=WsbgOEWaA-8, длительность 7:55 → 10 мин; oEmbed: title и author_name совпадают с video_title / video_channel
  ('service', 3, 'Видео: техника активного слушания', 'video', 10, 'WsbgOEWaA-8', 'Техника активного слушания. Как научиться слушать и слышать собеседника.', 'Я ГОВОРЮ', E'Видео на русском языке. Автор разбирает технику активного слушания из пяти этапов: молчание (не перебивать), мысленное повторение слов собеседника, повторение вслух с поддерживающими реакциями, уточняющие вопросы и перефразирование, сопереживание. В конце предлагается упражнение: в течение дня говорить заметно меньше обычного и больше слушать.\n\nПримеры в видео взяты из повседневной жизни. Во время просмотра переносите каждый этап на разговор с клиентом на ПВЗ или в поддержке. Поддерживающие реакции на работе выбирайте нейтральные и вежливые: «понимаю», «да, слушаю», «так».\n\n### Ключевые выводы\n\n- Слушание начинается с молчания: не перебивайте, даже если ответ уже готов.\n- Мысленное повторение помогает не отвлекаться на свои мысли и не упустить главное.\n- Уточняющий вопрос и перефразирование защищают от ошибки: вы решаете ту проблему, которая действительно есть у клиента.\n- Сопереживание делает разговор живым: человек раскрывается, когда чувствует, что его понимают.\n- Упражнение из видео стоит повторить на смене: меньше говорить, больше спрашивать и уточнять.'),
  -- урок service 4: практика, 4 вопроса → 5 мин
  ('service', 4, 'Проверь себя: общение и слушание', 'practice', 5, null, null, null, E'Проверка по урокам 1–3: стандарт общения и активное слушание. Ответ проверяется сразу, а пояснение подскажет, что повторить.'),
  -- источник (модель HEARD, Disney Institute): https://wp.customerservicegroup.com/2025/05/15/service-recovery-the-disney-way/
  -- урок service 5: статья, 567 слов → 5 мин
  ('service', 5, 'Жалобы и деэскалация: модель HEARD', 'article', 5, null, null, null, E'### Жалоба как сигнал\n\nКлиент, который жалуется, даёт компании шанс исправить ситуацию и узнать о проблеме в процессе. Ваша задача не выиграть спор, а вернуть клиенту уверенность, что его вопрос решат.\n\n### Модель HEARD\n\nДля работы с жалобами в демо-стандарте Jana Post используется модель **HEARD**. Её разработал Disney Institute как пятишаговый процесс восстановления сервиса (service recovery).\n\n1. **H, Hear: выслушать.** Дайте клиенту рассказать всё до конца, не перебивая. Используйте приёмы активного слушания из урока 2.\n2. **E, Empathize: посочувствовать.** Покажите, что понимаете чувства клиента: «На вашем месте я бы тоже расстроилась». Сочувствие не означает согласия с каждым словом.\n3. **A, Apologize: извиниться.** Извинитесь за то, как ситуация отразилась на клиенте, даже если ошибку допустили не вы: «Мне жаль, что вам пришлось прийти зря». Такое извинение не признаёт вину компании до проверки и не обещает компенсацию.\n4. **R, Resolve: решить.** Найдите лучшее доступное решение в рамках ваших полномочий. Предложите варианты, договоритесь о следующем шаге и сроке, зарегистрируйте обращение и назовите клиенту его номер.\n5. **D, Diagnose: найти причину.** После разговора выясните, почему так произошло, и передайте информацию старшему смены или руководителю, чтобы ошибка не повторилась.\n\n### Если клиент кричит\n\n- **Снизьте темп.** Говорите тише и медленнее клиента. Повышенный голос в ответ только разгоняет конфликт.\n- **Не принимайте на свой счёт.** Злость направлена на ситуацию, а не на вас лично.\n- **Сначала эмоция, потом факты.** На пике эмоций человек не слышит объяснений. Отразите чувство («вижу, вы очень раздражены, и понимаю почему»), затем переходите к делу.\n- **Не спорьте и не оправдывайтесь.** Фразы «у нас так положено» и «это не я» звучат как отказ помочь.\n- **Уберите публику.** На ПВЗ предложите отойти от очереди к свободной стойке, если это возможно.\n- **Дайте выбор.** «Могу оформить обращение прямо сейчас или передать вопрос в поддержку с обратным звонком. Как вам удобнее?» Выбор возвращает клиенту ощущение контроля.\n\n**Граница.** Оскорбления и угрозы недопустимы. Спокойно обозначьте это: «Я хочу вам помочь, но не могу продолжать разговор в таком тоне». Если оскорбления продолжаются, по демо-регламенту позовите старшего смены, а в поддержке передайте разговор руководителю группы. При угрозе жизни и здоровью звоните **112**.\n\n### Пример\n\nКлиент на ПВЗ: «Неделю жду! Мне обещали к понедельнику, у вас бардак!»\n\n- **H:** оператор выслушивает до конца, кивает и не перебивает.\n- **E:** «Понимаю, вы рассчитывали получить посылку к понедельнику, а ждёте неделю. Это неприятно».\n- **A:** «Мне жаль, что так вышло».\n- **R:** проверяет статус: посылка в сортировочном центре. «Посылка сейчас в сортировочном центре. Я оформлю обращение о задержке, вот его номер, ответ придёт в срок, указанный в обращении. Как только посылка поступит к нам, вы получите уведомление».\n- **D:** после смены оператор сообщает старшему, что это третья жалоба за неделю по этому направлению, и узнаёт, кто пообещал клиенту понедельник.\n\n### После трудного разговора\n\nТяжёлый разговор оставляет напряжение, даже если вы всё сделали правильно. Если его не снять, оно перейдёт на следующего клиента.\n\n- **Пауза.** Если позволяет очередь, возьмите 1–2 минуты: отойдите от стойки, выпейте воды. Попросите старшего смены подменить вас.\n- **Дыхание.** Сделайте несколько медленных вдохов и выдохов, выдох длиннее вдоха: например, вдох на 4 счёта, выдох на 6. Многим это помогает успокоиться.\n- **Отделите себя от ситуации.** Скажите себе: «Клиент злился на задержку, а не на меня».\n- **Проговорите.** Расскажите старшему смены или коллеге, что произошло. Это разбор, а не жалоба: вместе проще понять, что можно сделать иначе.\n- **Зафиксируйте факты**, пока помните детали: время, номер отправления, суть претензии.\n- **Скажите, если тяжело постоянно.** Если трудные разговоры идут один за другим и усталость не проходит, обсудите это с руководителем или HR. Это сигнал о нагрузке, а не о слабости.'),
  -- урок service 6: видео https://www.youtube.com/watch?v=QaoFcNiQO6M, длительность 14:08 → 17 мин; oEmbed: title и author_name совпадают с video_title / video_channel
  ('service', 6, 'Видео: алгоритм работы с жалобами', 'video', 17, 'QaoFcNiQO6M', 'Видео №73. Алгоритм работы с жалобами. Что делать, когда он кричит.', 'Оксана ЛУКИНА', E'Видео на русском языке. Автор, Оксана Лукина, разбирает ситуацию, когда клиент звонит и кричит, и предлагает алгоритм работы с жалобой. Видео ориентировано на менеджеров, которые общаются с клиентами по телефону, поэтому напрямую подходит для службы поддержки. На ПВЗ те же принципы работают в личном разговоре.\n\nВо время просмотра сравните алгоритм автора с моделью HEARD из прошлого урока: какие шаги совпадают, что автор предлагает делать с эмоцией клиента до перехода к решению и как завершать разговор.\n\n### Ключевые выводы для работы в Jana Post\n\n- Крик клиента направлен на ситуацию, а не на вас лично. Отвечайте спокойнее и медленнее.\n- Пока эмоция не снижена, объяснения и правила не работают: сначала выслушайте и признайте чувства.\n- Решение предлагайте в рамках своих полномочий, с понятным следующим шагом и сроком.\n- Каждая жалоба фиксируется, а её причина передаётся руководителю, чтобы ситуация не повторилась.'),
  -- урок service 7: статья, 558 слов → 5 мин
  ('service', 7, 'Выдача и возврат посылок: регламент (демо)', 'article', 5, null, null, null, E'Ниже демо-регламент прототипа JanaMen. Он показывает логику процесса; в реальной работе действуйте по регламенту, утверждённому для вашего пункта выдачи.\n\n### Выдача: шесть шагов\n\n1. **Поприветствуйте и запросите данные отправления**: трек-номер или код получения из приложения Jańa Post или уведомления.\n2. **Найдите отправление в системе** и убедитесь, что статус позволяет выдачу: посылка поступила именно в ваш ПВЗ.\n3. **Проверьте документ, удостоверяющий личность.** ФИО в документе должно совпадать с получателем в системе, а фото в документе с человеком перед вами. Если посылку забирает представитель, нужна доверенность. Документ только смотрят: не фотографируйте его и не делайте копий, а в систему вносите лишь те данные, которые требует форма.\n4. **Найдите посылку в ячейке хранения** и сверьте номер на этикетке с номером в системе. Номера часто отличаются одной-двумя цифрами, поэтому сверяйте номер полностью, а не последние цифры.\n5. **Осмотрите упаковку вместе с клиентом до вручения**: целостность, следы вскрытия или повторной заклейки, влага, вмятины, разрывы. Скажите: «Пожалуйста, посмотрите упаковку при мне».\n6. **Вручите посылку и отметьте выдачу в системе** сканом или подтверждением кодом. Без этой отметки посылка числится на ПВЗ, а клиент продолжает получать напоминания.\n\n### Курьерская доставка: те же правила у двери\n\n- Перед выездом свяжитесь с клиентом и согласуйте удобное время в пределах интервала доставки.\n- У двери представьтесь и назовите компанию: «Здравствуйте, Jana Post, курьерская доставка».\n- Проверьте документ получателя так же, как на ПВЗ. Передать посылку соседу или другому человеку можно только с согласия получателя и по правилам регламента.\n- Осмотрите упаковку вместе с клиентом до передачи. При повреждении составьте акт на месте.\n- Отметьте вручение в системе сразу, а не в конце дня.\n\n### Если упаковка повреждена\n\n- Не скрывайте повреждение и не вскрывайте посылку без клиента.\n- Предложите клиенту осмотреть вложение в вашем присутствии.\n- Составьте **акт о повреждении**. В нём указывают:\n  - номер отправления, дату и время;\n  - описание повреждения упаковки и, если посылку вскрывали, состояние вложения;\n  - фактический вес, если он отличается от указанного;\n  - фотографии, сделанные **служебным** устройством;\n  - подписи сотрудника и клиента. Копию акта отдайте клиенту.\n- Клиент решает сам: забрать посылку с актом или отказаться от получения. В обоих случаях зарегистрируйте претензию в системе и назовите клиенту номер обращения.\n- Не обещайте результат претензии: решение принимает ответственное подразделение после проверки.\n\n### Отказ и возврат\n\n- **Отказ при получении.** Зафиксируйте причину в системе (повреждение, не тот товар, клиент передумал). Посылка уходит по обратной логистике.\n- **Приём возврата.** Проверьте в системе, что возврат по этому отправлению возможен. Условия возврата зависят от продавца или площадки, поэтому возврат денег сами не обещайте. Убедитесь, что товар упакован, наклейте возвратную этикетку, отсканируйте посылку и выдайте клиенту квитанцию с номером возвратного отправления.\n- **Невостребованные посылки.** Срок хранения указан в системе и в уведомлении клиенту. Когда клиент звонит или приходит, напоминайте ему об этом сроке. После его окончания посылка возвращается по регламенту.\n\n### Чего не делать\n\n- выдавать посылку без документа, по фотографии документа или «знакомому» получателя;\n- осматривать упаковку после ухода клиента;\n- оставлять посылки без присмотра на стойке;\n- забывать отметку о выдаче в системе.\n\n### Пример\n\nНурлан пришёл за посылкой. Документ совпадает с получателем, номер на этикетке сверен полностью. При осмотре видно, что угол коробки мокрый и смят.\n\nОператор: «Вижу повреждение упаковки. Давайте вместе посмотрим содержимое, и я составлю акт».\n\nВнутри товар цел, но его заводская коробка намокла. Нурлан решает забрать посылку. Оператор составляет акт, фотографирует упаковку служебным планшетом, оба подписывают акт, копию получает Нурлан. Оператор регистрирует обращение и называет его номер.\n\nЕсли позже обнаружится скрытое повреждение, у клиента есть акт, а у компании понятная картина: повреждение зафиксировано на выдаче, и проверять нужно предыдущие участки цепочки.'),
  -- источник: https://prg.kz/m/amp/document/31396226/2/120000
  -- (Закон РК от 21.05.2013 № 94-V «О персональных данных и их защите», ст. 11, 12, 14; редакция на 14.09.2026)
  -- урок service 8: статья, 514 слов → 5 мин
  ('service', 8, 'Телефон и чат: этикет, обещания и персональные данные', 'article', 5, null, null, null, E'### Телефон (демо-стандарт)\n\n- Отвечайте быстро, не позднее третьего гудка.\n- Представьтесь: компания, отдел, имя. Улыбка слышна в голосе.\n- Перед ожиданием спросите разрешения и назовите время: «Можно я поставлю вас на удержание на две минуты, чтобы проверить данные?» Возвращайтесь в обещанное время, даже если ответа ещё нет: «Ещё проверяю, нужно ещё две минуты».\n- Переводите звонок с объяснением, кому и зачем. Передайте коллеге суть вопроса, чтобы клиенту не пришлось повторять.\n- Во время разговора не ешьте и не отвлекайтесь на разговоры с коллегами.\n- Завершайте итогом, следующим шагом и благодарностью. Первым кладёт трубку клиент.\n\nЕсли звонок оборвался, а номер клиента есть в обращении, перезвоните сами в течение нескольких минут: клиент не должен заново ждать на линии и повторять вопрос.\n\n### Чат (демо-стандарт)\n\n- Поздоровайтесь по имени и подтвердите, что вопрос получен.\n- Одно сообщение содержит одну мысль. Короткие абзацы, без капслока, сленга и эмодзи в официальных ответах.\n- Шаблоны используйте как основу, но отвечайте на конкретный вопрос. Шаблон без сути раздражает.\n- Если нужно время, напишите, сколько: «Проверяю статус, вернусь с ответом в течение пяти минут».\n- Перечитайте сообщение перед отправкой: номер отправления, даты, имя.\n- Пишите на языке клиента (урок 1).\n\n### Чего нельзя обещать\n\nОбещание, которое вы не контролируете, превращает задержку в обман. Нельзя обещать:\n\n- точную дату или время доставки, если система её не показывает;\n- компенсацию, возврат денег или результат претензии до решения ответственного подразделения;\n- что посылку «точно найдут сегодня», если её нет в системе;\n- исключение из правил: выдачу без документа, хранение сверх срока, обслуживание без очереди;\n- «лично прослежу и перезвоню», если вы не сможете этого сделать.\n\nОбещайте то, что зависит от вас: «Я зарегистрировал обращение, вот его номер. Ответ придёт в срок, указанный в обращении. Если статус изменится раньше, вы получите уведомление».\n\n### Персональные данные клиента\n\nЗакон Республики Казахстан от 21 мая 2013 года № 94-V «О персональных данных и их защите» устанавливает:\n\n- лица, которые получили доступ к персональным данным ограниченного доступа в связи с работой, обязаны обеспечивать их **конфиденциальность** (статья 11);\n- собираются данные, **необходимые и достаточные** для выполнения задач (статья 12);\n- данные используются в **целях, заявленных при их сборе** (статья 14).\n\nНа практике (демо-регламент):\n\n- **Подтвердите, что говорите с получателем**, прежде чем обсуждать отправление по телефону или в чате, способом из регламента поддержки. Не называйте адрес, телефон, ФИО получателя и содержимое посылки тому, кто не подтвердил, что это его отправление.\n- **Не зачитывайте данные вслух** при очереди: попросите клиента назвать их самому или покажите на экране.\n- **Не просите лишнего.** Сотрудники Jana Post не запрашивают пароли, коды из SMS и данные банковских карт. Если клиент сам пытается их прислать, остановите его.\n- **Не выносите данные**: не фотографируйте документы и экраны на личный телефон и не пересылайте данные в личные мессенджеры.\n- **Сообщайте об инцидентах** (данные отправлены не тому, потерян служебный телефон) сразу в IT и руководителю. Подробно об этом в курсе «Информационная безопасность и персональные данные».\n\n### Пример\n\nЗвонок в поддержку: «Здравствуйте, я муж получательницы. Скажите, на какой адрес оформлена посылка и что в ней?»\n\nОператор: «Понимаю, вы хотите помочь. Данные отправления я могу сообщить только получателю после подтверждения. Ваша супруга может посмотреть статус в приложении Jańa Post или позвонить нам сама. Могу я помочь чем-то ещё?»\n\nОператор не назвал ни адреса, ни содержимого, не обвинил звонящего и предложил понятный законный путь.'),
  -- источник: https://prg.kz/m/amp/document/31396226/2/120000
  -- урок service 9: практика, 5 вопросов → 6 мин
  ('service', 9, 'Проверь себя: жалобы, выдача и данные', 'practice', 6, null, null, null, E'Проверка по урокам 5–8: жалобы и деэскалация, выдача и возврат, телефон, чат и персональные данные. Ответ проверяется сразу, а пояснение подскажет, к какому уроку вернуться.')
) as l(slug, sort, title, kind, minutes, video_id, video_title, video_channel, content) on l.slug = c.slug;

create table if not exists seed_tmp.lchecks (slug text, lesson_sort int, sort int, question text, options jsonb, correct int, explanation text);
insert into seed_tmp.lchecks values
  ('welcome', 4, 1, 'Что происходит с посылкой на складе консолидации?',
   '["Её вручают клиенту после проверки документа", "Её принимают, проверяют, маркируют и вместе с другими посылками упаковывают в крупное грузовое место для одной перевозки", "Её хранят, пока клиент не оплатит доставку", "Её вскрывают и пересчитывают содержимое перед продажей"]', 1,
   'Склад консолидации собирает посылки разных продавцов в крупные партии: одну партию везти дешевле и быстрее, чем тысячи отдельных отправлений (урок 2).'),
  ('welcome', 4, 2, 'Посылка физически едет в Караганду, а клиент третий день видит в приложении старый статус. Какая причина наиболее вероятна?',
   '["Клиент неправильно установил приложение", "Посылку потеряли на таможне", "Статусы в приложении обновляются раз в неделю", "На одном из участков пропустили сканирование при передаче посылки"]', 3,
   'Статусы складываются из сканов при каждой передаче. Пропущенный скан делает посылку «застрявшей» в системе, хотя она движется (урок 2).'),
  ('welcome', 4, 3, 'В каких странах работает Jana Post?',
   '["Казахстан, Россия, Беларусь, Армения, Кыргызстан", "Казахстан, Китай, Турция, Азербайджан, Грузия", "Казахстан, Кыргызстан, Узбекистан, Таджикистан, Монголия", "Только в Казахстане"]', 2,
   'Jana Post работает в 5 странах: Казахстан, Кыргызстан, Узбекистан, Таджикистан и Монголия (урок 1).'),
  ('welcome', 4, 4, 'Что называют «последней милей»?',
   '["Финальный участок пути до получателя, например доставку курьером до двери", "Перевозку партии через границу", "Путь посылки от продавца до склада консолидации", "Расстояние между двумя сортировочными центрами"]', 0,
   'Последняя миля: финальный участок до клиента. Его клиент видит и оценивает лучше всего (урок 2).'),
  ('welcome', 9, 1, 'Каким может быть испытательный срок оператора ПВЗ по Трудовому кодексу РК?',
   '["До шести месяцев для любой должности", "Не более одного месяца", "Не более трёх месяцев", "Ровно один год"]', 2,
   'По статье 36 ТК РК испытательный срок не превышает трёх месяцев; до шести месяцев возможно только для руководителей, их заместителей, главных бухгалтеров и руководителей филиалов (урок 6).'),
  ('welcome', 9, 2, 'Вы сменили фамилию. Как обновить её в профиле JanaMen?',
   '["Исправить в профиле самостоятельно", "Оформить заявку «Изменение данных» и передать подтверждающий документ в HR", "Написать в общий чат команды", "Ничего не делать: данные обновятся сами"]', 1,
   'Официальные данные ведутся в 1С:ЗУП и в профиле доступны только для чтения. Изменить их можно заявкой «Изменение данных» (урок 8).'),
  ('welcome', 9, 3, 'По какому маршруту проходит заявка на отпуск?',
   '["Руководитель → HR → 1С:ЗУП", "HR → бухгалтерия → руководитель", "Сразу в 1С:ЗУП без согласования", "Наставник → руководитель → HR"]', 0,
   'Любая заявка в JanaMen идёт по маршруту руководитель → HR → 1С:ЗУП, а статус меняется на каждом шаге (урок 8).'),
  ('welcome', 9, 4, 'AI Jana не нашла в базе знаний надёжного ответа. Что она сделает?',
   '["Сформулирует ответ на основе общих знаний", "Предложит поискать ответ в интернете", "Закроет диалог без ответа", "Честно скажет, что ответа нет, и предложит передать вопрос в HR"]', 3,
   'AI Jana отвечает только по базе знаний с источником. Без надёжного ответа она предлагает «Задать вопрос HR» (урок 8).'),
  ('welcome', 9, 5, 'В конце смены вы поняли, что днём положили посылку не в ту ячейку. Какое действие соответствует ценности «Открытость»?',
   '["Тихо переложить посылку и никому не говорить", "Сразу сообщить старшему смены и вместе исправить ошибку", "Подождать, пока ошибку обнаружит клиент", "Сказать, что это сделала прошлая смена"]', 1,
   'Открытость означает говорить прямо и признавать ошибки. Сообщив сразу, вы даёте команде шанс исправить ситуацию до прихода клиента (урок 5).'),
  ('service', 4, 1, 'Клиент обратился к вам на казахском, а вы свободнее говорите по-русски. Как поступить по стандарту?',
   '["Сразу перейти на русский: так быстрее", "Попросить клиента говорить по-русски", "Отвечать на казахском, а если языка не хватает, честно сказать об этом и предложить коллегу или спросить, удобно ли перейти на русский", "Сделать вид, что не расслышали, и дождаться, пока клиент перейдёт на русский"]', 2,
   'Стандарт: отвечаем на языке клиента. Если уровня языка не хватает, говорим об этом честно и предлагаем решение, а не переходим молча (урок 1).'),
  ('service', 4, 2, 'Какая фраза является перефразированием?',
   '["«Это не ко мне»", "«Правильно ли я понимаю: уведомление пришло вчера, а сегодня посылки в ячейке нет?»", "«Успокойтесь, пожалуйста»", "«У всех сейчас задержки»"]', 1,
   'Перефразирование пересказывает слова клиента своими словами, чтобы проверить понимание (урок 2).'),
  ('service', 4, 3, 'Клиент говорит: «Третий раз прихожу, а посылки нет, мне в субботу подарок дарить!» В чём его потребность?',
   '["Пожаловаться на компанию", "Получить скидку", "Узнать телефон руководителя", "Понять, успеет ли посылка к субботе, и не приходить зря"]', 3,
   'За фактами и эмоциями стоит потребность. Ответ на неё превращает жалобу в совместную работу (урок 2).'),
  ('service', 4, 4, 'Чем по стандарту заменить фразу «Я не знаю»?',
   '["«Сейчас уточню, это займёт около пяти минут»", "«Это не моя зона ответственности»", "«Посмотрите сами в приложении»", "«Спросите завтра»"]', 0,
   'Клиент должен уйти со следующим шагом: вы обещаете уточнить и называете время (урок 1).'),
  ('service', 9, 1, 'Что означает буква D в модели HEARD?',
   '["Deliver: доставить посылку любой ценой", "Delay: отложить решение", "Diagnose: найти причину, чтобы ошибка не повторилась", "Discount: предложить скидку"]', 2,
   'Последний шаг HEARD, Diagnose: после разговора выяснить причину и передать её руководителю (урок 5).'),
  ('service', 9, 2, 'При выдаче вы заметили, что угол коробки мокрый и смят. Что делать?',
   '["Выдать посылку и ничего не говорить", "Осмотреть посылку вместе с клиентом и составить акт о повреждении", "Попросить клиента прийти завтра", "Вскрыть посылку без клиента и проверить"]', 1,
   'Повреждение фиксируется сразу и при клиенте: акт с описанием, фото со служебного устройства и подписями (урок 7).'),
  ('service', 9, 3, 'Какое обещание клиенту допустимо?',
   '["«Завтра посылка точно будет у вас»", "«Мы полностью компенсируем стоимость»", "«Я лично найду посылку сегодня»", "«Я зарегистрировал обращение, вот его номер; ответ придёт в срок, указанный в обращении»"]', 3,
   'Обещайте только то, что зависит от вас. Сроки доставки и компенсации вы не контролируете (урок 8).'),
  ('service', 9, 4, 'Звонящий представляется мужем получательницы и просит назвать адрес доставки и содержимое посылки. Как ответить?',
   '["Вежливо отказать: данные сообщаются только получателю после подтверждения; предложить, чтобы получательница посмотрела статус в приложении или позвонила сама", "Назвать данные, раз это родственник", "Назвать только адрес", "Попросить прислать фото паспорта жены в мессенджер"]', 0,
   'По закону о персональных данных сотрудник обязан обеспечивать их конфиденциальность. Данные отправления сообщают только получателю (урок 8).'),
  ('service', 9, 5, 'Что рекомендуется сделать после тяжёлого разговора с клиентом?',
   '["Сразу принять следующего клиента и не думать об этом", "Обсудить этого клиента с людьми в очереди", "Написать о клиенте в личных соцсетях", "Взять короткую паузу, выровнять дыхание и рассказать о ситуации старшему смены"]', 3,
   'Пауза, дыхание и разбор со старшим снимают напряжение, чтобы оно не перешло на следующего клиента (урок 5).');

-- final test (the table seed_tmp.questions(slug, sort, question, options, correct, explanation) is created by the caller; only insert rows)
insert into seed_tmp.questions values
  ('welcome', 1, 'Какой маршрут лежит в основе бизнеса Jana Post?',
   '["Европа → Россия → Казахстан", "Китай → Казахстан → Центральная Азия", "Турция → Кавказ → Центральная Азия", "Казахстан → Китай → Монголия"]', 1,
   'Jana Post обеспечивает трансграничную торговлю между Китаем и странами Центральной Азии по маршруту Китай → Казахстан → Центральная Азия (урок 1).'),
  ('welcome', 2, 'Зачем посылки объединяют в крупные грузовые места на складе консолидации?',
   '["Чтобы клиент мог забрать сразу несколько посылок", "Чтобы не сканировать каждую посылку", "Чтобы перевезти одну крупную партию дешевле и быстрее, чем тысячи отдельных отправлений", "Чтобы не проходить таможенное оформление"]', 2,
   'Консолидация снижает стоимость и время перевозки, а каждая посылка внутри партии по-прежнему учитывается в системе (урок 2).'),
  ('welcome', 3, 'Что происходит в сортировочном центре?',
   '["Посылки сканируют и распределяют по направлениям: город, регион, ПВЗ или курьерский маршрут", "Посылки вручают получателям", "Клиенты оформляют возвраты", "Товар закупают у продавцов"]', 0,
   'Сортировочный центр разгружает партии, сканирует каждую посылку и направляет её в нужный поток (уроки 2 и 3).'),
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/68.htm
  ('welcome', 4, 'Какова нормальная продолжительность рабочего времени по Трудовому кодексу РК?',
   '["Не более 36 часов в неделю", "Не более 48 часов в неделю", "Не более 45 часов в неделю", "Не более 40 часов в неделю"]', 3,
   'Статья 68 ТК РК: нормальная продолжительность рабочего времени не более 40 часов в неделю (урок 6).'),
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/88.htm
  ('welcome', 5, 'Сколько длится основной оплачиваемый ежегодный трудовой отпуск по Трудовому кодексу РК?',
   '["14 календарных дней", "24 календарных дня", "28 рабочих дней", "30 календарных дней"]', 1,
   'Статья 88 ТК РК: 24 календарных дня, если законодательство, коллективный договор или акты работодателя не предусматривают больше (урок 6).'),
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/37.htm
  ('welcome', 6, 'Испытательный срок закончился, а работодатель не направил уведомление о расторжении договора. Что это значит?',
   '["Испытательный срок автоматически продлевается", "Трудовой договор прекращается", "Работник считается выдержавшим испытание", "Испытание нужно пройти заново"]', 2,
   'Статья 37 ТК РК: если срок истёк без уведомления о расторжении, работник считается выдержавшим испытание (урок 6).'),
  -- источник: https://kodeksy-kz.com/trudovoj_kodeks/36.htm
  ('welcome', 7, 'Сотрудник неделю болел во время испытательного срока. Что происходит со сроком?',
   '["На время фактического отсутствия испытательный срок приостанавливается", "Срок сокращается на неделю", "Срок не меняется", "Испытание считается не пройденным"]', 0,
   'Статья 36 ТК РК: испытательный срок приостанавливается на время, когда работник фактически отсутствовал на работе (урок 6).'),
  ('welcome', 8, 'Что означает статус заявки «Согласовано, у HR»?',
   '["Заявка ждёт решения руководителя", "Руководитель согласовал, и HR проверяет заявку перед оформлением в 1С:ЗУП", "Заявка уже оформлена приказом", "Заявку отклонили"]', 1,
   'Маршрут заявки: руководитель → HR → 1С:ЗУП. Статус «Согласовано, у HR» означает, что первый шаг пройден (урок 8).'),
  ('welcome', 9, 'Почему данные в профиле JanaMen доступны только для чтения?',
   '["Чтобы сотрудники не видели свои данные", "Это временное ограничение прототипа", "Профиль редактирует только руководитель", "Официальные данные ведутся в 1С:ЗУП, поэтому они совпадают во всех системах и документах"]', 3,
   '1С:ЗУП остаётся единым источником кадровых данных. Изменения вносятся через заявку «Изменение данных» (урок 8).'),
  ('welcome', 10, 'Вы пообещали клиенту перезвонить до 15:00, но не успеваете получить ответ. Как поступить по ценности «Надёжность»?',
   '["Перезвонить до 15:00, объяснить ситуацию и назвать новый срок", "Не звонить, пока не будет ответа", "Попросить коллегу сказать, что вас нет", "Написать клиенту вечером после 18:00"]', 0,
   'Надёжность: выполнять обещания, а если не получается, предупредить заранее и назвать новый срок (урок 5).'),
  ('service', 1, 'На каком языке отвечать клиенту по стандарту Jana Post?',
   '["Только на русском", "На языке, который удобнее сотруднику", "На языке, на котором клиент обратился: казахском или русском", "На английском, чтобы было нейтрально"]', 2,
   'Стандарт: отвечаем на языке клиента и переходим вместе с ним, если он сменил язык (урок 1).'),
  ('service', 2, 'Какой приём активного слушания помогает проверить, правильно ли вы поняли клиента?',
   '["Перефразирование", "Молчание до конца разговора", "Ссылка на правила", "Смена темы"]', 0,
   'Перефразирование («Правильно ли я понимаю...») проверяет понимание и показывает клиенту, что его услышали (уроки 2 и 3).'),
  -- источник: https://wp.customerservicegroup.com/2025/05/15/service-recovery-the-disney-way/
  ('service', 3, 'Что означает шаг Apologize в модели HEARD?',
   '["Признать вину компании и пообещать компенсацию", "Извиниться за то, как ситуация отразилась на клиенте, даже если ошибку допустили не вы", "Извиниться и закончить разговор", "Попросить клиента извиниться за тон"]', 1,
   'Извинение за неудобство не признаёт вину компании до проверки и не обещает компенсацию (урок 5).'),
  ('service', 4, 'Клиент на ПВЗ кричит из-за задержки. Что делать в первую очередь?',
   '["Повысить голос, чтобы вас услышали", "Сразу объяснить правила доставки", "Попросить его успокоиться", "Говорить тише и медленнее, выслушать и признать его чувства, а потом переходить к фактам"]', 3,
   'Деэскалация: сначала эмоция, потом факты. На пике эмоций человек не слышит объяснений (уроки 5 и 6).'),
  ('service', 5, 'Клиент продолжает оскорблять вас после спокойного предупреждения. Как действовать по демо-регламенту?',
   '["Ответить в том же тоне", "Позвать старшего смены, а в поддержке передать разговор руководителю группы", "Молча уйти со стойки", "Отказать клиенту в выдаче посылки навсегда"]', 1,
   'Оскорбления недопустимы: сначала спокойно обозначьте границу, затем подключите старшего (урок 5).'),
  ('service', 6, 'Что проверяют при выдаче посылки на ПВЗ?',
   '["Документ получателя (ФИО и фото) и полный номер на этикетке в сравнении с системой", "Только последние две цифры трек-номера", "Фото паспорта в телефоне клиента", "Ничего, если клиент знает трек-номер"]', 0,
   'Документ проверяют по ФИО и фото, а номер на этикетке сверяют полностью: номера часто отличаются одной цифрой (урок 7).'),
  ('service', 7, 'Что включает акт о повреждении по демо-регламенту?',
   '["Только подпись клиента", "Фото на личный телефон сотрудника", "Номер отправления, дату и время, описание повреждения, фото со служебного устройства и подписи сотрудника и клиента; копию получает клиент", "Устное описание в чате команды"]', 2,
   'Акт фиксирует повреждение при клиенте и защищает обе стороны. Фото делают только служебным устройством (урок 7).'),
  ('service', 8, 'Во время звонка вам нужно проверить данные. Как поставить клиента на удержание?',
   '["Молча нажать удержание", "Попросить перезвонить позже", "Положить трубку и перезвонить", "Спросить разрешения, назвать время ожидания и вернуться в обещанное время"]', 3,
   'Клиент должен знать, сколько ждать. Возвращайтесь в обещанное время, даже если ответа ещё нет (урок 8).'),
  -- источник: https://prg.kz/m/amp/document/31396226/2/120000
  ('service', 9, 'Какой принцип закона РК «О персональных данных и их защите» относится к сбору данных?',
   '["Собирать как можно больше данных на будущее", "Собирать данные, необходимые и достаточные для выполнения задач", "Собирать любые данные с согласия руководителя", "Собирать данные без ограничений, если клиент не возражает"]', 1,
   'Статья 12 закона: собираются данные, необходимые и достаточные для выполнения задач. Поэтому мы не просим лишнего (урок 8).'),
  ('service', 10, 'Что из перечисленного нельзя обещать клиенту?',
   '["Что вы зарегистрируете обращение и назовёте его номер", "Что придёт уведомление при смене статуса", "Точную дату доставки, если система её не показывает", "Что вы передадите вопрос в отдел претензий"]', 2,
   'Обещайте только то, что контролируете. Дату, которой нет в системе, назвать нельзя (урок 8).');

-- ===== Jana Academy: safety, infosec =====
-- Курсы «Охрана труда на складе и в ПВЗ» и «Информационная безопасность и персональные данные».
-- Длительность статьи = ceil(слов / 120); видео = длительность ролика с округлением вверх + 2; практика = число вопросов + 1.
-- Правовые факты проверены по текстам НПА РК (zakon.uchet.kz, prg.kz); источник указан комментарием над уроком и вопросом.
-- Внутренние правила Jana Post в текстах помечены как «по внутреннему регламенту (демо)».
-- Видео: встраивание проверено через https://www.youtube.com/oembed, длительность по YouTube Data API (contentDetails.duration) через ytapi.apps.mattw.io.

insert into public.courses (slug, title, description, summary, category, icon, emoji, duration_minutes, is_mandatory, pass_score) values
  ('safety', 'Охрана труда на складе и в ПВЗ', 'Обязательный курс для сотрудников складов, сортировочных центров и ПВЗ: права и обязанности по Трудовому кодексу РК, инструктажи и допуск, СИЗ, ручная переноска грузов и предельные нормы, работа рядом с техникой и конвейером, пожарная и электробезопасность, первая помощь, несчастный случай и ночные смены.', 'Вы будете безопасно поднимать и перемещать грузы, работать рядом с погрузчиком и конвейером, правильно действовать при пожаре, травме и несчастном случае и знать свои права по ТК РК.', 'safety', 'helmet', '', 0, true, 80),
  ('infosec', 'Информационная безопасность и персональные данные', 'Обязательный курс для всех сотрудников: персональные данные по Закону РК «О персональных данных и их защите», правила работы с данными клиентов на складе и в ПВЗ, пароли и двухфакторная аутентификация, фишинг, социальная инженерия, безопасная работа с ТСД, ноутбуком, флешками и Wi-Fi, действия при инциденте.', 'Вы будете бережно работать с данными клиентов и коллег, распознавать фишинг и манипуляции, защищать свои учётные записи и правильно действовать при инциденте.', 'compliance', 'lock', '', 0, true, 80);

insert into public.course_lessons (course_id, sort, title, kind, duration_minutes, video_id, video_title, video_channel, content)
select c.id, l.sort, l.title, l.kind, l.minutes, l.video_id, l.video_title, l.video_channel, l.content
from public.courses c
join (values
  -- источник: https://prg.kz/m/amp/document/38910832/15/1880000
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012665
  ('safety', 1, 'Права, обязанности, инструктажи и СИЗ', 'article', 6, null::text, null::text, null::text,
   E'### Зачем это нужно\n\nНа складе, в сортировочном центре и в пункте выдачи заказов (ПВЗ) постоянно что-то движется: погрузчики, конвейеры, тележки, сотни коробок. Большинство травм в логистике случается не из-за редких аварий, а из-за привычных действий: коробку подняли рывком, путь срезали через зону погрузчика, разлитую воду не заметили. Охрана труда нужна, чтобы каждый сотрудник вернулся со смены домой здоровым.\n\n### Что говорит Трудовой кодекс РК\n\nБезопасности и охране труда посвящён **раздел 4 Трудового кодекса РК** (Кодекс от 23 ноября 2015 года № 414-V). Права и обязанности работника закреплены в **статье 181**, работодателя: в **статье 182**.\n\n**Ваши права** (ст. 181, п. 1), в том числе:\n- рабочее место, оборудованное по требованиям безопасности и охраны труда;\n- санитарно-бытовые помещения, средства индивидуальной и коллективной защиты;\n- достоверная информация от работодателя о рабочем месте, профессиональных рисках и мерах защиты;\n- обучение, необходимое для безопасной работы;\n- **отказ от выполнения работы**, если работодатель не обеспечил вас средствами защиты или возникла ситуация, угрожающая вашей жизни и здоровью; об отказе нужно письменно известить непосредственного руководителя или работодателя;\n- обращение в территориальное подразделение уполномоченного органа по труду с просьбой обследовать условия труда на рабочем месте.\n\n**Ваши обязанности** (ст. 181, п. 2), в том числе:\n- соблюдать нормы, правила и инструкции по безопасности и охране труда;\n- **немедленно сообщать** работодателю или организатору работ о каждой производственной травме, о признаках профессионального заболевания и о ситуации, которая угрожает жизни и здоровью людей;\n- проходить обязательные медицинские осмотры;\n- применять по назначению выданные средства индивидуальной и коллективной защиты;\n- проходить обучение, инструктирование и проверку знаний.\n\n**Работодатель обязан** (ст. 182, п. 2), в частности, оценивать профессиональные риски и снижать их, обучать и инструктировать работников, выдавать спецодежду, спецобувь и средства защиты, обеспечивать аптечки, организовывать обязательные медосмотры и расследовать несчастные случаи. Работников, которые нарушают требования безопасности, работодатель вправе отстранить от работы и привлечь к дисциплинарной ответственности (ст. 182, п. 1).\n\n### Пять видов инструктажа\n\nПорядок установлен **Правилами и сроками проведения обучения, инструктирования и проверок знаний по вопросам безопасности и охраны труда** (приказ Министра здравоохранения и социального развития РК от 25 декабря 2015 года № 1019).\n\n1. **Вводный.** Для всех новых работников независимо от опыта, а также для временных работников и практикантов. Проводит служба охраны труда или назначенный работник. В конце устная проверка и запись в журнале вводного инструктажа с подписями обеих сторон.\n2. **Первичный на рабочем месте.** До начала самостоятельной работы, индивидуально, с показом безопасных приёмов. Проводит непосредственный руководитель: мастер, начальник участка, старший смены.\n3. **Повторный.** Не реже одного раза в полугодие, в рабочее время, по программе первичного.\n4. **Внеплановый.** При введении новых или изменённых норм безопасности; при изменении технологии, оборудования, материалов; после нарушения, которое привело или могло привести к травме, аварии, пожару или отравлению; по требованию надзорных органов; при выявлении новых опасностей при оценке рисков; после перерыва в работе более 60 календарных дней.\n5. **Целевой.** Перед разовыми работами, не связанными с прямыми обязанностями (например, разгрузка вагона или уборка территории), при ликвидации последствий аварий и при работах по наряду-допуску.\n\nПервичный, повторный, внеплановый и целевой инструктажи записываются в журнал регистрации инструктажа на рабочем месте, бумажный или электронный, с подписями инструктируемого и инструктирующего. Не подписывайте журнал, если инструктажа фактически не было.\n\n### Допуск к работе\n\nРаботник, не прошедший обучение, инструктаж и проверку знаний, **к работе не допускается**. Если после инструктажа знания не подтвердились, инструктаж проводят повторно. Очередное обучение и проверка знаний работников проходят не реже одного раза в год. Для управления погрузчиком и другой техникой нужен отдельный допуск: об этом в уроке про оборудование.\n\n### Спецодежда и СИЗ\n\n**Средства индивидуальной защиты (СИЗ)** защищают от конкретных рисков вашего участка. По внутреннему регламенту (демо) Jana Post на складе и в сортировке обязательны:\n- **защитная обувь** с жёстким подноском и нескользящей подошвой;\n- **сигнальный жилет** в зонах движения техники;\n- **перчатки** для работы с коробками, плёнкой и поддонами;\n- **каска** в зонах высотного хранения, если это указано в карте рисков участка;\n- **утеплённый комплект** для работы у открытых ворот и на рампе зимой.\n\nНосите СИЗ всю смену, а не только во время проверки. Повреждённые СИЗ меняйте через старшего смены. Не работайте в собственной обуви с открытым носком. Если средства защиты не выдали, это законное основание для отказа от работы.\n\n### Ситуация со смены\n\nАйгерим вышла в первую смену в сортировочный центр. Старший смены торопится: «Инструктаж потом, сейчас поток». Правильно вежливо напомнить, что без первичного инструктажа на рабочем месте к самостоятельной работе не допускают, и попросить провести его до начала работы. Это защищает и Айгерим, и старшего смены: если человек без инструктажа травмируется, отвечать придётся тем, кто допустил его к работе.'),
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012597
  -- источник: https://zakon.uchet.kz/rus/docs/V2100025800
  -- источник: https://www.hse.gov.uk/pubns/indg143.pdf
  ('safety', 2, 'Ручная переноска грузов: техника и предельные нормы', 'article', 6, null, null, null,
   E'### Почему это главный риск\n\nСотрудник склада или ПВЗ за смену поднимает сотни посылок. Один неудачный подъём редко заканчивается травмой, но тысячи подъёмов с круглой спиной и поворотом корпуса постепенно перегружают поясницу, плечи и колени. Проблемы со спиной часто начинаются именно так, незаметно. Техника подъёма и честное соблюдение норм заметно снижают этот риск.\n\n### Перед подъёмом: три вопроса\n\n1. **Нужно ли поднимать вручную?** Тележка, рольконтейнер, гидравлическая тележка или помощь коллеги почти всегда лучше.\n2. **Сколько весит груз?** Посмотрите вес на этикетке. Если его нет, наклоните коробку за угол и оцените вес. Проверьте, не смещается ли содержимое, нет ли острых краёв, мокрого или рвущегося картона.\n3. **Свободен ли путь?** Уберите препятствия, проверьте пол, заранее решите, куда поставите груз.\n\n### Техника безопасного подъёма\n\n1. Подойдите вплотную, стопы на ширине плеч, одна нога чуть впереди.\n2. **Присядьте, сгибая колени и бёдра.** Спина остаётся прямой, с естественным прогибом в пояснице. Не наклоняйтесь с прямыми ногами.\n3. Возьмите груз **двумя руками надёжным хватом**, лучше снизу или за ручки.\n4. Напрягите мышцы живота, поднимите голову.\n5. **Вставайте за счёт ног**, плавно, без рывка. Груз прижат к телу.\n6. **Не скручивайтесь с грузом.** Чтобы повернуться, переступите ногами и разверните весь корпус.\n7. Опускайте груз тем же движением: присесть, а не наклониться.\n\nЧем дальше груз от тела, тем сильнее нагрузка на поясницу. Самая удобная зона: примерно от уровня опущенных кистей до локтя. Поэтому тяжёлые места храните на средних полках, а на пол и выше плеч кладите лёгкие.\n\n### Командный подъём\n\nДлинные и тяжёлые места поднимайте вдвоём. Заранее договоритесь, кто командует; поднимайте и опускайте одновременно, по команде; идите в ногу. Партнёры по возможности должны быть примерно одного роста.\n\n### Предельные нормы для женщин в РК\n\nДействуют **предельные нормы подъёма и перемещения вручную тяжестей женщинами**: приложение 2 к приказу Министра здравоохранения и социального развития РК от 8 декабря 2015 года № 944 в редакции приказа Министра труда и социальной защиты населения РК от 10 декабря 2021 года № 464:\n- подъём и перемещение (разовое) тяжестей при чередовании с другой работой (до 2 раз в час): **не более 10 кг**;\n- подъём и перемещение (разовое) тяжестей постоянно в течение рабочей смены: **не более 7 кг**;\n- величина динамической работы за каждый час смены при перемещении груза на расстояние от 1 до 5 метров: **с рабочей поверхности не более 1750 кг·м, с пола не более 875 кг·м**.\n\nВ массу груза включается масса тары и упаковки. При перемещении грузов на тележках или в контейнерах прилагаемое усилие не должно превышать **10 кг**.\n\n**Как считать динамическую работу.** Масса груза умножается на расстояние. Посылка 5 кг, перенесённая со стола на полку в 3 метрах: 15 кг·м. За час с рабочей поверхности допускается не более 116 таких переносов (1750 : 15), с пола: не более 58 (875 : 15).\n\nДля работников моложе 18 лет тот же приказ устанавливает отдельные, ещё более строгие нормы.\n\n### А для мужчин?\n\nВ законодательстве РК нет предельной нормы ручного подъёма для взрослых мужчин: приказ № 944 касается только женщин и работников до 18 лет. Как ориентир можно использовать рекомендации британского регулятора по охране труда HSE: в идеальных условиях (груз у тела, между уровнем опущенных кистей и локтем, без поворота корпуса) до **25 кг**; у пола или выше плеч всего 5–10 кг, а на вытянутых руках ещё меньше. Это рекомендация, а не закон.\n\n**По внутреннему регламенту (демо) Jana Post** места тяжелее 20 кг один сотрудник вручную не поднимает: только вдвоём, на тележке или техникой. Такие места на приёмке маркируются наклейкой «Тяжёлый груз».\n\n### Ситуация со смены\n\nНочью пришла фура с коробками по 30 кг. Данияру предлагают «быстро раскидать руками», а Мадину просят помочь. Правильно: Данияр перевозит груз поддонами на гидравлической тележке, а отдельные коробки по 30 кг переносят только вдвоём. Мадина такие места не поднимает: для неё постоянный подъём ограничен 7 кг, поэтому она сканирует и маркирует посылки.'),
  -- видео: oEmbed https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=-0VTLYD232g&format=json; длительность 3:56 (YouTube Data API)
  ('safety', 3, 'Видео: как наклоняться и поднимать тяжести', 'video', 6, '-0VTLYD232g', 'Как наклоняться и поднимать тяжести, чтобы не сорвать спину', 'Anna Kolmakova',
   E'В этом ролике инструктор по йоге показывает, как наклоняться и поднимать тяжёлое, не перегружая поясницу. Примеры бытовые, но на складе работает та же механика, меняется только груз.\n\nСмотрите прежде всего на положение спины и таза: наклон идёт из тазобедренных суставов, а поясница не округляется.\n\nКлючевые выводы:\n- спина остаётся прямой, с естественным прогибом; круглая спина под нагрузкой опасна, особенно с тяжёлым грузом;\n- колени сгибаются, а встаёте вы за счёт ног и ягодичных мышц;\n- перед подъёмом напрягите мышцы живота;\n- опускайте груз тем же движением, что и поднимали.\n\nВ ролике не сказано о двух правилах, обязательных на складе: держите груз вплотную к телу и не поворачивайтесь с грузом, а переступайте ногами. И помните о предельных нормах из предыдущего урока.'),
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012665
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012597
  -- источник: https://prg.kz/m/amp/document/38910832/15/1880000
  ('safety', 4, 'Проверь себя: права, инструктажи и подъём грузов', 'practice', 6, null, null, null,
   E'Пять коротких вопросов по первым урокам: права и обязанности, инструктажи, СИЗ и подъём грузов. Ответ проверяется сразу, после него появится объяснение.'),
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012665
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012597
  ('safety', 5, 'Стеллажи, поддоны, тележки, погрузчик и конвейер', 'article', 5, null, null, null,
   E'### Движение по складу\n\nБольшинство столкновений с техникой происходит на перекрёстках и при выезде из рядов. Правила простые:\n- ходите только по **пешеходным дорожкам** и переходам; не срезайте путь между стеллажами и через зону погрузки;\n- перед перекрёстком и выездом из ряда остановитесь, посмотрите в обе стороны и **установите зрительный контакт с водителем**: если он вас не видит, вас для него нет;\n- не бегайте, не ходите с телефоном у уха и не читайте на ходу;\n- не стойте позади погрузчика: он часто едет задним ходом, а с грузом впереди обзор у водителя ограничен.\n\n**Разметка по внутреннему регламенту (демо) Jana Post:** зелёная обозначает пешеходные дорожки и переходы; жёлтая: границы проездов и мест хранения; красно-белая штриховка: зоны, где ничего нельзя ставить (перед воротами, электрощитами, огнетушителями, эвакуационными выходами). Не ставьте груз на линии разметки.\n\n### Стеллажи\n\n- На каждой секции есть табличка с **допустимой нагрузкой на ярус**: не превышайте её.\n- Тяжёлое вниз, лёгкое наверх; груз не должен свисать за край полки.\n- Не залезайте на стеллажи: используйте стремянку с площадкой и поручнем.\n- Вмятина или изгиб стойки, сорванный фиксатор балки: секцию не нагружать, сообщить старшему смены и огородить.\n- Не стойте под ярусом, куда погрузчик ставит поддон или откуда его снимает.\n\n### Поддоны\n\n- Перед загрузкой осмотрите поддон: сломанные доски и торчащие гвозди означают брак.\n- Груз укладывают с перевязкой и обматывают стрейч-плёнкой так, чтобы он не выходил за края поддона.\n- Пустые поддоны не ставьте на ребро и не оставляйте в проходах.\n- Не вставайте на поддон и не переносите его в одиночку: деревянный поддон весит около 20–25 кг.\n\n### Гидравлическая тележка\n\n- Перед сменой проверьте колёса, ручку и гидравлику: тележка должна удерживать груз поднятым.\n- Заводите вилы полностью под поддон, груз размещайте по центру, не превышайте грузоподъёмность с таблички.\n- Держите ноги подальше от колёс и вил, двигайтесь шагом, перед поворотом снижайте скорость.\n- Не катайтесь на тележке и не перевозите на ней людей.\n- После работы опустите вилы до пола и оставьте тележку вне проходов.\n- Для сотрудниц усилие при перемещении груза на тележке не должно превышать 10 кг (приказ № 944): тяжёлые поддоны перевозите электротележкой.\n\n### Погрузчик и штабелёр\n\nПо внутреннему регламенту (демо) управлять погрузчиком, электроштабелёром или электротележкой с местом оператора может **только работник, прошедший обучение и проверку знаний, имеющий удостоверение на право управления и допущенный к работе приказом**. Это продолжение общего правила: без обучения и проверки знаний к работе не допускают (Правила, приказ № 1019).\n- Ключи хранятся у старшего смены; оставлять ключ в замке нельзя.\n- Нельзя поднимать людей на вилах или на поддоне, перевозить пассажиров, ездить с высоко поднятым грузом.\n- Пешеходам: не проходите под поднятыми вилами и грузом, держите дистанцию и проходите мимо техники только после того, как водитель вас увидел.\n\n### Конвейер и сортировка\n\n- **Никаких наушников**, даже в одном ухе: вы должны слышать сигналы, предупреждения коллег и звук неисправности.\n- Свободная одежда заправлена, рукава застёгнуты, **длинные волосы собраны** под головной убор; без шарфов, цепочек, браслетов и колец.\n- Знайте, где ближайшая **кнопка аварийной остановки** или тросовый выключатель.\n- Не тянитесь к движущейся ленте и роликам и не снимайте застрявшую посылку на ходу: сначала остановка линии, затем устранение.\n- Не перелезайте через конвейер и не пролезайте под ним: только по переходным мостикам.\n- Не садитесь и не облокачивайтесь на ленту.\n\n### Ситуация со смены\n\nНа сортировке посылка застряла между роликами. Ербол тянется за ней, не останавливая линию: «Секунда, и всё». Правильно: нажать аварийную остановку, сообщить старшему смены и достать посылку на остановленной линии. Линию запускает старший смены, убедившись, что руки у всех убраны. Секунда у работающего конвейера может стоить пальцев.'),
  -- источник: https://zakon.uchet.kz/rus/docs/V2200026867
  -- источник: https://digitalbusiness.kz/2026-08-24/kak-pomoch-cheloveku-v-kazahstane-v-ekstrennoy-situatsii-nomera-i-prostaya-instruktsiya/
  -- источник: https://www.mos.ru/news/item/149797073/
  ('safety', 6, 'Пожарная безопасность и электробезопасность', 'article', 5, null, null, null,
   E'### Почему склад загорается быстро\n\nКартон, плёнка, наполнитель и плотное хранение: на складе много горючего материала. Небольшое возгорание за несколько минут может перерасти в пожар, а главную опасность для людей создаёт дым. Поэтому важно не допускать возгорания и знать, как действовать в первые минуты.\n\n### Что запрещено\n\n**Правила пожарной безопасности** (приказ Министра по чрезвычайным ситуациям РК от 21 февраля 2022 года № 55) запрещают, в частности:\n- загромождать двери, эвакуационные пути и выходы, проходы к огнетушителям и пожарным кранам;\n- курить вне специально отведённых мест: такое место оборудуется огнетушителем, негорючей урной и знаком «Место для курения»;\n- пользоваться неисправными электроприборами, которые могут привести к пожару;\n- хранить горючие материалы рядом с электрощитами, электродвигателями и пусковой аппаратурой.\n\nВ конце смены электроустановки и приборы обесточивают, кроме дежурного освещения, систем пожаротушения и пожарной сигнализации. Номера **101** (противопожарная служба) и **112** (единая дежурно-диспетчерская служба) вывешиваются там, где находится дежурный персонал, а план эвакуации: на каждом этаже.\n\n### Если начался пожар\n\n1. Крикните «Пожар!» и нажмите ближайший ручной пожарный извещатель.\n2. Позвоните **101** или **112**: назовите адрес, что горит и есть ли в здании люди.\n3. Сообщите старшему смены.\n4. Если очаг небольшой и выход у вас за спиной, попробуйте потушить его огнетушителем.\n5. Если огонь не удалось сбить сразу или дым мешает дышать, **уходите**.\n6. Эвакуируйтесь по плану, не пользуйтесь лифтом, закрывайте за собой двери. В дыму двигайтесь пригнувшись, закрыв нос и рот тканью.\n7. Идите к месту сбора и не возвращайтесь за вещами: старший смены проверяет, все ли вышли.\n\n### Огнетушители\n\n- **Порошковый (ОП):** универсальный, тушит твёрдые материалы, жидкости, газы и электрооборудование под напряжением в пределах, указанных на корпусе. Образует облако порошка, которое ухудшает видимость.\n- **Углекислотный (ОУ):** подходит для электрооборудования и электроники, не оставляет следов. Раструб сильно охлаждается: **не держитесь за него рукой**.\n- **Воздушно-пенный (ОВП):** тушит твёрдые материалы и жидкости; **нельзя** применять на электрооборудовании под напряжением; работает при плюсовой температуре.\n\nПеред применением посмотрите на манометр: стрелка должна быть в зелёной зоне.\n\n### Правило PASS\n\nПо-английски Pull, Aim, Squeeze, Sweep; по-русски: **выдерни, направь, нажми, води**.\n1. **Выдерни** чеку, сорвав пломбу.\n2. **Направь** шланг или раструб на основание пламени, а не на дым и языки огня.\n3. **Нажми** на рычаг.\n4. **Води** струёй из стороны в сторону, от края очага к центру.\n\nВстаньте так, чтобы ветер или тяга были у вас за спиной, на безопасном расстоянии, указанном на корпусе огнетушителя.\n\n### Электробезопасность\n\n- Не трогайте оголённые провода, искрящие розетки и повреждённые кабели: огородите место и сообщите старшему смены.\n- Не ремонтируйте электрооборудование сами: это делает только электротехнический персонал с допуском.\n- Не подключайте удлинители «гирляндой», самодельные переноски и личные обогреватели.\n- Не трогайте электроприборы мокрыми руками и не ставьте напитки на зарядные станции ТСД.\n- Если человека ударило током, не касайтесь его голыми руками: сначала обесточьте линию выключателем или автоматом либо отодвиньте провод сухой деревянной палкой, затем вызывайте **103** или **112**.\n\n### Ситуация со смены\n\nВ ПВЗ задымилась коробка, стоявшая вплотную к обогревателю под стойкой. Асель отключает обогреватель от сети, просит коллегу вывести посетителей, берёт порошковый огнетушитель и тушит очаг по правилу PASS. Затем сообщает руководителю, а обогреватель больше не используют. Если бы огонь перекинулся на стеллаж, правильным решением были бы эвакуация и звонок 101.'),
  -- видео: oEmbed https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=_5h55KQLMJ4&format=json; длительность 4:28 (YouTube Data API)
  ('safety', 7, 'Видео: как пользоваться огнетушителем', 'video', 7, '_5h55KQLMJ4', 'Советы профессионала. Как пользоваться огнетушителем?', 'Газпром добыча Надым',
   E'В выпуске рубрики «Советы профессионала» объясняют, где обычно хранятся огнетушители, чем порошковый отличается от углекислотного и как привести огнетушитель в действие. В конце ролика показано тушение модельного очага.\n\nОбратите внимание, как проверяют исправность по манометру и с какой стороны от огня встаёт человек. Ролик снят в России, но устройство огнетушителей и порядок действий те же; в Казахстане звоните 101 или 112.\n\nКлючевые выводы:\n- огнетушители обычно находятся в пожарных шкафах рядом с пожарным краном, отсеки подписаны;\n- у порошкового огнетушителя есть шланг и манометр, у углекислотного: раструб;\n- стрелка манометра в зелёной зоне означает, что огнетушитель исправен; в красной или жёлтой: использовать нельзя, сообщите старшему смены;\n- вставайте с наветренной стороны на безопасном расстоянии;\n- с углекислотным огнетушителем работайте в перчатках и не беритесь за раструб.'),
  -- источник: https://zakon.uchet.kz/rus/docs/V2000021464
  -- источник: https://mchs.gov.ru/deyatelnost/bezopasnost-grazhdan/silnoe-krovotechenie_7
  -- источник: https://mchs.gov.ru/deyatelnost/bezopasnost-grazhdan/termicheskiy-ozhog_2
  -- источник: https://prg.kz/m/amp/document/38910832/15/1880000
  -- источник: https://prg.kz/m/amp/document/38910832/16/1890000
  ('safety', 8, 'Первая помощь и несчастный случай на производстве', 'article', 5, null, null, null,
   E'### Общий порядок действий\n\n1. **Безопасность.** Убедитесь, что опасность устранена: техника остановлена, ток отключён, огня нет. Пострадавших не должно стать двое.\n2. **Оценка.** Окликните человека, проверьте, в сознании ли он и нормально ли дышит.\n3. **Вызов помощи.** Звоните **103** (скорая) или **112** и сообщите старшему смены. Назовите адрес, что случилось, сколько пострадавших и в каком они состоянии.\n4. **Первая помощь** в пределах ваших навыков до приезда медиков.\n5. **Наблюдение.** Оставайтесь рядом, следите за дыханием, успокаивайте.\n\nПервую помощь оказывает сам пострадавший или любой человек рядом до прибытия медицинских работников (Правила обучения навыкам первой помощи, приказ Министра здравоохранения РК от 19 октября 2020 года № ҚР ДСМ-138/2020). По внутреннему регламенту (демо) аптечка есть у поста старшего смены и в каждом ПВЗ.\n\n### Кровотечение\n\n- Наденьте перчатки из аптечки.\n- **Прижмите рану** салфеткой или бинтом с силой, достаточной для остановки кровотечения.\n- Наложите **давящую повязку**. Если она промокла, наложите ещё одну поверх, не снимая первую.\n- **Жгут** накладывают только на конечность и только если кровь не останавливается давлением и давящей повязкой: на 5–7 см выше раны, поверх одежды или ткани. Обязательно запишите время наложения.\n\n### Ушиб, растяжение, подозрение на перелом\n\nПризнаки перелома: сильная боль, отёк, деформация, неестественная подвижность, невозможность опереться на конечность.\n- Не вправляйте и не тяните конечность, не заставляйте человека двигаться.\n- Обездвижьте её в том положении, в котором она находится: шина, свёрнутый картон, прибинтованная к телу рука.\n- Приложите холод через ткань.\n- Если человек упал с высоты или его задел погрузчик, возможна травма позвоночника: не перемещайте его без крайней необходимости.\n\n### Ожог\n\n- Прекратите действие источника: отключите прибор, погасите одежду.\n- **Охлаждайте** обожжённое место прохладной водой не менее 20 минут.\n- Не вскрывайте пузыри, не мажьте маслом, жиром или мазью, не отрывайте прилипшую одежду.\n- Накройте ожог чистой сухой тканью. При большом ожоге, ожоге лица или кистей, химическом или электрическом ожоге вызывайте **103**.\n\n### Обморок\n\n- Уложите человека на спину, приподнимите ноги, расстегните тесную одежду, обеспечьте приток воздуха.\n- Если он быстро не приходит в себя или дышит ненормально, вызывайте **103** или **112** и следуйте указаниям диспетчера.\n- Если он без сознания, но дышит нормально, переверните его в устойчивое боковое положение.\n- После обморока не возвращайтесь к работе на высоте или с техникой, пока вас не осмотрит медик.\n\n### Несчастный случай: что говорит ТК РК\n\n- **Работник** обязан немедленно сообщить работодателю или организатору работ о каждой производственной травме (ст. 181).\n- **Работодатель** до начала расследования **сохраняет обстановку на месте происшествия** такой, какой она была в момент случая, если это не угрожает людям, и фотографирует её; немедленно, в течение суток, сообщает о несчастном случае в территориальное подразделение уполномоченного органа по труду; извещает родственников пострадавшего и страховщика (ст. 187).\n- Расследование проводит комиссия; срок не должен превышать **10 рабочих дней** со дня её создания, продлить его можно решением комиссии (ст. 189).\n\n### Что делаете вы как очевидец\n\n1. Помогите пострадавшему и вызовите помощь.\n2. Сообщите старшему смены.\n3. **Не меняйте обстановку**: не убирайте коробки, не двигайте технику, не вытирайте пол. Если что-то пришлось изменить ради спасения, запомните это и расскажите комиссии.\n4. Дайте комиссии честные объяснения.\n\n### Ситуация со смены\n\nНурлан порезал ладонь ножом для вскрытия коробок и говорит: «Ерунда, не надо никому сообщать». Правильно остановить кровь давящей повязкой и сообщить старшему смены. Даже небольшой порез может воспалиться, а без фиксации случая Нурлану будет сложнее получить положенные при производственной травме выплаты.'),
  -- источник: https://prg.kz/m/amp/document/38910832/8/760000
  -- источник: https://prg.kz/m/amp/document/38910832/9/1100000
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012597
  ('safety', 9, 'Ночные смены, усталость и безопасность в ПВЗ', 'article', 5, null, null, null,
   E'### Ночная работа по ТК РК\n\n- **Ночное время**: с 22:00 до 6:00 (ст. 76).\n- К ночной работе **не допускаются** работники моложе 18 лет и беременные женщины, представившие работодателю справку о беременности.\n- Только **с письменного согласия** привлекаются: работники с инвалидностью (если работа не запрещена им по медицинскому заключению), женщины с детьми до семи лет и другие лица, воспитывающие детей до семи лет без матери, а также работники, воспитывающие детей с инвалидностью до 18 лет.\n- Работать **две смены подряд запрещено** (ст. 73), кроме исключительных случаев, предусмотренных Кодексом.\n- **Междусменный отдых** не может быть меньше 12 часов (ст. 83).\n- Каждый час ночной работы оплачивается в повышенном размере, **не ниже полуторного** от дневной ставки (ст. 110).\n\n### Усталость: как её заметить\n\nНочью организм по своим биологическим часам ждёт сна, и тяжелее всего обычно даются предрассветные часы. Признаки опасной усталости: вы перечитываете одно и то же, путаете ячейки, зеваете, на секунды «проваливаетесь», раздражаетесь по мелочам. Реакция в таком состоянии замедляется, и ошибка у конвейера или рядом с погрузчиком становится опасной.\n\n### Как работать ночью безопаснее\n\n- **Высыпайтесь днём**: тёмная, тихая и прохладная комната, телефон без звука. Перед первой ночной сменой полезен дневной сон.\n- **Пейте воду и ешьте легко**: плотная еда ночью усиливает сонливость.\n- **Кофеин** лучше в первой половине смены, иначе после смены будет трудно уснуть.\n- **Используйте перерывы**: пройдитесь, разомнитесь, побудьте при ярком свете.\n- **Не садитесь за руль сонным** после ночной смены: воспользуйтесь такси или общественным транспортом.\n- **Скажите старшему смены**, если засыпаете: по внутреннему регламенту (демо) вас временно переведут на участок без техники и конвейера.\n\n### ПВЗ: подъём посылок и рабочее место\n\n- Тяжёлые посылки храните на нижних и средних полках, лёгкие наверху.\n- К верхним полкам поднимайтесь по стремянке, а не по стулу или коробкам.\n- Поднимайте посылки по технике из урока о переноске грузов; для сотрудниц действуют предельные нормы РК.\n- Тяжёлую посылку не передавайте через стойку на вытянутых руках: вынесите её на тележке или поставьте на низкий стол выдачи.\n- Проходы и выход из ПВЗ всегда свободны: коробки не ставят у двери и в проходе к огнетушителю.\n- Упаковку вскрывайте ножом с убирающимся лезвием, движением от себя.\n- Пролитую воду и мокрые следы зимой вытирайте сразу или ставьте табличку «Осторожно, скользко».\n\n### Конфликтный посетитель\n\nБольшинство конфликтов на ПВЗ начинается с задержки или отказа в выдаче. Ваша задача: снизить накал и сохранить свою безопасность.\n- Держите дистанцию: стойка остаётся между вами и посетителем.\n- Говорите спокойно и медленно, признайте эмоцию: «Понимаю, вы долго ждали». Объясните, что вы можете сделать прямо сейчас.\n- Не спорьте, не повышайте голос, не прикасайтесь к посетителю и не преследуйте его.\n- При угрозах, агрессии или порче имущества нажмите **тревожную кнопку** (по внутреннему регламенту (демо) она есть в каждом ПВЗ) или звоните **102** или **112**, затем сообщите руководителю.\n- Ваша безопасность важнее посылки: не удерживайте её силой.\n\n### Ситуация со смены\n\nПод утро Ирина дважды положила посылку не в ту ячейку и поймала себя на том, что задремала у сортировочного стола. Правильно сказать об этом старшему смены, сделать перерыв, выпить воды и пройтись. Старший смены временно переводит её на маркировку посылок, подальше от конвейера.'),
  -- источник: https://www.mos.ru/news/item/149797073/
  -- источник: https://mchs.gov.ru/deyatelnost/bezopasnost-grazhdan/silnoe-krovotechenie_7
  -- источник: https://prg.kz/m/amp/document/38910832/16/1890000
  -- источник: https://prg.kz/m/amp/document/38910832/8/760000
  ('safety', 10, 'Проверь себя: техника, пожар, первая помощь и смены', 'practice', 6, null, null, null,
   E'Проверьте, что запомнили из уроков о технике и конвейере, пожарной безопасности, первой помощи и ночных сменах. Пять вопросов, ответ проверяется сразу.'),
  -- источник: https://zakon.uchet.kz/rus/docs/Z1300000094
  -- источник: https://informburo.kz/novosti/zapret-na-sbor-kopii-udostovereniya-licnosti-kak-budut-nakazyvat-narusitelei
  -- источник: https://digitalbusiness.kz/2025-03-11/uznali-kakimi-budut-shtrafi-za-narushenie-zashchiti-personalnih-dannih/
  ('infosec', 1, 'Персональные данные: что говорит закон', 'article', 5, null, null, null,
   E'### Почему это касается каждого\n\nЧерез Jana Post каждый день проходят данные множества людей: имена, телефоны, адреса, ИИН, сведения о покупках. Клиент доверяет нам не только посылку, но и информацию о себе. Утечка одного списка может обернуться мошенническими звонками, кражей посылок и потерей доверия к компании.\n\n### Основные понятия\n\nГлавный документ: **Закон РК «О персональных данных и их защите» от 21 мая 2013 года № 94-V**.\n- **Персональные данные**: сведения или совокупность сведений о субъекте персональных данных, то есть о конкретном человеке. Это ФИО, ИИН, телефон, адрес, данные удостоверения, фото, сведения о заказах.\n- **Субъект персональных данных**: физическое лицо, к которому относятся данные: клиент, получатель, сотрудник.\n- **Собственник** и **оператор**: государственный орган, физическое или юридическое лицо, которое владеет базой с персональными данными либо собирает, обрабатывает и защищает их. Для данных клиентов это компания, а вы действуете от её имени.\n- **Обработка**: любые действия с данными: накопление, хранение, изменение, использование, распространение, обезличивание, блокирование, уничтожение.\n- **Распространение**: действия, в результате которых данные передаются другим лицам, в том числе через СМИ или путём предоставления доступа.\n- Данные бывают **общедоступными** (доступ к ним свободный с согласия человека) и **ограниченного доступа** (ст. 6). Почти всё, что вы видите в системах Jana Post, относится ко второй группе.\n\n### Принципы обработки (ст. 5)\n\nСбор, обработка и защита персональных данных осуществляются в соответствии с принципами:\n1. соблюдения конституционных прав и свобод человека и гражданина;\n2. законности;\n3. конфиденциальности персональных данных ограниченного доступа;\n4. равенства прав субъектов, собственников и операторов;\n5. обеспечения безопасности личности, общества и государства.\n\n### Согласие и цели (ст. 7, 8)\n\n- По общему правилу сбор и обработка данных требуют **согласия субъекта**, кроме случаев, прямо указанных в законе.\n- Данные обрабатываются только для **заранее определённых законных целей**. Собирать лишнее, не нужное для цели, нельзя.\n- Согласие дают письменно, через электронный сервис или другим способом, который позволяет подтвердить его получение. Человек вправе **отозвать согласие**, кроме случаев, установленных законом.\n- **Запрещено собирать и обрабатывать бумажные копии удостоверений личности**, кроме случаев, перечисленных в законе. На практике это значит: на ПВЗ мы не делаем ксерокопий и фото удостоверений клиентов.\n\n### Конфиденциальность и защита (ст. 11, 22, 25)\n\nТот, кто получил доступ к данным ограниченного доступа в силу служебных или трудовых обязанностей, обязан **хранить их конфиденциальность** и не раскрывать без согласия человека или иного законного основания. Компания обязана принимать меры, которые предотвращают несанкционированный доступ, своевременно его выявляют и уменьшают последствия. О нарушении безопасности персональных данных компания обязана уведомить уполномоченный орган, поэтому любой инцидент важно сообщать сразу.\n\n### Права человека (ст. 24)\n\nКаждый вправе знать, есть ли у компании его данные и как они обрабатываются, требовать их исправления, блокирования или уничтожения при нарушениях, отозвать согласие и требовать возмещения вреда.\n\n### Ответственность\n\nНарушение законодательства о персональных данных влечёт **административную ответственность по статье 79 КоАП РК** «Нарушение законодательства Республики Казахстан о персональных данных и их защите»; с 13 марта 2025 года штрафы по этой статье увеличены. Если в действиях есть признаки преступления, наступает уголовная ответственность. Для сотрудника разглашение данных клиентов также является дисциплинарным нарушением по внутреннему регламенту (демо).\n\n### Ситуация со смены\n\nКурьер Арман хочет сохранить номер постоянной клиентки в личном телефоне, «чтобы было удобнее договариваться». Это нарушение: номер передан компании для доставки, а не для личной переписки. Правильно связываться с клиентами только через служебное приложение.'),
  -- источник: https://zakon.uchet.kz/rus/docs/Z1300000094
  ('infosec', 2, 'Персональные данные в работе склада, курьера и ПВЗ', 'article', 5, null, null, null,
   E'### Что вы видите каждый день\n\n- **ФИО, телефон и адрес** получателя и отправителя: в накладной, на этикетке, в ТСД и в приложении.\n- **ИИН**: например, если он нужен для таможенного оформления международного отправления.\n- **Содержимое посылки**: описание вложения в декларации, а иногда и сам товар. Покупки многое говорят о человеке: о здоровье, привычках, доходе, семье.\n- **Код получения**, подпись, фото при выдаче.\n- **Данные коллег**: телефоны, графики, табельные номера, сведения о больничных.\n\nВсё это персональные данные ограниченного доступа. Вы видите их, потому что они нужны для работы, и использовать их можно только для неё.\n\n### Правила работы с данными (по внутреннему регламенту (демо) Jana Post)\n\n1. **Только по делу.** Открывайте карточку того клиента, с чьей посылкой работаете сейчас. Каждое открытие фиксируется в журнале системы.\n2. **Не копируйте.** Не фотографируйте экраны, накладные и удостоверения, не переписывайте данные в личные заметки, не пересылайте их в личные мессенджеры.\n3. **Не обсуждайте.** Не рассказывайте, кто что заказал, не шутите о содержимом посылок, не называйте адрес и телефон получателя посторонним, даже соседям и родственникам.\n4. **Только служебные каналы.** С клиентом связывайтесь через служебное приложение или служебный телефон.\n5. **Бумага тоже содержит данные.** Испорченные этикетки, распечатки и реестры отправляйте в шредер или контейнер для конфиденциальных отходов, а не в обычную урну. С коробок возвратов перед утилизацией снимайте этикетки.\n6. **Удостоверение смотрим, но не копируем.** Проверяйте документ или цифровой документ в официальном приложении визуально. Копии не делаем: закон запрещает собирать бумажные копии удостоверений, кроме отдельных случаев.\n7. **Запросы о данных** от «полиции», «налоговой», «юриста» или «родственника» не обрабатывайте сами. Официальные запросы направляются компании письменно; передайте такого человека руководителю.\n8. **Минимум на экране.** Разверните монитор так, чтобы посетитель не видел данных других клиентов, и не оставляйте списки на стойке.\n\n### Почему мелочей не бывает\n\nФото накладной в общем чате смены кажется безобидным. Но на нём ФИО, телефон и адрес человека. Чат могут переслать, телефон коллеги могут украсть, а мошенник, зная имя и номер посылки, звонит клиенту «из службы доставки» и выманивает код получения. Многие утечки начинаются именно с таких мелочей.\n\n### Содержимое посылки\n\nСведения о вложении видят сотрудники приёмки, таможенного оформления и выдачи. Не вскрывайте посылки вне установленной процедуры, не обсуждайте содержимое с коллегами и посетителями и не комментируйте покупки клиента при выдаче. Для человека, который заказал лекарства или подарок близким, это особенно важно.\n\n### Курьер на маршруте\n\nПо внутреннему регламенту (демо) у курьера свои правила:\n- маршрутный лист и накладные не оставляйте на сиденье или приборной панели, где их видно через стекло; после смены сдайте или уничтожьте распечатки;\n- фото подтверждения доставки снимайте так, чтобы в кадре была посылка, а не лицо клиента, номер квартиры или содержимое прихожей;\n- не называйте имя получателя и содержимое посылки соседям, консьержу или охране; если получателя нет дома, оставьте уведомление через приложение;\n- код получения клиент называет вам сам, вслух его не повторяйте;\n- не сохраняйте номера клиентов в личной телефонной книге и не пишите им с личного номера.\n\n### Ситуация со смены\n\nВ ПВЗ заходит женщина: «Мой муж на прошлой неделе получал у вас посылку? Что там было?» Хочется помочь, но правильный ответ: «Извините, мы не сообщаем сведения о посылках других людей. Ваш муж может посмотреть историю заказов в своём приложении». Неважно, кем человек приходится получателю: родство не даёт права на чужие данные.'),
  -- источник: https://pages.nist.gov/800-63-4/sp800-63b.html
  ('infosec', 3, 'Пароли, парольные фразы и двухфакторная аутентификация', 'article', 5, null, null, null,
   E'### Пароль: ключ от данных клиентов\n\nПод вашей учётной записью в JanaMen, ТСД и почте видны данные клиентов и коллег. Если пароль узнает посторонний, он будет действовать от вашего имени, и в журналах системы это будете вы.\n\n### Каким должен быть пароль\n\nСовременный подход отражён в американском стандарте цифровой идентификации NIST SP 800-63B (редакция 4):\n- **длина важнее сложности**: если пароль единственный способ входа, он должен быть не короче 15 символов; при двухфакторной аутентификации допускается не короче 8;\n- системам рекомендуется принимать длинные пароли, не менее 64 символов, и запрещено навязывать правила вида «заглавная буква, цифра и спецсимвол»;\n- менять пароль **по расписанию не нужно**: менять его нужно сразу при признаках компрометации;\n- пароль сверяют со списками утёкших и слишком простых паролей.\n\n### Парольная фраза\n\nПроще всего запомнить длинную **парольную фразу** из 4–5 случайных слов, не связанных с вами. Например: «ПятьЖёлтыхКоробокЕдутВАктобе» (этот пример уже опубликован, не используйте его). Плохие пароли: имя, дата рождения, номер телефона, «Qwerty123», «JanaPost2026», слова с заменой букв на похожие цифры.\n\n### Один сервис: один пароль\n\nМошенники скупают базы утёкших паролей и автоматически пробуют их на других сайтах. Если пароль от интернет-магазина совпадает с рабочим, утечка магазина откроет доступ к данным клиентов Jana Post. Поэтому **рабочие пароли нигде не повторяются**.\n\n### Менеджер паролей\n\nЗапомнить десятки уникальных паролей невозможно, поэтому используйте **менеджер паролей**:\n- он хранит пароли в зашифрованном виде и генерирует новые;\n- подставляет пароль только на настоящем сайте, а это дополнительная защита от фишинга;\n- вам нужно помнить один длинный мастер-пароль, а сам менеджер защищают вторым фактором.\n\nПо внутреннему регламенту (демо) используйте только менеджер, утверждённый IT. Нельзя хранить пароли на стикерах, в заметках телефона, в таблицах и в браузере общего компьютера ПВЗ.\n\n### Двухфакторная аутентификация (2FA)\n\n2FA требует два разных доказательства: то, что вы **знаете** (пароль, PIN), и то, что у вас **есть** (телефон, аппаратный ключ), или то, что вам **присуще** (отпечаток пальца, лицо). Украденного пароля без второго фактора злоумышленнику мало.\n- **SMS-код** лучше, чем ничего, но его можно перехватить или выманить.\n- **Код из приложения-аутентификатора** и **push-подтверждение** надёжнее.\n- **Аппаратный ключ** лучше всего защищает от фишинга.\n\nВключите 2FA на рабочей почте, в JanaMen, банке, eGov и мессенджерах.\n\n### Два железных правила\n\n1. **Никому не сообщайте пароль и одноразовый код**: ни коллеге, ни руководителю, ни «службе поддержки». По внутреннему регламенту (демо) IT Jana Post никогда не спрашивает ваш пароль или код.\n2. **Не подтверждайте вход, который вы не начинали.** Если пришёл неожиданный запрос на подтверждение, отклоните его, смените пароль и сообщите в IT.\n\n### Признаки того, что пароль уже известен посторонним\n\n- приходят уведомления о входе с незнакомого устройства или из другого города;\n- в почте есть отправленные письма, которых вы не писали, а коллеги спрашивают о странных сообщениях от вас;\n- пароль внезапно перестал подходить;\n- сервис сообщает об утечке базы, где был ваш адрес.\n\nВ любом из этих случаев сразу смените пароль с другого, надёжного устройства, проверьте, где ещё он использовался, и сообщите в IT. Не ждите, пока проблема подтвердится сама: каждая минута даёт злоумышленнику время.\n\n### Ситуация со смены\n\nКоллега по смене просит ваш логин от ТСД: его учётную запись заблокировали, а поток идёт. Правильно отказать и помочь иначе: вместе позвонить в поддержку IT, чтобы учётную запись разблокировали. Если под вашей учётной записью посылку выдадут не тому человеку, отвечать будете вы.'),
  -- видео: oEmbed https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=2Whes_8_T5Y&format=json; длительность 3:49 (YouTube Data API)
  ('infosec', 4, 'Видео: сильные пароли и где их хранить', 'video', 6, '2Whes_8_T5Y', 'Как создавать сильные пароли и где их хранить', 'Kaspersky Russia',
   E'Короткий ролик «Лаборатории Касперского» о том, как придумать сильный пароль и где его безопасно хранить. Обратите внимание на роль мастер-пароля: от него зависит защита всех остальных паролей.\n\nВ ролике рекламируется менеджер паролей этой компании. В Jana Post используйте только менеджер, утверждённый IT (внутренний регламент, демо): принцип работы у таких программ одинаковый.\n\nКлючевые выводы:\n- мастер-пароль от менеджера паролей: самый важный, он должен быть длинным и уникальным;\n- простые последовательности вроде «12345» бессмысленны, даже если в них добавлены буквы;\n- менеджер паролей подсказывает, какие пароли слабые или повторяются;\n- пароли стоит регулярно проверять по базам утечек и сразу менять скомпрометированные.'),
  -- источник: https://zakon.uchet.kz/rus/docs/Z1300000094
  ('infosec', 5, 'Проверь себя: персональные данные и пароли', 'practice', 6, null, null, null,
   E'Пять вопросов по урокам о персональных данных и паролях. Ответ проверяется сразу, после него появится объяснение.'),
  ('infosec', 6, 'Фишинг: почта, SMS, мессенджеры и звонки', 'article', 4, null, null, null,
   E'### Что такое фишинг\n\n**Фишинг**: мошенничество, при котором злоумышленник выдаёт себя за знакомую организацию или человека, чтобы выманить пароль, код из SMS, данные карты или заставить открыть вредоносный файл. Мошенники используют любые каналы:\n- **электронная почта**: письма «от IT», «от банка», «от HR» со ссылкой или вложением;\n- **SMS**: «посылка задержана», «оплатите доставку», «вам начислен бонус»;\n- **мессенджеры**: сообщения от «коллеги» или «руководителя» с нового номера, поддельные чат-боты, взломанные аккаунты знакомых;\n- **звонки**: «служба безопасности банка», «служба поддержки», «полиция», «головной офис».\n\n### Признаки фишинга\n\n1. **Срочность и давление**: «через час аккаунт заблокируют», «операцию нужно отменить прямо сейчас».\n2. **Просьба** ввести пароль, назвать код из SMS или данные карты, установить приложение или дать удалённый доступ.\n3. **Чужой адрес**: домен отправителя или ссылки похож на настоящий, но отличается лишним словом, дефисом, цифрой 0 вместо буквы o или другой доменной зоной. Найдите в ссылке первую одиночную косую черту после «https://» и прочитайте адрес перед ней справа налево.\n4. **Обезличенное обращение**, ошибки, непривычный тон.\n5. **Неожиданное вложение**: архив, файл .exe или .html, документ, который просит «включить содержимое».\n6. **Просьба нарушить процедуру**: «оплатите в обход», «никому не говорите».\n\n### Разбор 1: письмо «от IT»\n\nТема: «Ваш почтовый ящик будет заблокирован через 2 часа». Отправитель: «IT Jana Post», адрес на внешнем домене вида janapost-it-support.com. Кнопка «Подтвердить учётную запись» ведёт на страницу входа, похожую на корпоративную.\n\nПризнаки: срочность, внешний домен, просьба ввести пароль. **Правильно**: не переходить по ссылке и сообщить в IT установленным способом (по внутреннему регламенту (демо) через кнопку «Сообщить о фишинге» в почте). Если пароль уже введён, сразу смените его и сообщите в IT.\n\n### Разбор 2: SMS «о посылке»\n\n«Jana Post: ваша посылка задержана на таможне. Оплатите сбор 690 тг: jana-dostavka.top/pay». Такие сообщения получают и сотрудники, и клиенты.\n\nПризнаки: неожиданное требование оплаты, небольшая сумма, которая усыпляет бдительность, посторонний домен. **Правильно**: проверять статус и оплату только в официальном приложении или личном кабинете. Если клиент на ПВЗ спрашивает про такое SMS, объясните, что по внутреннему регламенту (демо) компания не присылает ссылок на оплату с посторонних сайтов, и предложите проверить посылку в приложении.\n\n### Разбор 3: звонок «из банка»\n\n«Здравствуйте, служба безопасности банка. С вашей карты пытаются перевести 250 000 тенге. Чтобы отменить операцию, назовите код из SMS». Вариант на работе: «Это IT головного офиса, мы обновляем ТСД, продиктуйте код, который сейчас придёт».\n\nПризнаки: звонок неожиданный, собеседник давит и пугает, просит код. Знание вашего имени или последних цифр карты ничего не доказывает: такие данные часто есть в утечках. **Правильно**: положить трубку и перезвонить в банк по номеру с обратной стороны карты или из официального приложения, а в рабочем случае позвонить в IT по известному внутреннему номеру.\n\n### Если вы уже нажали\n\n- Ввели пароль: смените его сразу и везде, где он повторялся.\n- Ввели данные карты: позвоните в банк и заблокируйте карту.\n- Открыли вложение: отключите компьютер от сети, но не выключайте его.\n- В любом случае сообщите в IT и руководителю. Быстрое сообщение важнее неловкости.'),
  -- видео: oEmbed https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=GNWIPpGu52M&format=json; длительность 8:35 (YouTube Data API)
  ('infosec', 7, 'Видео: фишинг и социальная инженерия', 'video', 11, 'GNWIPpGu52M', 'Видеолекция: фишинг и социальная инженерия как отмычки современных мошенников', 'Eesti Rahvusringhääling',
   E'Лекция по медиаграмотности от Эстонской общественной телерадиовещательной корпорации (ERR) на русском языке. Лектор разбирает, как фишинг сочетается с социальной инженерией: обещания подарков, угрозы блокировкой, звонки и сообщения в мессенджерах.\n\nВ конце лекции есть примеры для самостоятельного разбора. Остановите видео и попробуйте сами найти признаки обмана, прежде чем услышите ответ.\n\nКлючевые выводы:\n- мошенники выманивают логины, пароли и банковские данные через поддельные страницы;\n- приманка (подарок, выгода) и угроза (блокировка, штраф) рассчитаны на то, что вы не успеете подумать;\n- атака может прийти по любому каналу: почта, SMS, звонок, мессенджер, соцсети;\n- признаки: обезличенное обращение, нет имени отправителя, ошибки, машинный перевод;\n- защита: пауза, проверка через независимый источник и связь с отправителем по другому каналу.'),
  ('infosec', 8, 'Социальная инженерия на складе и в ПВЗ', 'article', 5, null, null, null,
   E'### Что это такое\n\n**Социальная инженерия**: манипуляция людьми, чтобы получить доступ к данным, посылкам или помещениям. Взламывают не систему, а доверие. Мошенник играет на нормальных человеческих качествах:\n- **уважении к авторитету**: «я из головного офиса», «я из полиции»;\n- **желании помочь**: «брат в больнице, выдайте посылку мне»;\n- **спешке**: «машина ждёт, давайте быстрее»;\n- **страхе**: «не выдадите, напишу жалобу, и вас уволят»;\n- **вежливости**: придержать дверь человеку с коробками.\n\n### Типичные сценарии в логистике\n\n1. **«Выдайте посылку брата»**: показывают фото удостоверения на телефоне, скриншот кода или говорят, что получатель «разрешил по телефону».\n2. **«Проверяющий»**: человек в фирменном жилете или с бейджем просит пустить в зону хранения, показать базу или дать ТСД «на минутку».\n3. **Звонок в ПВЗ**: «Это получатель, продиктуйте, какой адрес указан и что в посылке, я забыл».\n4. **«Подрядчик»**: «Я из сервиса, нужно обновить кассу, дайте доступ к компьютеру».\n5. **Проход «на хвосте»**: посторонний заходит на склад следом за вами через дверь с пропуском.\n6. **«Подарок»**: флешка «с прайсом» или зарядный кабель, оставленные у стойки.\n\n### Правила выдачи посылок (по внутреннему регламенту (демо))\n\n- Посылку выдают **получателю** по коду получения и документу, удостоверяющему личность: оригиналу или цифровому документу в официальном приложении.\n- Другому человеку посылку выдают только **по доверенности** или если получатель сам оформил передачу посылки в приложении.\n- Фото удостоверения в чужом телефоне, скриншоты, устная просьба и звонок «от получателя» основанием для выдачи не являются.\n- Сомневаетесь: не выдавайте и позовите старшего смены.\n- По телефону не называйте содержимое посылки, адрес и телефон получателя.\n\n### Как вежливо отказать\n\nОтказ звучит спокойно, если вы объясняете правило и предлагаете выход:\n«Понимаю, вы хотите помочь брату. По правилам я могу выдать посылку только ему или по доверенности. Он может за пару минут оформить передачу в приложении, и я сразу выдам посылку вам».\n\nНе оправдывайтесь и не спорьте. Если давление усиливается, повторите правило и позовите старшего смены. Угрозы жалобой не меняют правил: соблюдая их, вы защищены.\n\n### Правило паузы\n\nМанипуляция работает, пока вы действуете на эмоциях. Перед любым нестандартным действием задайте себе четыре вопроса:\n1. **Кто это на самом деле** и чем подтверждена его личность или полномочия?\n2. **Почему так срочно?** Настоящие процедуры редко требуют действовать за минуту.\n3. **Что я нарушаю**, если соглашусь? Если ответ: правило выдачи, доступа или конфиденциальности, остановитесь.\n4. **Как проверить по другому каналу?** Позвоните руководителю или получателю по известному номеру, а не по тому, что дали вам.\n\n### Проверка «проверяющих»\n\nПо внутреннему регламенту (демо) любой визит из головного офиса или от подрядчика согласуется заранее. Подтвердите его у своего руководителя по **известному вам номеру**, а не по номеру, который назвал гость. Гость ходит только в сопровождении и не работает под вашей учётной записью. Дверь с пропуском закрывайте за собой и вежливо спрашивайте пропуск у незнакомца.\n\n### Ситуация со смены\n\nВечером в ПВЗ мужчина торопит Айжан: «Это посылка моей сестры, она в больнице, вот фото её удостоверения, машина ждёт». Айжан сочувствует, но действует по правилу: объясняет, что выдать посылку может только сестре или по доверенности, и предлагает оформить передачу в приложении. Мужчина уходит раздражённым. Через час звонит настоящая получательница: накануне у неё украли телефон, в галерее которого было фото удостоверения. Правило защитило и клиентку, и Айжан.'),
  -- источник: https://zakon.uchet.kz/rus/docs/Z1300000094
  ('infosec', 9, 'Устройства, Wi-Fi, чистый стол и действия при инциденте', 'article', 5, null, null, null,
   E'### ТСД и рабочий смартфон\n\n- Входите только под своей учётной записью и выходите из неё в конце смены.\n- Не устанавливайте посторонние приложения и не фотографируйте данные клиентов.\n- Не оставляйте ТСД на стойке или в машине без присмотра.\n- Потеряли ТСД или телефон: сообщите сразу, чтобы IT заблокировал устройство удалённо.\n\n### Ноутбук и компьютер ПВЗ\n\n- Не отключайте антивирус и не откладывайте обновления.\n- Программы устанавливает только IT.\n- Не оставляйте ноутбук на виду в машине или без присмотра в кафе.\n- Не заряжайте личный телефон от рабочего компьютера.\n\n### Флешки и внешние носители\n\nНайденную флешку **не подключайте**, даже чтобы найти владельца: передайте её в IT. Рабочие файлы храните в корпоративном хранилище, а не на личных флешках.\n\n### Wi‑Fi\n\n- Общедоступный Wi‑Fi в кафе и торговых центрах не используйте для рабочих систем. По внутреннему регламенту (демо) раздайте интернет со своего телефона и подключитесь через корпоративный VPN.\n- Опасайтесь сетей-двойников с похожими названиями, например «Jana_Free_WiFi».\n- Гостевой Wi‑Fi для клиентов ПВЗ отделён от служебной сети; пароль служебной сети посетителям не сообщают.\n\n### Мессенджеры и рабочие чаты\n\n- По внутреннему регламенту (демо) рабочие вопросы обсуждаются только в утверждённом корпоративном мессенджере, а не в личных переписках.\n- Не добавляйте в рабочие чаты посторонних и удаляйте уволившихся, сообщая об этом администратору чата.\n- Сообщение от «руководителя» с нового номера с просьбой срочно что-то оплатить, выдать или переслать проверьте звонком по известному номеру.\n- Не пересылайте в чаты фото накладных, экранов и документов с данными клиентов.\n\n### Чистый стол и блокировка экрана\n\n- Отходите от компьютера даже на минуту: **блокируйте экран** (Windows: Win+L, macOS: Ctrl+Cmd+Q).\n- Не оставляйте на стойке накладные, реестры и распечатки с данными; ненужные отправляйте в шредер.\n- Пароли на стикерах под клавиатурой запрещены.\n\n### Что считается инцидентом\n\n- данные отправлены не тому человеку;\n- потеряно или украдено устройство с рабочим доступом;\n- вы ввели пароль на подозрительном сайте или открыли подозрительное вложение;\n- в учётной записи есть действия, которых вы не совершали;\n- посторонний оказался в зоне хранения;\n- посылка выдана не тому человеку.\n\n### Что делать (по внутреннему регламенту (демо))\n\n1. **Сообщите сразу**, не позднее 15 минут, в IT и руководителю. Закон обязывает компанию уведомлять уполномоченный орган о нарушении безопасности персональных данных (ст. 25 Закона № 94-V), поэтому скорость важна.\n2. **Опишите**: что произошло, когда, какие данные или устройства затронуты, кому ушли данные.\n3. **Ограничьте ущерб**, если знаете как: смените пароль, отключите компьютер от сети, не выключая его, попросите ошибочного получателя удалить письмо.\n\n### Чего не делать\n\n- не скрывать и не ждать, «вдруг обойдётся»;\n- не удалять самостоятельно письма, файлы и сообщения: они нужны для разбора;\n- не перезванивать мошенникам и не «расследовать» в одиночку;\n- не обсуждать инцидент в общих чатах.\n\nВ Jana Post (демо) за своевременное сообщение об ошибке не наказывают, наказывают за сокрытие.\n\n### Ситуация со смены\n\nОператор ПВЗ Самал по ошибке отправила реестр с адресами клиентов в общий чат смены вместо личного сообщения старшему. Она сразу звонит в IT и пишет руководителю, а по указанию IT удаляет сообщение и просит коллег удалить сохранённые копии. Инцидент зафиксирован за 10 минут, и IT проверяет, не переслали ли файл дальше.'),
  ('infosec', 10, 'Проверь себя: фишинг, манипуляции и инциденты', 'practice', 6, null, null, null,
   E'Пять вопросов по урокам о фишинге, социальной инженерии, устройствах и инцидентах. Ответ проверяется сразу.')
) as l(slug, sort, title, kind, minutes, video_id, video_title, video_channel, content) on l.slug = c.slug;

create table if not exists seed_tmp.lchecks (slug text, lesson_sort int, sort int, question text, options jsonb, correct int, explanation text);
insert into seed_tmp.lchecks values
  ('safety', 4, 1, 'Новичка ставят на сортировку в первый день: «Инструктаж на рабочем месте проведём в конце недели». Как правильно?',
   '["Начать работу, а инструктаж пройти в конце недели", "Попросить провести первичный инструктаж до начала самостоятельной работы", "Расписаться в журнале сейчас, чтобы не задерживать поток", "Ограничиться вводным инструктажем у специалиста по охране труда"]', 1, 'Первичный инструктаж проводится до начала самостоятельной работы, а без инструктажа и проверки знаний к работе не допускают (Правила, приказ № 1019).'),
  ('safety', 4, 2, 'Кладовщик вернулся на склад после перерыва в работе длиной 70 календарных дней. Какой инструктаж ему положен?',
   '["Повторный", "Целевой", "Внеплановый", "Вводный"]', 2, 'Перерыв в работе более 60 календарных дней: одно из оснований для внепланового инструктажа.'),
  ('safety', 4, 3, 'Сотрудница всю смену перекладывает посылки с конвейера на полки. Какой предельный вес одного места для неё по нормам РК?',
   '["5 кг", "7 кг", "10 кг", "15 кг"]', 1, 'При постоянном подъёме в течение смены: не более 7 кг. Предел 10 кг действует, только если подъём чередуется с другой работой (до 2 раз в час).'),
  ('safety', 4, 4, 'Как правильно поднять с пола коробку весом 15 кг?',
   '["Наклониться с прямыми ногами и поднять рывком", "Поднять на вытянутых руках, чтобы не испачкать одежду", "Поднять и сразу развернуть корпус к полке", "Присесть, сохранить прямую спину, прижать коробку к телу и встать за счёт ног"]', 3, 'Подъём ногами с прямой спиной и грузом у тела снижает нагрузку на поясницу; поворачиваться с грузом нужно, переступая ногами.'),
  ('safety', 4, 5, 'Защитную обувь вам не выдали, а ставят на разгрузку поддонов. Какое право даёт вам Трудовой кодекс РК?',
   '["Отказаться от работы, письменно известив руководителя", "Работать в своей обуви и потребовать доплату", "Уйти домой, никого не предупредив", "Никакого: СИЗ выдают только после испытательного срока"]', 0, 'Статья 181 ТК РК даёт право отказаться от работы, если работодатель не обеспечил средствами защиты, с письменным извещением руководителя или работодателя.'),
  ('safety', 10, 1, 'Посылка застряла между роликами работающего конвейера. Что делаете первым?',
   '["Быстро выдёргиваете её рукой, пока лента идёт", "Нажимаете аварийную остановку и сообщаете старшему смены", "Подталкиваете посылку палкой, не останавливая линию", "Ждёте, пока посылка проедет сама"]', 1, 'Тянуться к движущимся роликам нельзя: сначала остановка линии, затем устранение. Запускает линию старший смены.'),
  ('safety', 10, 2, 'Под стойкой ПВЗ загорелся удлинитель с подключённым принтером. Рядом есть порошковый и воздушно-пенный огнетушители. Чем тушить?',
   '["Водой из кулера", "Воздушно-пенным огнетушителем", "Порошковым огнетушителем, по возможности обесточив линию", "Накрыть пустой картонной коробкой"]', 2, 'Порошковый огнетушитель подходит для электрооборудования под напряжением; воду и пену на электроприборы под напряжением применять нельзя.'),
  ('safety', 10, 3, 'Коллега глубоко порезал руку, кровь течёт сильно. Опасности рядом нет. Что сделать в первую очередь?',
   '["Прижать рану салфеткой или бинтом и наложить давящую повязку", "Сразу наложить жгут выше локтя", "Промыть рану и оставить открытой", "Отправить коллегу в травмпункт одного"]', 0, 'Первый шаг: прямое давление и давящая повязка. Жгут нужен, только если кровотечение из конечности не останавливается давлением.'),
  ('safety', 10, 4, 'Сотрудник упал со стремянки. Скорая уехала, и старший смены просит убрать стремянку и коробки, «чтобы не мешали». Как правильно?',
   '["Убрать всё: место должно быть чистым", "Убрать, но перед этим сфотографировать на личный телефон", "Переставить стремянку к стене, а коробки оставить", "Сохранить обстановку до расследования, если она не угрожает людям"]', 3, 'По статье 187 ТК РК обстановка на месте несчастного случая сохраняется до начала расследования, если это не угрожает другим людям.'),
  ('safety', 10, 5, 'У сотрудницы сын пяти лет. Можно ли поставить её в ночную смену?',
   '["Нельзя ни при каких условиях", "Можно только с её письменного согласия", "Можно без согласия, если ночные часы оплачиваются в полуторном размере", "Можно без согласия после окончания испытательного срока"]', 1, 'По статье 76 ТК РК женщин с детьми до семи лет привлекают к ночной работе только с их письменного согласия.'),
  ('infosec', 5, 1, 'Что из перечисленного относится к персональным данным?',
   '["Адрес склада и график его работы", "Количество посылок за день по ПВЗ", "ИИН и номер телефона получателя", "Модель ТСД на участке"]', 2, 'Персональные данные: сведения о конкретном человеке. ИИН и телефон получателя к ним относятся, а данные о складе и оборудовании нет.'),
  ('infosec', 5, 2, 'Клиент на ПВЗ просит сделать ксерокопию его удостоверения «на всякий случай». Как поступить?',
   '["Отказать: закон запрещает собирать бумажные копии удостоверений, кроме случаев, указанных в законе", "Сделать копию и хранить в ящике стойки", "Сфотографировать удостоверение на личный телефон", "Сделать копию, раз клиент сам настаивает"]', 0, 'Статья 7 Закона № 94-V запрещает сбор и обработку бумажных копий документов, удостоверяющих личность, кроме случаев, перечисленных в законе.'),
  ('infosec', 5, 3, 'Сосед получателя просит назвать телефон получателя, «чтобы передать ему посылку». Как правильно?',
   '["Назвать, если сосед знает адрес", "Назвать только последние четыре цифры", "Отправить номер соседу в мессенджер", "Не сообщать номер и предложить получателю самому связаться с ПВЗ"]', 3, 'Данные ограниченного доступа нельзя раскрывать без согласия человека или иного законного основания (ст. 11 Закона № 94-V).'),
  ('infosec', 5, 4, 'Сотрудник выгружает базу клиентов, «чтобы потом поздравлять их с праздниками от себя». Что нарушено в первую очередь?',
   '["Принцип равенства прав субъектов", "Законность и обработка только для заранее определённых целей", "Ничего: данные уже есть у компании", "Только правила оформления отчётов"]', 1, 'Данные клиентов собраны для доставки; использовать их в других целях без законного основания нельзя.'),
  ('infosec', 5, 5, 'Коллега ставит один и тот же пароль на JanaMen, почту и личную соцсеть, «чтобы не забыть». Чем это опасно?',
   '["Ничем, если пароль длинный", "Только тем, что его долго вводить", "Утечка одного сервиса откроет доступ ко всем остальным", "Соцсеть заблокирует такой аккаунт"]', 2, 'Мошенники проверяют утёкшие пароли на других сайтах, поэтому у каждого сервиса должен быть свой пароль; помогает менеджер паролей.'),
  ('infosec', 10, 1, 'Пришло письмо «IT Jana Post» с адреса на домене janapost-it-support.com: «Ящик заблокируют через час, подтвердите пароль по ссылке». Что делать?',
   '["Перейти по ссылке и посмотреть, что за сайт", "Не переходить по ссылке и сообщить в IT установленным способом", "Ответить на письмо и спросить, правда ли это", "Переслать письмо коллегам, чтобы они были в курсе"]', 1, 'Срочность, внешний домен и просьба ввести пароль: классические признаки фишинга. Ответ на письмо или пересылка только помогают мошенникам.'),
  ('infosec', 10, 2, 'Звонят из «службы безопасности банка»: «С вашей карты списывают деньги, продиктуйте код из SMS для отмены». Как поступить?',
   '["Продиктовать только первые три цифры кода", "Продиктовать код, раз собеседник знает ваше имя", "Попросить прислать код ещё раз", "Положить трубку и перезвонить в банк по номеру с карты или из официального приложения"]', 3, 'Банк не просит коды по телефону. Имя и цифры карты мошенники берут из утечек, поэтому перезванивайте сами по официальному номеру.'),
  ('infosec', 10, 3, 'Посетитель просит выдать посылку брата и показывает фото его удостоверения на своём телефоне. Как правильно?',
   '["Вежливо отказать и предложить брату оформить передачу в приложении или доверенность", "Выдать: фото удостоверения подтверждает личность", "Выдать, если посетитель знает трек-номер", "Позвонить брату по номеру, который назвал посетитель, и выдать после устного согласия"]', 0, 'По регламенту (демо) посылку выдают получателю или по доверенности либо оформленной в приложении передаче; фото документа и устные просьбы основанием не являются.'),
  ('infosec', 10, 4, 'На парковке склада лежит флешка с надписью «Зарплаты 2026». Что делать?',
   '["Вставить в компьютер ПВЗ, чтобы найти владельца", "Проверить на личном ноутбуке, он же не рабочий", "Не подключать и передать в IT", "Отдать охраннику, чтобы он посмотрел содержимое"]', 2, 'Подброшенная флешка может содержать вредоносную программу. Никуда её не подключайте и передайте в IT.'),
  ('infosec', 10, 5, 'Вы по ошибке отправили файл с адресами клиентов не тому коллеге. Что правильно?',
   '["Ничего не делать: это же коллега", "Сразу сообщить в IT и руководителю и попросить получателя удалить файл", "Рассказать об этом на планёрке через неделю", "Тихо удалить письмо из отправленных"]', 1, 'Ошибочная отправка персональных данных: инцидент. Сообщить нужно сразу, а скрывать следы нельзя.');

-- final test (the table seed_tmp.questions(slug, sort, question, options, correct, explanation) is created by the caller; only insert rows)
insert into seed_tmp.questions values
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012665
  ('safety', 1, 'Как часто проводится повторный инструктаж по безопасности и охране труда?',
   '["Раз в год", "Раз в три года", "Не реже одного раза в полугодие", "Только при переводе на другую должность"]', 2, 'По Правилам (приказ № 1019) повторный инструктаж проходят не реже одного раза в полугодие, в рабочее время.'),
  -- источник: https://prg.kz/m/amp/document/38910832/15/1880000
  ('safety', 2, 'Вы заметили погнутую стойку стеллажа, на которую уже поставили груз. Что вы обязаны сделать?',
   '["Немедленно сообщить старшему смены и не нагружать секцию", "Продолжить работу, раз стеллаж стоит", "Выпрямить стойку самостоятельно", "Написать об этом в конце смены в общий чат"]', 0, 'Работник обязан немедленно сообщать о ситуации, угрожающей жизни и здоровью людей (ст. 181 ТК РК); повреждённую секцию не нагружают и ограждают.'),
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012665
  ('safety', 3, 'Оператора ПВЗ на один день отправляют помогать разгружать вагон на сортировочном центре. Какой инструктаж нужен перед этой работой?',
   '["Вводный", "Повторный", "Внеплановый", "Целевой"]', 3, 'Целевой инструктаж проводят перед разовыми работами, не связанными с прямыми обязанностями работника.'),
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012597
  -- источник: https://zakon.uchet.kz/rus/docs/V2100025800
  ('safety', 4, 'Сотрудница поднимает мешки не чаще двух раз в час, чередуя это с другой работой. Каков предельный вес одного места?',
   '["7 кг", "10 кг", "15 кг", "20 кг"]', 1, 'При чередовании с другой работой (до 2 раз в час) предел для женщин: 10 кг; при постоянном подъёме в течение смены: 7 кг.'),
  ('safety', 5, 'Вы идёте по складу, а из ряда задним ходом выезжает погрузчик. Как поступить?',
   '["Быстро пройти позади него", "Помахать водителю и пройти перед вилами", "Остановиться, дождаться, пока водитель вас заметит и проедет, и идти по пешеходной дорожке", "Пройти под поднятыми вилами, пока погрузчик стоит"]', 2, 'Рядом с техникой главное: остановиться и установить зрительный контакт с водителем. Под поднятыми вилами и позади погрузчика находиться нельзя.'),
  -- источник: https://zakon.uchet.kz/rus/docs/V1500012665
  ('safety', 6, 'Коллега без удостоверения предлагает: «Давай я быстро переставлю поддон погрузчиком». Как правильно?',
   '["Можно, если старший смены разрешил устно", "Нельзя: управлять погрузчиком может только обученный и допущенный работник с удостоверением", "Можно, если ехать медленно", "Можно, если у него есть водительские права категории B"]', 1, 'Без обучения, проверки знаний и допуска к работе с техникой не допускают; по регламенту (демо) нужен и приказ о допуске.'),
  -- источник: https://www.mos.ru/news/item/149797073/
  ('safety', 7, 'Почему углекислотный огнетушитель нельзя держать за раструб?',
   '["Раструб сильно нагревается", "Раструб проводит электрический ток", "Так можно случайно сорвать пломбу", "Раструб сильно охлаждается и может вызвать обморожение"]', 3, 'При выходе углекислоты раструб резко охлаждается, поэтому работают в перчатках и держат огнетушитель за рукоятку.'),
  -- источник: https://mchs.gov.ru/deyatelnost/bezopasnost-grazhdan/termicheskiy-ozhog_2
  ('safety', 8, 'На ПВЗ вы обожгли кисть горячим клеем из термопистолета. Что делать?',
   '["Охлаждать прохладной водой не менее 20 минут, пузыри не вскрывать", "Смазать ожог маслом или кремом", "Проколоть пузырь и туго забинтовать", "Приложить лёд прямо к коже на час"]', 0, 'Ожог охлаждают прохладной водой не менее 20 минут; масло, кремы и вскрытие пузырей вредят.'),
  -- источник: https://prg.kz/m/amp/document/38910832/8/760000
  ('safety', 9, 'Какое время считается ночным по Трудовому кодексу РК?',
   '["С 21:00 до 5:00", "С 23:00 до 7:00", "С 22:00 до 6:00", "С 0:00 до 6:00"]', 2, 'Статья 76 ТК РК: ночным считается время с 22 до 6 часов.'),
  ('safety', 10, 'Посетитель ПВЗ кричит, угрожает и бьёт по стойке. Как действовать?',
   '["Выйти из-за стойки и вывести его на улицу", "Держать дистанцию, не спорить, нажать тревожную кнопку или позвонить 102 или 112, затем сообщить руководителю", "Отдать ему любую посылку, чтобы он ушёл", "Ответить тем же тоном, чтобы показать твёрдость"]', 1, 'Ваша безопасность важнее посылки: дистанция, спокойный тон и вызов помощи при угрозе.'),
  -- источник: https://zakon.uchet.kz/rus/docs/Z1300000094
  ('infosec', 1, 'Что по общему правилу требуется для сбора и обработки персональных данных по Закону РК № 94-V?',
   '["Устное разрешение руководителя", "Согласие субъекта, кроме случаев, предусмотренных законом", "Только нотариально заверенное согласие", "Ничего, если данные нужны для работы"]', 1, 'Закон требует согласия субъекта, за исключением случаев, прямо предусмотренных законом (ст. 7).'),
  -- источник: https://pages.nist.gov/800-63-4/sp800-63b.html
  ('infosec', 2, 'Какое утверждение о паролях соответствует современным рекомендациям NIST SP 800-63B?',
   '["Пароль нужно менять каждые 30 дней", "Главное: заглавные буквы, цифры и спецсимволы, а длина не важна", "Пароля из 8 символов достаточно без второго фактора", "Длина важнее сложности: длинная парольная фраза и свой пароль для каждого сервиса"]', 3, 'NIST требует не менее 15 символов для пароля без второго фактора, запрещает навязывать правила состава и периодическую смену без признаков компрометации.'),
  ('infosec', 3, 'Коллега просит ваш логин от ТСД, потому что его учётную запись заблокировали. Как поступить?',
   '["Отказать и помочь связаться с IT для разблокировки", "Дать логин, а после смены сменить пароль", "Дать логин, если просит старший смены", "Войти самому и дать ему поработать"]', 0, 'Учётные данные не передаются никому: всё, что сделано под вашей учётной записью, считается сделанным вами.'),
  ('infosec', 4, 'Какой признак указывает на фишинг в SMS «Jana Post: оплатите сбор 690 тг по ссылке jana-dostavka.top/pay»?',
   '["Небольшая сумма платежа", "Название компании в начале сообщения", "Неожиданное требование оплаты по ссылке на посторонний домен", "Сообщение пришло днём"]', 2, 'Посторонний домен и неожиданное требование оплаты: главные признаки. Статус и оплату проверяют только в официальном приложении.'),
  ('infosec', 5, 'Пришло push-уведомление «Подтвердите вход в JanaMen», а вы в систему не входили. Что делать?',
   '["Подтвердить, чтобы уведомление исчезло", "Отклонить запрос, сменить пароль и сообщить в IT", "Не реагировать, а если придёт снова, подтвердить", "Удалить приложение-аутентификатор"]', 1, 'Неожиданный запрос означает, что пароль, скорее всего, уже известен злоумышленнику: отклоните вход, смените пароль и сообщите в IT.'),
  ('infosec', 6, 'Человек в фирменном жилете представляется проверяющим из головного офиса и просит пустить его в зону хранения ПВЗ. О визите вас не предупреждали. Как правильно?',
   '["Не пускать, пока руководитель не подтвердит визит по известному вам номеру", "Пустить: на нём фирменный жилет", "Пустить и вернуться к работе", "Дать ему свой пропуск, чтобы он прошёл сам"]', 0, 'Жилет и бейдж легко подделать. По регламенту (демо) визиты согласуются заранее и подтверждаются по известному номеру, а гость ходит только в сопровождении.'),
  ('infosec', 7, 'Нужно срочно отправить рабочий отчёт, а вы в кафе. Как сделать это безопаснее всего?',
   '["Подключиться к открытой сети с названием, похожим на сеть кафе", "Спросить пароль от Wi-Fi у соседнего столика", "Переслать файл на личную почту и отправить оттуда", "Раздать интернет со своего телефона и подключиться через корпоративный VPN"]', 3, 'Общедоступные сети и сети-двойники опасны, а личная почта выводит данные за пределы компании.'),
  ('infosec', 8, 'Зачем блокировать экран, даже если вы отходите от стойки ПВЗ на минуту?',
   '["Чтобы экономить электроэнергию", "Так требует производитель монитора", "Посторонний может увидеть данные клиентов или выполнить действия под вашей учётной записью", "Чтобы обновился антивирус"]', 2, 'Незаблокированный экран открывает доступ к данным и системам от вашего имени.'),
  ('infosec', 9, 'Вы ввели рабочий пароль на сайте, который оказался поддельным. Что сделать в первую очередь?',
   '["Сразу сменить пароль и сообщить в IT", "Подождать, вдруг ничего не случится", "Очистить историю браузера", "Написать на поддельный сайт с требованием удалить пароль"]', 0, 'Скорость решает: сменённый пароль мошенник использовать уже не сможет, а IT проверит, не было ли входа.'),
  -- источник: https://zakon.uchet.kz/rus/docs/Z1300000094
  ('infosec', 10, 'Звонит человек, называет себя получателем и просит продиктовать адрес и содержимое его посылки. Что можно сообщить?',
   '["Адрес доставки и телефон", "Содержимое посылки по декларации", "ИИН получателя для сверки", "Никаких персональных данных: детали получатель увидит в своём приложении"]', 3, 'По телефону невозможно проверить личность звонящего, поэтому данные о посылке и получателе не раскрываются (ст. 11 Закона № 94-V).');

-- Итоговые тесты: вопросы видны всем, правильные ответы только в закрытой таблице
insert into public.course_questions (course_id, sort, question, options, explanation)
select c.id, q.sort, q.question, q.options, q.explanation
from seed_tmp.questions q join public.courses c on c.slug = q.slug;

insert into public.course_answer_keys (question_id, correct_index)
select cq.id, q.correct
from seed_tmp.questions q
join public.courses c on c.slug = q.slug
join public.course_questions cq on cq.course_id = c.id and cq.sort = q.sort;

-- Микротесты внутри уроков-практик
insert into public.lesson_checks (lesson_id, sort, question, options, explanation)
select l.id, k.sort, k.question, k.options, k.explanation
from seed_tmp.lchecks k
join public.courses c on c.slug = k.slug
join public.course_lessons l on l.course_id = c.id and l.sort = k.lesson_sort;

insert into public.lesson_check_keys (check_id, correct_index)
select lc.id, k.correct
from seed_tmp.lchecks k
join public.courses c on c.slug = k.slug
join public.course_lessons l on l.course_id = c.id and l.sort = k.lesson_sort
join public.lesson_checks lc on lc.lesson_id = l.id and lc.sort = k.sort;

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

-- Пройденные уроки-практики: ответы на микротесты засчитаны
insert into public.lesson_check_answers (employee_id, check_id, correct, tries, answered_at)
select lp.employee_id, lc.id, true, 1, lp.completed_at
from public.lesson_progress lp
join public.lesson_checks lc on lc.lesson_id = lp.lesson_id;

-- Прогресс «в процессе» по той же формуле, что в complete_lesson: доля уроков, итоговый тест считается шагом
update public.course_assignments ca
   set progress = least(99, round(100.0 * (select count(*) from public.lesson_progress lp join public.course_lessons l on l.id = lp.lesson_id
                                            where lp.employee_id = ca.employee_id and l.course_id = ca.course_id)
                                  / ((select count(*) from public.course_lessons l where l.course_id = ca.course_id) + 1)))::int
 where ca.status = 'in_progress';

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
   'Подавайте заявку не позднее чем за 14 календарных дней до начала отпуска, так руководитель успеет спланировать смены. Оплата за отпуск производится не позднее чем за три рабочих дня до его начала (ст. 92 Трудового кодекса РК).'),
  ('vacation-annual', 4, 'Разделение и перенос отпуска', 'разделить перенести части',
   'По соглашению с работодателем отпуск можно разделить на части; одна из частей должна быть не менее 14 календарных дней (ст. 92 Трудового кодекса РК). Заявку, которая ещё не оформлена HR, можно отменить в JanaMen и подать новую. Перенос уже оформленного отпуска оформляется через HR.'),
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

-- Дополнительные статьи v2: задачи и дедлайны, обучение, графики и отпуска по ТК РК, СИЗ, пропуск, IT
insert into public.kb_articles (slug, title, title_kk, category, summary, source_title, visibility, keywords, content) values
  -- ---------- О платформе ----------
  ('tasks', 'Задачи в JanaMen', 'JanaMen-дегі тапсырмалар', 'О платформе',
   'Типы задач, дедлайн с датой и временем, приоритет звёздами, связь с постановщиком и что будет при просрочке.',
   'Регламент работы с задачами JanaMen (демо)', 'all', '{задача,задачи,дедлайн,срок,отчет,чеклист,тапсырма}', ''),
  ('deadlines', 'Дедлайны задач и перенос срока', 'Тапсырма мерзімдері және мерзімді ауыстыру', 'О платформе',
   'Как читать дедлайн, что делать, если не успеваете, и кто может перенести срок.',
   'Регламент работы с задачами JanaMen, разд. 3 (демо)', 'all', '{дедлайн,срок,перенос,просрочка,продлить,мерзім}', ''),
  ('notifications', 'Уведомления в JanaMen', 'JanaMen-дегі хабарламалар', 'О платформе',
   'Колокольчик и центр уведомлений: какие события приходят, фильтры и как отметить всё прочитанным.',
   'Руководство пользователя JanaMen, разд. 2 (демо)', 'all', '{уведомления,уведомление,колокольчик,оповещение,напоминание,хабарлама}', ''),

  -- ---------- Обучение ----------
  ('academy-practice', 'Как устроено обучение в Jana Academy', 'Jana Academy-де оқу қалай ұйымдастырылған', 'Обучение',
   'Статьи, видео, практика с мгновенной проверкой, итоговый тест, проходной балл, попытки и сертификат.',
   'Положение об обучении персонала, разд. 2 (демо)', 'all', '{обучение,курс,урок,видео,практика,тест,сертификат,оқу}', ''),

  -- ---------- Оплата труда ----------
  -- источник: https://prg.kz/m/amp/document/38910832/8/780000 (ТК РК, ст. 77 «Сверхурочная работа», ст. 78 «Предельное количество сверхурочных работ»)
  -- источник: https://prg.kz/m/amp/document/38910832/9/1080000 (ТК РК, ст. 108 «Оплата труда за работу в сверхурочное время»)
  -- источник: https://online.zakon.kz/Document/?doc_id=38910832 (ТК РК от 23.11.2015 № 414-V, перенаправляет на prg.kz)
  -- источник: https://informburo.kz/cards/sverxurocnaya-rabota-cto-delat-esli-za-pererabotku-ne-platyat
  ('overtime', 'Сверхурочная работа', 'Үстеме жұмыс', 'Оплата труда',
   'Когда допускается сверхурочная работа, лимиты по Трудовому кодексу РК, оплата и порядок оформления в Jana Post.',
   'Трудовой кодекс РК, ст. 77, 78, 108; памятка HR (демо)', 'all', '{сверхурочные,сверхурочная,переработка,переработки,овертайм,доплата,үстеме}', ''),
  -- источник: https://prg.kz/m/amp/document/38910832/8/780000 (ТК РК, ст. 76 «Работа в ночное время»)
  -- источник: https://prg.kz/m/amp/document/38910832/9/1080000 (ТК РК, ст. 110 «Оплата труда за работу в ночное время»)
  ('night-work', 'Работа в ночное время', 'Түнгі уақыттағы жұмыс', 'Оплата труда',
   'Какое время считается ночным, кого нельзя привлекать к ночной работе и как она оплачивается.',
   'Трудовой кодекс РК, ст. 76, 110; памятка HR (демо)', 'all', '{ночь,ночная,ночные,ночное,смена,доплата,түнгі}', ''),

  -- ---------- Трудовые отношения ----------
  -- источник: https://prg.kz/m/amp/document/38910832/8/750000 (ТК РК, ст. 73 «Сменная работа», ст. 75 «Суммированный учет рабочего времени»)
  -- источник: https://prg.kz/m/amp/document/38910832/8/780000 (ТК РК, ст. 83 «Ежедневный (междусменный) отдых», ст. 84 «Выходные дни»)
  ('shift-schedule', 'Сменный график и суммированный учёт рабочего времени', 'Ауысымдық кесте және жұмыс уақытын жиынтық есепке алу', 'Трудовые отношения',
   'Как устроен график 2/2 на складе, что такое учётный период и какие правила отдыха между сменами.',
   'Трудовой кодекс РК, ст. 73, 75, 83, 84; Правила внутреннего трудового распорядка (демо)', 'all', '{график,смена,смены,2/2,суммированный,учет,учетный,ауысым}', ''),
  -- источник: https://zakon.uchet.kz/rus/docs/Z010000267_ (Закон РК от 13.12.2001 № 267 «О праздниках в Республике Казахстан», ст. 2, 3, 5; ред. от 01.07.2026)
  -- источник: https://pro1c.kz/hotline/ministerstvo-zdravookhraneniya-i-sotsialnogo-razvitiya/planiruetsya-li-perenos-vykhodnykh-dney-v-mae-2026-goda-razyasnenie-mtiszn-rk-ot-19-marta-2026-goda/ (разъяснение МТСЗН РК от 19.03.2026: переносов выходных в 2026 году не будет)
  -- источник: https://prg.kz/m/amp/document/38910832/8/780000 (ТК РК, ст. 84 п. 5, ст. 85)
  -- источник: https://prg.kz/m/amp/document/38910832/9/1080000 (ТК РК, ст. 109)
  -- источник: https://bes.media/amp/prazdniki-i-vihodnie-kogda-i-skolko-budut-otdihat-kazahstantsi-v-2026-godu-ca9ef3/ (календарь 2026)
  -- источник: https://informburo.kz/novosti/perenosy-vyxodnyx-i-kurban-ait-v-mae-kalendar-prazdnicnyx-dnei-v-kazaxstane-na-2026-god (Курбан айт 27.05.2026, 26.10.2026 выходной)
  -- источник: https://digitalbusiness.kz/2026-04-03/u-kazahstantsev-zabrali-odin-dopolnitelniy-vihodnoy-v-2026-godu/amp/ (День Конституции перенесён на 15 марта, 31.08.2026 рабочий)
  ('holidays-2026', 'Праздничные дни в 2026 году', '2026 жылғы мереке күндері', 'Трудовые отношения',
   'Государственные праздники РК, перенос выходного при совпадении с праздником, нерабочие дни 2026 года и работа в праздник.',
   'Закон РК «О праздниках в Республике Казахстан», ст. 2, 3, 5; Трудовой кодекс РК, ст. 84, 85, 109; памятка HR (демо)', 'all',
   '{праздник,праздники,праздничный,выходной,выходные,перенос,наурыз,курбан,мереке}', ''),
  ('peak-season', 'Работа в пиковый сезон 11.11', '11.11 қарбалас маусымындағы жұмыс', 'Трудовые отношения',
   'Пик после распродаж 11.11: усиленный график, ограничения отпусков, сверхурочные, временный персонал и поддержка сотрудников.',
   'Регламент работы в пиковые периоды ТОО «Jana Post» (демо)', 'all', '{пик,11.11,сезон,распродажа,нагрузка,график,отпуск,переработка,қарбалас}', ''),
  ('onboarding-first-week', 'Первая неделя в Jana Post', 'Jana Post-тағы алғашқы апта', 'Трудовые отношения',
   'Что ждёт новичка в первые дни: наставник, документы, курсы, задачи и встреча по итогам недели.',
   'Программа адаптации персонала ТОО «Jana Post» (демо)', 'all', '{новичок,адаптация,онбординг,первый,неделя,наставник,стажер}', ''),

  -- ---------- Отсутствия ----------
  -- источник: https://prg.kz/m/amp/document/38910832/9/1080000 (ТК РК, ст. 97 «Отпуск без сохранения заработной платы»)
  ('unpaid-leave', 'Отпуск без сохранения заработной платы', 'Жалақы сақталмайтын демалыс', 'Отсутствия',
   'Когда отпуск без сохранения зарплаты даётся по соглашению сторон, когда работодатель обязан его предоставить и как оформить.',
   'Трудовой кодекс РК, ст. 97; памятка HR (демо)', 'all', '{отпуск,отгул,бессодержания,свадьба,похороны,рождение,жалақысыз}', ''),
  -- источник: https://prg.kz/m/amp/document/38910832/9/1080000 (ТК РК, ст. 98 «Учебные отпуска»)
  ('study-leave', 'Учебный отпуск', 'Оқу демалысы', 'Отсутствия',
   'Кому положен учебный отпуск, для чего он предоставляется и как определяется его оплата.',
   'Трудовой кодекс РК, ст. 98; Положение об обучении персонала (демо)', 'all', '{учебный,отпуск,сессия,экзамены,диплом,учеба,университет,колледж,оқу}', ''),
  -- источник: https://prg.kz/m/amp/document/38910832/9/1080000 (ТК РК, ст. 99 «Отпуска в связи с беременностью и родами, усыновлением», ст. 100 «Отпуск по уходу за ребенком до трех лет»)
  -- источник: https://www.zakon.kz/obshestvo/6480719-kak-i-kuda-podat-zayavlenie-chtoby-poluchit-vyplatu-po-beremennosti-i-rodam-v-kazakhstane.html (выплата ГФСС по беременности и родам: egov.kz, 8 рабочих дней, доход за 12 месяцев)
  -- источник: https://finance.kz/articles/kak-rasschityvayutsya-socialnye-vyplaty-gfss (расчёт выплат ГФСС в 2026 году: 12 месяцев для беременности и родам, 40% и 24 месяца для ухода)
  -- источник: https://finance.kz/articles/posobie-po-uhodu-za-rebenkom-do-1-5-let (выплата по уходу до 1,5 лет, каналы подачи)
  -- источник: https://www.gov.kz/memleket/entities/enbek/press/news/details/1181117?lang=ru (МТСЗН: пособия и выплаты на рождение и по уходу за ребёнком в 2026 году)
  ('maternity', 'Отпуск по беременности и родам и по уходу за ребёнком', 'Жүктілікке және босануға байланысты демалыс және бала күтіміне байланысты демалыс', 'Отсутствия',
   'Сроки отпуска по беременности и родам, отпуск по уходу за ребёнком до трёх лет, документы и кто выплачивает пособия.',
   'Трудовой кодекс РК, ст. 99, 100; Социальный кодекс РК; памятка HR (демо)', 'all',
   '{декрет,декретный,беременность,роды,уход,ребенок,пособие,гфсс,усыновление,жүктілік}', ''),

  -- ---------- Безопасность ----------
  ('ppe', 'Спецодежда и средства индивидуальной защиты', 'Арнайы киім және жеке қорғану құралдары', 'Безопасность',
   'Что выдаётся сотрудникам склада, курьерам и операторам ПВЗ, сроки носки, замена и возврат при увольнении.',
   'Положение о спецодежде и СИЗ ТОО «Jana Post» (демо)', 'all', '{спецодежда,сиз,перчатки,обувь,жилет,форма,каска,арнайы}', ''),
  ('access-pass', 'Пропуск и доступ на склад', 'Рұқсатнама және қоймаға кіру', 'Безопасность',
   'Как получить пропуск, какие зоны доступны, как провести гостя и что делать при потере пропуска.',
   'Положение о пропускном режиме ТОО «Jana Post» (демо)', 'all', '{пропуск,доступ,турникет,охрана,гость,потерял,рұқсатнама}', ''),

  -- ---------- О компании ----------
  ('it-support', 'IT-поддержка', 'IT-қолдау', 'О компании',
   'Как обратиться в IT-поддержку, сбросить пароль и что делать при потере или поломке ТСД, телефона или ноутбука.',
   'Регламент IT-поддержки ТОО «Jana Post» (демо)', 'all', '{it,айти,пароль,тсд,сканер,ноутбук,телефон,поддержка}', ''),
  ('ethics-gifts', 'Подарки от клиентов и конфликт интересов', 'Клиенттерден сыйлықтар және мүдделер қақтығысы', 'О компании',
   'Какие подарки можно принимать, как быть с чаевыми и как сообщить о конфликте интересов.',
   'Кодекс корпоративной этики Jana Post, разд. 4 (демо)', 'all', '{подарок,подарки,чаевые,взятка,конфликт,интересов,этика,сыйлық}', ''),

  -- ---------- Для руководителей ----------
  ('manager-tasks', 'Как ставить задачи команде', null, 'Для руководителей',
   'Выбор типа задачи, дедлайн и приоритет, задача нескольким сотрудникам, приём и возврат отчётов.',
   'Регламент работы с задачами JanaMen, разд. 5 (для руководителей, демо)', 'manager',
   '{поставить,задача,команда,отчет,принять,вернуть,доработка,постановщик}', ''),
  ('manager-newbie', 'Новичок в команде: чек-лист руководителя', null, 'Для руководителей',
   'Что руководитель делает до выхода новичка, в первую неделю и к концу испытательного срока.',
   'Программа адаптации персонала, разд. 4 (для руководителей, демо)', 'manager',
   '{новичок,адаптация,наставник,испытательный,онбординг,стажер}', ''),

  -- ---------- Для HR ----------
  ('hr-bulk-reminders', 'Массовые напоминания из «Пульса компании»', null, 'Для HR',
   'Работа с «Зоной внимания»: напоминания об отпуске и курсах, «Поторопить», назначение курса новичку и своё напоминание группе.',
   'Регламент HR-мониторинга JanaMen (для HR, демо)', 'hr',
   '{напоминание,напоминания,пульс,зона,внимания,массово,слежу,поторопить}', '');

insert into seed_tmp.chunks values
  -- ---------- tasks ----------
  ('tasks', 1, 'Где найти задачи и как они устроены', 'мои задачи где найти задачу доска статусы канбан к выполнению в работе готово',
   'Раздел «Мои задачи» показывает всё, что вам поручили руководитель, HR или коллеги, а также ваши личные задачи. Задачи разложены по статусам «К выполнению», «В работе», «На проверке» и «Готово»; статус меняется кнопкой в карточке или перетаскиванием. В карточке видно постановщика, дедлайн с датой и временем, приоритет, описание и комментарии. О каждой новой задаче приходит уведомление.'),
  ('tasks', 2, 'Четыре типа задач', 'типы задач обычная пройти курс отчет чек-лист чеклист какая бывает задача',
   'Обычная задача: сделали работу и нажали «Готово». «Пройти курс»: в карточке есть кнопка «Перейти к курсу», задача сама переходит в «В работе», когда вы начали курс, и закрывается автоматически после сдачи итогового теста. Отчёт: нужно приложить результат (комментарий, фото или файл до 3 МБ) и отправить задачу «На проверку», после чего постановщик принимает работу или возвращает её на доработку. Чек-лист: задача разбита на шаги, вы отмечаете выполненные, а прогресс виден вам и постановщику.'),
  ('tasks', 3, 'Как сдать отчёт и что значит «На проверке»', 'как сдать отчет прикрепить файл фото результат отправить на проверку вернули на доработку',
   'Откройте задачу, опишите результат в поле отчёта или прикрепите фото или PDF и нажмите «На проверку». Без результата отправить отчёт нельзя. Постановщик получит уведомление и либо примет задачу (она перейдёт в «Готово»), либо вернёт её в «В работе» с комментарием, что доработать, и вам придёт уведомление. Пока задача на проверке, уточнения пишите в комментариях к ней.'),
  ('tasks', 4, 'Чек-лист и приоритет', 'чек-лист шаги отметить шаг прогресс приоритет звезды звездочки важность срочная задача',
   'В чек-листе отмечайте шаги по мере выполнения: как только отмечен первый шаг, задача сама переходит в «В работе». Закрыть чек-лист можно, когда отмечены все шаги; менять текст и количество шагов может только постановщик. Приоритет показан звёздами: одна звезда – низкий, две – средний, три – высокий, четыре – срочно. Начинайте со срочных задач и задач с ближайшим дедлайном.'),
  ('tasks', 5, 'Связь с постановщиком и просрочка', 'написать постановщику вопрос по задаче не понимаю задачу комментарий просрочка что будет если просрочил',
   'Если что-то непонятно, нажмите «Написать постановщику» в карточке задачи: откроется личный чат с ним. Короткие уточнения по ходу работы оставляйте в комментариях к задаче, их видят все участники. Когда дедлайн прошёл, задача отмечается как просроченная и видна вашему руководителю и HR. Автоматических санкций за просрочку в JanaMen нет, но систематические просрочки руководитель обсуждает с вами, поэтому о риске не успеть лучше предупредить заранее (см. статью «Дедлайны задач и перенос срока»).'),

  -- ---------- deadlines ----------
  ('deadlines', 1, 'Как читать дедлайн', 'дедлайн срок до какого времени время сдачи что значит дедлайн часовой пояс',
   'Дедлайн в JanaMen всегда указан с датой и временем по казахстанскому времени, например «до 21.10, 18:00». К этому моменту задача должна быть выполнена, а отчёт отправлен на проверку. Время обычно привязано к концу смены или к событию, например к отправке машины. Берите в работу сначала задачи с ближайшим дедлайном; просроченные выделяются в списке.'),
  ('deadlines', 2, 'Если не успеваете', 'не успеваю что делать не успею сдать вовремя опаздываю с задачей много задач',
   'Как только понимаете, что не успеваете, напишите постановщику через «Написать постановщику» или в комментарии к задаче, не дожидаясь дедлайна. Коротко объясните причину, что уже сделано и к какому сроку реально закончить. Предупредить заранее, лучше хотя бы за смену до срока, – нормальная рабочая практика, а не нарушение. Если задача конфликтует с другой срочной работой, попросите руководителя расставить приоритеты.'),
  ('deadlines', 3, 'Кто переносит дедлайн', 'перенести дедлайн продлить срок поменять срок изменить дату кто может',
   'Изменить дедлайн может постановщик задачи, ваш руководитель или HR. Исполнитель срок не меняет: он отмечает ход работы и шаги чек-листа и прикладывает результат. Новый срок сразу появляется в карточке задачи. Договорённость о переносе фиксируйте в комментариях, чтобы история была в одном месте.'),
  ('deadlines', 4, 'Что происходит после дедлайна', 'просрочено после срока последствия руководитель видит просрочку задача осталась открытой',
   'Если задача не закрыта к дедлайну, она получает отметку о просрочке и попадает в мониторинг руководителя и HR. Задача остаётся открытой: её нужно доделать или договориться с постановщиком о новом сроке. Повторяющиеся просрочки руководитель разбирает с вами на встрече, чтобы понять причину: перегрузка, неясная постановка или нехватка ресурсов.'),

  -- ---------- notifications ----------
  ('notifications', 1, 'Колокольчик и центр уведомлений', 'колокольчик где уведомления счетчик красная цифра непрочитанные история',
   'Колокольчик в верхней панели показывает число непрочитанных уведомлений. Нажмите на него, чтобы увидеть последние события, или откройте страницу «Уведомления», где хранится вся история. Нажатие на уведомление открывает связанную страницу: заявку, задачу, курс или объявление.'),
  ('notifications', 2, 'Какие события приходят', 'какие уведомления приходят о чем уведомляет заявка задача курс объявление ответ hr',
   'Уведомления приходят, когда вам поставили задачу, приняли отчёт или вернули задачу на доработку; когда заявку согласовали, отклонили или оформили в 1С:ЗУП; когда вам назначили курс или вы его прошли; когда HR ответил на ваш вопрос; когда руководитель или HR прислали напоминание; когда опубликовано закреплённое или срочное объявление. Руководителям также приходят новые заявки команды на согласование и задачи на проверке.'),
  ('notifications', 3, 'Фильтры и «Прочитать все»', 'прочитать все отметить прочитанным фильтр непрочитанные типы уведомлений важно',
   'На странице «Уведомления» можно показать все или только непрочитанные и отфильтровать по типу: «Заявки», «Задачи», «Обучение», «Вопросы», «Объявления», «Важно», «Готово», «Инфо». Кнопка «Прочитать все» отмечает всё прочитанным. Уведомления «Важно» – это напоминания и предупреждения, их стоит открыть в первую очередь.'),
  ('notifications', 4, 'Сообщения и объявления', 'сообщения чат новое сообщение объявления лента не пришло уведомление',
   'Новые сообщения в чатах отмечаются отдельным счётчиком у раздела «Сообщения», а не в колокольчике. Обычные объявления публикуются в ленте «Объявления», уведомлением приходят только закреплённые и срочные. Если ожидаемое уведомление не пришло, проверьте статус в карточке заявки или задачи.'),

  -- ---------- academy-practice ----------
  ('academy-practice', 1, 'Из чего состоит курс', 'курс уроки статья видео практика из чего состоит сколько длится курс',
   'Курс в Jana Academy состоит из уроков трёх видов: статья, видео (ролик YouTube прямо в уроке) и практика. Уроки проходятся по порядку, прогресс сохраняется, можно остановиться и вернуться позже. Длительность в карточке курса складывается из времени уроков и примерно минуты на каждый вопрос итогового теста.'),
  ('academy-practice', 2, 'Практика с мгновенной проверкой', 'практика вопросы в уроке проверка ответа объяснение ошибся неправильно ответил мини-тест',
   'В уроках-практиках есть короткие вопросы: ответ проверяется сразу, и вы видите объяснение. Если ошиблись, попробуйте ещё раз; правильный вариант показывается после верного ответа или после третьей попытки. Урок засчитывается, когда на все его вопросы дан верный ответ. Ответы в практике не влияют на итоговый балл, это тренировка.'),
  ('academy-practice', 3, 'Итоговый тест и проходной балл', 'итоговый тест проходной балл сколько нужно набрать пересдать попытки не сдал тест',
   'Итоговый тест открывается, когда пройдены все уроки курса. Проходной балл указан в курсе: 70% для «Добро пожаловать в Jana Post» и «Стандарты клиентского сервиса», 80% для «Охрана труда на складе и в ПВЗ» и «Информационная безопасность и персональные данные». Количество попыток не ограничено: если не набрали балл, повторите уроки и пересдайте. В курсе сохраняется ваш лучший результат.'),
  ('academy-practice', 4, 'Сертификат и задача «Пройти курс»', 'сертификат где взять сертификат задача пройти курс закрылась сама обязательный курс срок',
   'После успешного теста курс получает статус «Пройден», приходит уведомление, а сертификат доступен на странице курса в Jana Academy («Мой сертификат»). Если курс назначен со сроком, у вас есть задача «Пройти курс» с кнопкой перехода; она закрывается сама после сдачи теста. Просроченные обязательные курсы видны руководителю и HR.'),

  -- ---------- overtime ----------
  ('overtime', 1, 'Что считается сверхурочной работой', 'что такое сверхурочная работа переработка задержался после смены остался согласие',
   'Сверхурочная работа – это работа по инициативе работодателя сверх установленной продолжительности рабочего времени. Привлекать к ней можно только с письменного согласия работника, кроме исключительных случаев из ст. 77 ТК РК, например устранения аварии или неявки сменщика, когда работу нельзя прервать. Если вы остались после смены по своей инициативе, без распоряжения руководителя, такие часы сверхурочными не считаются, поэтому задержку заранее согласуйте со старшим смены.'),
  ('overtime', 2, 'Лимиты сверхурочных часов', 'сколько можно перерабатывать лимит часов в день в месяц в год максимум сверхурочных',
   'Сверхурочные работы не должны превышать для каждого работника двух часов в сутки, а на тяжёлых работах и работах с вредными или опасными условиями труда – одного часа (ст. 78 ТК РК). Общая продолжительность сверхурочных работ не должна превышать 12 часов в месяц при четырёх-, пяти- и шестидневной рабочей неделе и 120 часов в год при суммированном учёте рабочего времени. Ограничения не распространяются на работы при чрезвычайных ситуациях и при оказании экстренной помощи людям.'),
  ('overtime', 3, 'Кого нельзя привлекать к сверхурочной работе', 'беременная несовершеннолетний инвалидность нельзя привлекать к сверхурочной',
   'К сверхурочной работе не допускаются беременные женщины, предоставившие работодателю справку о беременности, работники младше 18 лет и лица с инвалидностью (ст. 77 ТК РК). Если это касается вас, сообщите руководителю и HR, чтобы график составлялся без сверхурочных часов.'),
  ('overtime', 4, 'Оплата или время отдыха', 'как оплачивается переработка в полуторном размере отгул вместо денег сколько платят за сверхурочные',
   'При повременной оплате сверхурочная работа оплачивается не ниже чем в полуторном размере дневной (часовой) ставки, при сдельной – с доплатой не менее 50% дневной (часовой) ставки (ст. 108 ТК РК). По соглашению сторон вместо повышенной оплаты можно получить время отдыха: не менее одного часа отдыха за каждый час сверхурочной работы. Оплата сверхурочных отражается в расчётном листке отдельной строкой.'),
  ('overtime', 5, 'Как оформляются сверхурочные в Jana Post', 'как оформить сверхурочные служебная записка табель учет не оплатили переработку',
   'Руководитель заранее предлагает сверхурочные часы, работник подписывает согласие. Старший смены отмечает фактические часы в табеле, руководитель передаёт служебную записку в HR, HR оформляет приказ в 1С:ЗУП, и оплата приходит с ближайшей выплатой заработной платы. Если часы не учли, задайте вопрос HR через AI Jana или напишите руководителю.'),

  -- ---------- night-work ----------
  ('night-work', 1, 'Какое время считается ночным', 'ночное время с какого часа ночные часы ночная смена сколько ночных часов',
   'Ночным считается время с 22:00 до 06:00 (ст. 76 ТК РК). В ночной смене склада и сортировки (20:00–08:00) ночными являются 8 часов, с 22:00 до 06:00. Именно эти часы оплачиваются в повышенном размере, остальные часы смены – по обычной ставке.'),
  ('night-work', 2, 'Оплата ночных часов', 'доплата за ночь сколько платят за ночные часы оплата ночной смены повышенная',
   'Каждый час работы в ночное время оплачивается в повышенном размере, не ниже чем в полуторном размере дневной (часовой) ставки (ст. 110 ТК РК). Конкретный размер доплаты определяется трудовым договором и Положением об оплате труда Jana Post. Если ночные часы пришлись на праздничный или выходной день, оплата за ночные часы и за работу в праздничный или выходной день начисляется отдельно.'),
  ('night-work', 3, 'Кого нельзя привлекать к ночной работе', 'беременная несовершеннолетний ребенок до семи лет инвалидность ночью нельзя согласие на ночные',
   'К работе ночью не допускаются работники младше 18 лет и беременные женщины, предоставившие справку о беременности. Работников с инвалидностью можно привлекать только с их письменного согласия и если это не запрещено по медицинскому заключению. Без письменного согласия нельзя привлекать к ночной работе женщин с детьми до семи лет, других лиц, воспитывающих таких детей без матери, и работников, воспитывающих детей с инвалидностью (ст. 76 ТК РК).'),
  ('night-work', 4, 'Ночные смены в Jana Post', 'график ночных смен поменяться ночной сменой перерыв ночью',
   'Ночные смены ставятся в график сменности заранее; поменяться сменой с коллегой можно по согласованию со старшим смены и руководителем. Перерывы в ночной смене предоставляются по тому же графику, что и в дневной. Если вы относитесь к категории, которую можно привлекать к ночной работе только с согласия, сообщите об этом руководителю и HR.'),

  -- ---------- shift-schedule ----------
  ('shift-schedule', 1, 'Сменная работа и график 2/2', 'сменный график 2/2 что такое смена график сменности дневная ночная две смены подряд',
   'Сменная работа устанавливается, когда производственный процесс длится дольше допустимой продолжительности ежедневной работы; продолжительность смены и порядок перехода из смены в смену определяются графиками сменности (ст. 73 ТК РК). На складе и в сортировке Jana Post действует график 2/2 по 12 часов: дневная смена 08:00–20:00, ночная 20:00–08:00. Работать две смены подряд запрещено, кроме случаев, прямо предусмотренных Трудовым кодексом.'),
  ('shift-schedule', 2, 'Суммированный учёт рабочего времени', 'суммированный учет что это учетный период норма часов за период переработка',
   'При сменном графике рабочее время учитывается суммированно: норма часов должна соблюдаться в среднем за учётный период, а не в каждую неделю (ст. 75 ТК РК). Учётным периодом может быть любой календарный период, но не больше года. В Jana Post для склада, сортировки и ПВЗ учётный период – календарный квартал (демо). Часы, отработанные по распоряжению работодателя сверх нормы учётного периода, учитываются как сверхурочные (см. статью «Сверхурочная работа»).'),
  ('shift-schedule', 3, 'Отдых между сменами и выходные', 'отдых между сменами сколько часов отдыха междусменный выходные при графике',
   'Ежедневный (междусменный) отдых не может быть меньше 12 часов (ст. 83 ТК РК), и при суммированном учёте это правило тоже обязательно. На непрерывных участках выходные дни предоставляются по графику сменности, поэтому они не всегда приходятся на субботу и воскресенье (ст. 84 ТК РК). Если после ночной смены вас просят выйти в дневную, напомните старшему смены о минимальном отдыхе.'),
  ('shift-schedule', 4, 'Кому суммированный учёт не применяется', 'несовершеннолетний беременная инвалидность первой группы ограничения суммированный учет',
   'Работников младше 18 лет нельзя привлекать к работе с суммированным учётом рабочего времени. Для беременных женщин он не применяется, если смена длится больше восьми часов, а для работников с инвалидностью первой группы не применяется совсем; для второй и третьей группы – если это запрещено медицинским заключением (ст. 75 ТК РК). Если это касается вас, сообщите HR: вам подберут другой режим работы.'),
  ('shift-schedule', 5, 'Где посмотреть график и как поменяться сменой', 'где посмотреть график смен поменяться сменой замена коллега',
   'График смен на месяц руководитель подразделения публикует не позднее чем за неделю до начала месяца (демо). Поменяться сменой с коллегой можно по согласованию со старшим смены и руководителем, замена фиксируется в табеле. Режим работы офиса и ПВЗ описан в статье «Режим работы».'),

  -- ---------- holidays-2026 ----------
  ('holidays-2026', 1, 'Государственные праздники и выходные дни', 'какие праздники в казахстане список праздников нерабочие дни рождество курбан айт',
   'Праздничные дни в Республике Казахстан являются нерабочими (ст. 5 Закона «О праздниках в Республике Казахстан»). Это День Республики 25 октября (национальный праздник), Новый год 1–2 января, Международный женский день 8 марта, День Конституции 15 марта, Наурыз мейрамы 21–23 марта, Праздник единства народа Казахстана 1 мая, День защитника Отечества 7 мая, День Победы 9 мая, День Столицы 6 июля и День Независимости 16 декабря. Кроме того, выходными днями при любом режиме работы являются 7 января (православное Рождество) и первый день Курбан айта (ст. 84 ТК РК).'),
  ('holidays-2026', 2, 'Если праздник выпал на выходной', 'праздник на выходной перенос выходного следующий рабочий день совпадение воскресенье',
   'Если выходной и праздничный день совпадают, выходным становится следующий после праздника рабочий день (ст. 5 Закона «О праздниках в Республике Казахстан»). Кроме того, уполномоченный орган по труду вправе переносить выходные дни на другие рабочие дни (ст. 85 ТК РК), но, по разъяснению Министерства труда от 19 марта 2026 года, в 2026 году таких переносов не будет. Например, День Республики 25 октября 2026 года выпадает на воскресенье, поэтому выходной – понедельник, 26 октября.'),
  ('holidays-2026', 3, 'Нерабочие дни в 2026 году', 'выходные 2026 когда отдыхаем календарь праздников 2026 наурыз май октябрь декабрь',
   'При пятидневной рабочей неделе в 2026 году нерабочие дни: 1–2 января; 7 января; 9 марта (за 8 марта, выпавшее на воскресенье); 23–25 марта (Наурыз; 24 и 25 марта – за 21 и 22 марта, выпавшие на выходные); 1 мая; 7 мая; 11 мая (за 9 мая, выпавшее на субботу); 27 мая (первый день Курбан айта); 6 июля; 26 октября (за День Республики, выпавший на воскресенье); 16 декабря. После принятия обновлённой Конституции День Конституции отмечается 15 марта, а 30 августа утратило статус праздника, поэтому 31 августа 2026 года было рабочим днём.'),
  ('holidays-2026', 4, 'Работа в праздничные и выходные дни', 'работа в праздник оплата в праздник полуторная двойная другой день отдыха смена выпала на праздник',
   'Работа в выходные и праздничные дни допускается с письменного согласия работника, кроме случаев, предусмотренных Трудовым кодексом (ст. 85 ТК РК). Она оплачивается в повышенном размере, не ниже чем в полуторном размере дневной (часовой) ставки (ст. 109 ТК РК); вместо этого по желанию работника ему может быть предоставлен другой день отдыха. Беременных женщин, предоставивших справку о беременности, к работе в выходные и праздничные дни не привлекают. Если ваша смена по графику выпадает на праздник, руководитель отметит это в табеле, а доплата придёт вместе с заработной платой.'),
  ('holidays-2026', 5, 'Праздники и ежегодный отпуск', 'праздник во время отпуска продлевается отпуск праздничные дни не входят в отпуск',
   'Праздничные дни, которые приходятся на период ежегодного оплачиваемого отпуска, в число дней отпуска не включаются, и JanaMen при расчёте заявки их не считает. Например, если ваш отпуск включает 25 октября, он станет на один календарный день длиннее, а с остатка спишется на день меньше.'),

  -- ---------- peak-season ----------
  ('peak-season', 1, 'Что такое пик и когда он', 'пик 11.11 когда пиковый сезон распродажа нагрузка объем посылок ноябрь декабрь',
   'После распродаж 11.11 объём отправлений растёт на 50–60%. Пиковый период в Jana Post – с 16 по 30 ноября; второй пик – с 10 по 28 декабря перед Новым годом. В эти даты склад консолидации в Урумчи, сортировочный центр, курьерская служба и ПВЗ работают по усиленному графику.'),
  ('peak-season', 2, 'Отпуска в пиковый период', 'можно ли взять отпуск в пик отпуск в ноябре отказали в отпуске ограничение 10 процентов',
   'В пиковые периоды в подразделениях склада, доставки и ПВЗ одновременно может отсутствовать не более 10% сотрудников смены, а отпуска на эти даты согласуются с директором по логистике. Поэтому заявку на отпуск в пик могут отклонить и предложить другие даты, например с 1 по 9 декабря или после 28 декабря. Планируйте отпуск заранее и подавайте заявку в JanaMen не позднее чем за 14 дней.'),
  ('peak-season', 3, 'Графики и переработки в пик', 'график в пик дополнительные смены переработки сверхурочные в пик оплата согласие',
   'Графики смен на пиковый период руководители публикуют не позднее 10 ноября (демо). Дополнительные смены и сверхурочные часы возможны только с вашего письменного согласия и в пределах лимитов Трудового кодекса, они оплачиваются в повышенном размере (см. статьи «Сверхурочная работа» и «Работа в ночное время»). Если чувствуете перегрузку, скажите руководителю: лучше перестроить график, чем ошибаться на сортировке.'),
  ('peak-season', 4, 'Временный персонал и наставники', 'временные сотрудники новички в пик наставник обучение временного персонала доплата за наставничество',
   'На пик компания привлекает временный персонал. Опытные операторы становятся наставниками временных сотрудников на смене, наставничество в пик оплачивается доплатой по приказу (демо). До выхода на смену временные сотрудники проходят курсы «Добро пожаловать в Jana Post» и «Охрана труда на складе и в ПВЗ».'),
  ('peak-season', 5, 'Поддержка сотрудников в пик', 'питание в пик горячее питание отдых забота усталость перерывы',
   'В пиковые дни на сортировочном центре организовано бесплатное горячее питание для всех смен (демо). Не пропускайте перерывы, даже когда много работы: усталость повышает риск ошибок и травм. О плохом самочувствии и перегрузке сразу сообщайте старшему смены.'),

  -- ---------- onboarding-first-week ----------
  ('onboarding-first-week', 1, 'Первый рабочий день', 'первый день что делать куда идти первый рабочий день документы пропуск спецодежда',
   'В первый день HR знакомит вас с компанией, вы подписываете трудовой договор и знакомитесь с Правилами внутреннего трудового распорядка в Documentolog. Сотрудники склада и ПВЗ получают спецодежду, СИЗ и пропуск и проходят вводный инструктаж по охране труда. Доступ в JanaMen выдаёт HR: проверьте свои данные и контакты в профиле.'),
  ('onboarding-first-week', 2, 'Наставник', 'наставник кто мой наставник к кому обращаться новичку помощь на смене',
   'Каждому новичку на складе, в сортировке, курьерской службе и ПВЗ назначается наставник из опытных сотрудников, обычно старший смены. Первые смены вы работаете рядом с ним: он показывает рабочее место, ТСД, зоны склада и правила безопасности. С рабочими вопросами сначала идите к наставнику, с кадровыми – в HR или к AI Jana.'),
  ('onboarding-first-week', 3, 'Курсы и задачи первой недели', 'какие курсы пройти новичку задачи первой недели чек-лист обучение адаптация',
   'В первую неделю вам назначают курсы «Добро пожаловать в Jana Post» и, для логистики, «Охрана труда на складе и в ПВЗ»; курс по охране труда нужно пройти до самостоятельной работы на складе. В разделе «Мои задачи» появятся чек-лист первой недели от HR и задачи от руководителя. Начинайте с задач с ближайшим дедлайном и отмечайте шаги чек-листа по мере выполнения.'),
  ('onboarding-first-week', 4, 'Итоги первой недели и испытательный срок', 'встреча по итогам недели обратная связь испытательный срок через месяц ошибки новичка',
   'В конце первой недели HR проводит короткую встречу: как прошли первые смены, всё ли понятно, нужна ли помощь. Через месяц руководитель обсуждает с вами итоги первых недель, а испытательный срок длится не более трёх месяцев. В первые дни ошибки ожидаемы; главное – сразу сообщать о них наставнику.'),

  -- ---------- unpaid-leave ----------
  ('unpaid-leave', 1, 'Отпуск по соглашению сторон', 'отпуск за свой счет без содержания взять отгул без оплаты по личным делам',
   'По письменному заявлению работника и по соглашению сторон может быть предоставлен отпуск без сохранения заработной платы; его продолжительность стороны определяют сами (ст. 97 ТК РК). В Jana Post такой отпуск согласует непосредственный руководитель, затем HR оформляет приказ в 1С:ЗУП. Подавайте заявление заранее, чтобы руководитель успел перестроить график смен.'),
  ('unpaid-leave', 2, 'Когда работодатель обязан предоставить отпуск', 'свадьба регистрация брака рождение ребенка смерть родственника похороны пять дней обязан дать отпуск',
   'По уведомлению работника работодатель обязан предоставить отпуск без сохранения заработной платы продолжительностью до пяти календарных дней при регистрации брака, рождении ребёнка, смерти близких родственников или родственников супруга (супруги), а также в других случаях, предусмотренных трудовым или коллективным договором (ст. 97 ТК РК). В этих случаях отказать нельзя, но сообщите руководителю как можно раньше, чтобы он нашёл замену на смену.'),
  ('unpaid-leave', 3, 'Отпуск для пострадавших от бытового насилия', 'бытовое насилие кризисный центр специальные социальные услуги отпуск тридцать дней',
   'На время нахождения в организации, оказывающей специальные социальные услуги жертвам бытового насилия, работодатель обязан предоставить отпуск без сохранения заработной платы до 30 календарных дней (ст. 97 ТК РК). Для этого нужно письменное уведомление с указанием продолжительности отпуска и копия договора с такой организацией. HR рассматривает такие обращения конфиденциально.'),
  ('unpaid-leave', 4, 'Как оформить', 'как оформить отпуск без содержания заявление документы приказ',
   'Отдельного типа заявки на отпуск без сохранения заработной платы в JanaMen пока нет: напишите заявление на имя руководителя и передайте его в HR или задайте вопрос HR через AI Jana. Для обязательного отпуска на пять дней приложите подтверждающий документ, например свидетельство о браке или о рождении ребёнка. О готовности приказа придёт уведомление, ознакомиться с ним нужно в Documentolog.'),

  -- ---------- study-leave ----------
  ('study-leave', 1, 'Кому и для чего предоставляется', 'учебный отпуск кому положен сессия экзамены зачеты диплом учусь заочно',
   'Работникам, которые обучаются в организациях образования, предоставляются учебные отпуска для подготовки и сдачи зачётов и экзаменов, выполнения лабораторных работ, подготовки и защиты дипломной работы (проекта), а также для прохождения программ подготовки военно-обученного резерва (ст. 98 ТК РК). Работникам, направленным на обучение или стажировку за рубежом по международной стипендии «Болашак», учебный отпуск предоставляется с сохранением места работы (должности).'),
  ('study-leave', 2, 'Оплачивается ли учебный отпуск', 'оплачивается ли учебный отпуск сохраняется зарплата за свой счет оплата сессии',
   'Трудовой кодекс не устанавливает размер оплаты учебного отпуска: она определяется соглашениями, коллективным и трудовым договорами или договором обучения (ст. 98 ТК РК). В Jana Post учебный отпуск предоставляется без сохранения заработной платы, если иное не предусмотрено вашим трудовым договором или договором обучения, по которому компания направила вас учиться (демо). Ваши условия можно уточнить в HR.'),
  ('study-leave', 3, 'Как оформить учебный отпуск', 'как оформить учебный отпуск справка-вызов документы заранее',
   'Как только узнаете даты сессии, предупредите руководителя, чтобы он учёл их в графике смен. Затем передайте в HR заявление и справку-вызов из учебного заведения с датами сессии. HR оформит приказ в 1С:ЗУП, ознакомиться с ним нужно в Documentolog.'),
  ('study-leave', 4, 'Учёба и сменный график', 'учеба и работа график смен поменять смены во время сессии обучение за счет компании',
   'Если вы учитесь и работаете по сменному графику, руководитель по возможности учитывает дни занятий при составлении графика. Обучение, на которое вас направляет компания, оформляется договором обучения, в нём прописываются условия оплаты и учебного отпуска. Курсы Jana Academy проходятся в рабочее время и учебного отпуска не требуют.'),

  -- ---------- maternity ----------
  ('maternity', 1, 'Отпуск по беременности и родам: сроки', 'декрет сколько дней декретный отпуск беременность роды когда уходить в декрет 70 дней',
   'Отпуск по беременности и родам предоставляется продолжительностью 70 календарных дней до родов и 56 дней после родов, а при осложнённых родах или рождении двух и более детей – 70 дней после родов (ст. 99 ТК РК). Для женщин, проживающих на территориях, пострадавших от ядерных испытаний, – 91 день до родов и 79 дней после (93 дня при осложнённых родах или рождении двух и более детей). Отпуск начинается с даты, указанной в листке временной нетрудоспособности, который оформляет медицинская организация. Если отпуск оформлен во время беременности, он предоставляется полностью, независимо от стажа работы.'),
  ('maternity', 2, 'Кто выплачивает и как рассчитывается', 'кто платит декретные пособие по беременности гфсс социальная выплата сколько заплатят расчет декретных',
   'За период отпуска по беременности и родам социальную выплату на случай потери дохода назначает и выплачивает Государственный фонд социального страхования (ГФСС). Её размер зависит от среднемесячного дохода за последние 12 месяцев, с которого уплачивались социальные отчисления, и от количества дней по листку временной нетрудоспособности; из суммы удерживаются обязательные пенсионные взносы. Работодатель дополнительно оплачивает этот отпуск, только если это предусмотрено трудовым или коллективным договором либо актом работодателя, и тогда из оплаты вычитается выплата ГФСС (ст. 99 ТК РК). Предусмотрена ли такая доплата в вашем трудовом договоре, уточните в HR.'),
  ('maternity', 3, 'Как оформить: документы и заявление', 'как оформить декрет документы куда подавать egov листок нетрудоспособности заявление на выплату',
   'Медицинская организация оформляет листок временной нетрудоспособности и вносит данные в регистр беременных; сообщите номер листка в HR, и HR оформит приказ об отпуске в 1С:ЗУП. Заявление на выплату ГФСС подаётся онлайн на egov.kz или в приложении eGov mobile, решение приходит в личный кабинет, срок рассмотрения – до 8 рабочих дней. Для онлайн-заявки нужны актуальные сведения о вас в единой системе учёта трудовых договоров, поэтому сообщите HR о предстоящем отпуске заранее.'),
  ('maternity', 4, 'Отпуск по уходу за ребёнком до трёх лет', 'отпуск по уходу за ребенком до трех лет кто может взять отец папа частями выйти раньше усыновление',
   'Отпуск без сохранения заработной платы по уходу за ребёнком до достижения им трёх лет предоставляется по выбору родителей матери или отцу, родителю, который воспитывает ребёнка один, опекуну или другому родственнику, фактически воспитывающему ребёнка, а также работнику, усыновившему новорождённого (ст. 100 ТК РК). Отпуск можно использовать полностью или частями; нужно письменное заявление с указанием срока и копия свидетельства о рождении ребёнка. Место работы (должность) на время отпуска сохраняется, а о выходе на работу до его окончания нужно предупредить работодателя за один месяц. Усыновителю новорождённого также предоставляется отпуск со дня усыновления до истечения 56 дней со дня рождения ребёнка (ст. 99 ТК РК).'),
  ('maternity', 5, 'Выплаты по уходу за ребёнком', 'выплата по уходу до полутора лет 40 процентов сколько платят по уходу пособие на рождение',
   'Во время отпуска по уходу ГФСС назначает социальную выплату на случай потери дохода в связи с уходом за ребёнком до достижения им полутора лет: 40% среднемесячного дохода за последние 24 месяца, с которого уплачивались социальные отчисления, за вычетом пенсионных взносов. Обратиться можно через egov.kz, приложения ряда банков или ЦОН; на рождение ребёнка также назначается единовременное государственное пособие. Эти выплаты начисляет не работодатель, но HR поможет с документами о работе и доходе.'),

  -- ---------- ppe ----------
  ('ppe', 1, 'Кому и что выдаётся', 'что выдают спецодежда форма склад курьер пвз комплект перчатки ботинки жилет каска',
   'Сотрудникам склада и сортировки выдаются куртка и жилет со светоотражающими элементами, защитная обувь с металлическим подноском и перчатки; водителям погрузчиков дополнительно выдаётся каска. Курьеры получают фирменную куртку, жилет и термосумку, операторы ПВЗ – фирменную форму. Всё выдаётся бесплатно в первый рабочий день под подпись у кладовщика (демо).'),
  ('ppe', 2, 'Сроки носки и замена', 'срок носки сколько носить замена порвалась испортилась новая спецодежда поменять размер',
   'Сроки носки (демо): перчатки – 1 месяц, защитная обувь – 12 месяцев, жилет – 12 месяцев, утеплённая куртка – 24 месяца, форма ПВЗ – 12 месяцев. Если вещь пришла в негодность раньше срока не по вашей вине, её заменят: сообщите руководителю, он передаст заявку кладовщику. Размер можно поменять в течение двух недель после выдачи.'),
  ('ppe', 3, 'Когда СИЗ обязательны', 'обязательно носить без спецодежды не пустят каска погрузчик правила зона сортировки',
   'В зоне сортировки, на складе и в зоне работы погрузчиков нельзя находиться без защитной обуви и светоотражающего жилета: старший смены не допустит к работе. Правила подробно разобраны в курсе «Охрана труда на складе и в ПВЗ» в Jana Academy. Если СИЗ мешают или натирают, не снимайте их, а попросите старшего смены подобрать другой размер или модель.'),
  ('ppe', 4, 'Возврат при увольнении', 'вернуть спецодежду при увольнении обходной лист потерял спецодежду',
   'При увольнении спецодежда и СИЗ, срок носки которых не истёк, сдаются кладовщику по обходному листу. Перчатки и другие расходные СИЗ не возвращаются. Если вещь утеряна, порядок действий подскажет HR.'),

  -- ---------- access-pass ----------
  ('access-pass', 1, 'Как получить пропуск', 'получить пропуск первый день оформить пропуск фото где взять пропуск временный',
   'Постоянный пропуск оформляет служба безопасности в первый рабочий день по заявке HR: нужен документ, удостоверяющий личность, фото делают на месте. До выдачи постоянного пропуска действует временный, на 5 рабочих дней. Пропуск именной, передавать его другим нельзя.'),
  ('access-pass', 2, 'Зоны доступа', 'зоны доступа куда можно проходить склад таможня ценные грузы офис нет доступа',
   'Уровень доступа зависит от должности: сотрудники склада проходят в зоны приёмки, хранения и отгрузки, офисные сотрудники – в офис и переговорные. Зона таможенного контроля и зона ценных отправлений открыты только по отдельному списку. Если для задачи нужен доступ в другую зону, руководитель запрашивает временный доступ у службы безопасности.'),
  ('access-pass', 3, 'Гости и подрядчики', 'пригласить гостя пропуск для гостя подрядчик посетитель',
   'Гостевой пропуск заказывается не позднее чем за рабочий день: сообщите службе безопасности ФИО гостя, дату и время визита. Гостя встречает и сопровождает пригласивший сотрудник. На склад гостей проводят только в жилете и защитной обуви.'),
  ('access-pass', 4, 'Если пропуск потерян или забыт', 'потерял пропуск забыл пропуск дома украли пропуск не работает пропуск турникет',
   'Если пропуск потерян или украден, сразу сообщите в службу безопасности и руководителю: пропуск заблокируют, чтобы им никто не воспользовался. Новый пропуск выдаётся в течение 1 рабочего дня, на это время оформят временный. Если пропуск остался дома, на посту охраны выдадут разовый пропуск на смену по удостоверению личности.'),

  -- ---------- it-support ----------
  ('it-support', 1, 'Как обратиться в IT-поддержку', 'айти поддержка куда обращаться не работает компьютер программа сломалось wms',
   'IT-поддержка работает ежедневно с 08:00 до 22:00, в ночные смены для склада и сортировки дежурит инженер. Напишите на it@jana.test или позвоните по внутреннему номеру 1010 (демо). Опишите проблему, укажите устройство и, если можно, приложите фото экрана. Проблемы, которые останавливают смену, решаются в первую очередь.'),
  ('it-support', 2, 'Сброс пароля', 'забыл пароль сбросить пароль не могу войти заблокировали учетную запись смена пароля',
   'Если забыли пароль от рабочей учётной записи (почта, WMS), обратитесь в IT-поддержку: пароль сбрасывают после подтверждения личности. Пароль нужно менять раз в 90 дней, он должен содержать не меньше 12 символов, буквы в разных регистрах и цифры (демо). Никому не сообщайте пароль, в том числе тем, кто представляется сотрудником IT: настоящая поддержка пароль не спрашивает.'),
  ('it-support', 3, 'Поломка или потеря ТСД', 'тсд сломался потерял тсд сканер не сканирует разбился разрядился терминал',
   'ТСД (терминал сбора данных) выдаётся на смену под подпись у старшего смены и в конце смены ставится на зарядку. Если ТСД не включается или не сканирует, возьмите резервный у старшего смены и сообщите в IT-поддержку. О потере или повреждении ТСД сразу скажите старшему смены и руководителю: устройство заблокируют удалённо. Не пытайтесь чинить ТСД сами.'),
  ('it-support', 4, 'Потеря рабочего телефона или ноутбука', 'потерял телефон украли ноутбук рабочий телефон курьера потеря устройства данные клиентов',
   'Если потерян рабочий телефон курьера, ноутбук или другое устройство с доступом к данным клиентов, в течение часа сообщите в IT-поддержку и руководителю. IT заблокирует устройство и сменит доступы, чтобы защитить персональные данные клиентов. Если на потерянном личном телефоне была рабочая почта, тоже сообщите в IT. Правила защиты данных разобраны в курсе «Информационная безопасность и персональные данные».'),

  -- ---------- ethics-gifts ----------
  ('ethics-gifts', 1, 'Можно ли принимать подарки', 'можно ли принять подарок от клиента шоколадка цветы сувенир благодарность',
   'Можно принимать символические знаки благодарности стоимостью до 5 000 тенге: конфеты, цветы, открытку, сувенир (демо). Нельзя принимать деньги, подарочные сертификаты и подарки в обмен на особое отношение: выдачу без очереди или без проверки документов, изменение статуса отправления. Если сомневаетесь, вежливо откажитесь и сообщите руководителю.'),
  ('ethics-gifts', 2, 'Чаевые курьерам и операторам ПВЗ', 'чаевые курьеру можно брать чаевые деньги от клиента',
   'Курьеры и операторы ПВЗ не принимают денежные чаевые. Поблагодарите клиента и предложите оставить отзыв в приложении Jana Post: отзывы учитываются в конкурсе «Лучший сотрудник месяца». Оплата наличными за отправления принимается только с выдачей чека.'),
  ('ethics-gifts', 3, 'Конфликт интересов', 'конфликт интересов родственник работает поставщик подрядчик своя фирма подработка',
   'Конфликт интересов возникает, когда личный интерес может влиять на рабочие решения: например, вы выбираете подрядчика, где работает родственник, или руководите близким человеком. О такой ситуации нужно заранее письменно сообщить руководителю и HR. Подработка у конкурентов, перевозчиков и маркетплейсов, с которыми работает Jana Post, согласуется с HR.'),
  ('ethics-gifts', 4, 'Куда сообщить о нарушении', 'сообщить о нарушении анонимно линия доверия взятка вымогательство давление',
   'О предложении взятки, давлении или нарушении этики можно сообщить руководителю, HR или анонимно на линию доверия ethics@jana.test (демо). Обращения рассматриваются конфиденциально, преследовать сотрудника за добросовестное сообщение запрещено.'),

  -- ---------- manager-tasks ----------
  ('manager-tasks', 1, 'Как поставить задачу', 'поставить задачу сотруднику новая задача всей команде нескольким сотрудникам поставлены мной',
   'В разделе «Задачи» нажмите «Новая задача», напишите, что сделать, и добавьте описание: зачем это нужно, что считать результатом и к кому обращаться. Выберите одного или нескольких исполнителей из своей команды или отметьте «Всей команде»: каждый получит свою копию задачи и уведомление. Поставленные вами задачи собраны на вкладке «Поставлены мной».'),
  ('manager-tasks', 2, 'Какой тип задачи выбрать', 'какой тип задачи выбрать обычная отчет чек-лист пройти курс когда что выбрать',
   'Обычная задача подходит для простых поручений, где достаточно отметки «Готово». Отчёт выбирайте, когда нужен проверяемый результат: фото зоны, таблица сверки, акт расхождений. Чек-лист удобен для многошаговых процедур (инвентаризация, приёмка рейса, адаптация новичка), по нему виден прогресс. «Пройти курс» связывает задачу с курсом Jana Academy: если курс ещё не назначен, он назначится вместе с задачей, а задача закроется сама после сдачи теста.'),
  ('manager-tasks', 3, 'Дедлайн и приоритет', 'дедлайн время приоритет звезды срочно как выбрать срок перенести срок исполнителю',
   'Ставьте дедлайн с реальным временем, привязанным к смене исполнителя, например к концу смены, а не к полуночи. Приоритет «срочно» (четыре звезды) используйте только для того, что останавливает работу, иначе команда перестанет ему доверять. Если исполнитель просит перенести срок, измените дедлайн в карточке и оставьте комментарий с причиной.'),
  ('manager-tasks', 4, 'Приём и возврат отчётов', 'принять отчет вернуть на доработку проверить задачу на проверке комментарий',
   'Когда исполнитель отправляет отчёт, вам приходит уведомление «Задача на проверке». Откройте задачу, посмотрите результат и вложения и примите её или верните на доработку. При возврате обязательно напишите, что именно доработать: задача вернётся в «В работе», а исполнитель получит уведомление с вашим комментарием. Принимать отчёты может постановщик, руководитель исполнителя или HR; старайтесь проверять их в течение рабочего дня.'),
  ('manager-tasks', 5, 'Просрочки в команде', 'просроченные задачи команды контроль просрочек нагрузка сотрудника',
   'Просроченные задачи выделяются в списке задач команды, и HR тоже видит их в мониторинге. Прежде чем напоминать, выясните причину: часто это перегрузка или неясная постановка. Если задача потеряла актуальность, закройте её с комментарием, чтобы она не висела в просрочке.'),

  -- ---------- manager-newbie ----------
  ('manager-newbie', 1, 'До выхода новичка', 'подготовка к выходу новичка рабочее место спецодежда пропуск назначить наставника',
   'За 2–3 дня до выхода нового сотрудника назначьте наставника, сообщите кладовщику размеры спецодежды и попросите службу безопасности подготовить пропуск. Поставьте новичку в JanaMen задачи первой недели с понятными дедлайнами, а HR назначит курсы адаптации. В «Пульсе компании» HR видит новичков без назначенного курса адаптации.'),
  ('manager-newbie', 2, 'Первая неделя', 'первая неделя новичка что делать руководителю задачи новичку обратная связь отчет о смене',
   'В первые смены новичок работает рядом с наставником. Ставьте задачи по нарастающей: сначала знакомство с зонами склада и ТСД, затем самостоятельная работа на одном участке. Короткий отчёт о первой смене (тип задачи «Отчёт») помогает увидеть, что осталось непонятным. Следите за обязательными курсами: «Охрана труда на складе и в ПВЗ» нужно пройти до самостоятельной работы на складе.'),
  ('manager-newbie', 3, 'Итоги месяца и испытательного срока', 'итоги испытательного срока встреча через месяц оценка новичка решение',
   'Через месяц проведите встречу один на один: что получается, где нужна помощь, как работает наставник. За две недели до окончания испытательного срока сообщите HR своё решение и его обоснование. Если есть сомнения, обсудите их с HR заранее, не дожидаясь последнего дня.'),

  -- ---------- hr-bulk-reminders ----------
  ('hr-bulk-reminders', 1, 'Что показывает «Зона внимания»', 'зона внимания пульс компании сигналы что показывает отпуск обучение новичок',
   'На главной странице HR («Пульс компании») блок «Зона внимания» собирает сигналы: у сотрудника накоплено больше 30 дней отпуска, просрочено обязательное обучение, заявка висит у руководителя больше 48 часов, новичок без курса адаптации. Рядом с каждым сигналом есть быстрое действие: «Напомнить», «Поторопить» или «Назначить курс».'),
  ('hr-bulk-reminders', 2, 'Массовые действия', 'массово отправить напоминание всем выбрать несколько сразу пачкой поторопить назначить курс',
   'Отметьте нужные строки и выполните действие для всех сразу: каждый сотрудник получит своё уведомление со ссылкой на нужный раздел, например на заявку на отпуск или на курс в Jana Academy. Напоминания об отпуске и о курсах приходят с отметкой «Важно». «Поторопить» отправляет напоминание руководителю, у которого висит заявка, а «Назначить курс» назначает новичку курс «Добро пожаловать в Jana Post» со сроком 7 дней, и у него появляется задача «Пройти курс».'),
  ('hr-bulk-reminders', 3, 'Своё напоминание группе', 'свое напоминание группе текст напоминания произвольное уведомление отделу',
   'Если нужен свой текст, отправьте собственное напоминание: выберите сотрудников, напишите заголовок, текст и при необходимости ссылку на раздел JanaMen. HR может отправлять напоминания любым сотрудникам, руководитель – только своей команде. Пишите конкретно: что сделать, до какого срока и куда нажать.'),
  ('hr-bulk-reminders', 4, 'Как не перегружать сотрудников', 'как часто напоминать повторное напоминание спам слежу журнал напоминаний',
   'Все отправленные напоминания фиксируются в журнале, поэтому перед повторным проверьте, когда было предыдущее. Рекомендуем напоминать об одном и том же не чаще раза в 3 рабочих дня, а после второго напоминания связаться с руководителем сотрудника. Для постоянного контроля добавьте сотрудника в «Слежу»: о его просрочках вы будете получать уведомление раз в день.');

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

insert into public.tasks (title, description, assignee_id, created_by, priority, status, category, kind, checklist, due_at,
                          result_note, submitted_at, created_at, started_at, completed_at) values

  -- ---------- Дана Жумабекова (JP-0013) – задачи от Ерлана Сапарова ----------
  ('Инвентаризация зоны B-12',
   E'**Зачем.** По WMS в зоне B-12 расхождение 14 мест после пересорта на прошлой неделе. Перед пиком 11.11 остатки должны быть точными, иначе отправления «теряются» при отборе.\n\n**Что сделать.**\n- пересчитать ячейки B-12-01 – B-12-40 вдвоём с напарником;\n- сверить результат с остатками в WMS;\n- расхождения внести в лист пересчёта и в акт.\n\n**Готово, когда** отмечены все шаги чек-листа, а лист пересчёта сдан Бауыржану Утепову для сверки.\n\n**Вопросы** – мне в «Сообщения».',
   seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'medium', 'todo', 'warehouse', 'checklist',
   '[{"text":"Получить лист пересчёта и заряженный ТСД у старшего смены","done":false},{"text":"Пересчитать ячейки B-12-01 – B-12-20","done":false},{"text":"Пересчитать ячейки B-12-21 – B-12-40","done":false},{"text":"Сверить результат с остатками в WMS","done":false},{"text":"Внести расхождения в акт и передать Бауыржану Утепову","done":false}]'::jsonb,
   ((current_date + 2) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '1 day', null, null),

  ('Провести инструктаж новичка по работе с ТСД',
   E'**Зачем.** Тимур Ахметов работает пятый день и пока сканирует только под присмотром. К субботней инвентаризации он должен уверенно работать с ТСД сам.\n\n**Что сделать.** Показать на реальных отправлениях:\n- вход в WMS и выбор участка;\n- сканирование мест при приёмке;\n- пересорт и перемещение между ячейками;\n- маркировку повреждённых мест.\n\n**Готово, когда** Тимур самостоятельно обработает 20 отправлений без ошибок, а все шаги чек-листа отмечены.\n\n**Вопросы** – ко мне. Если не хватает времени в смене, скажи: сниму с тебя часть приёмки.',
   seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'high', 'in_progress', 'warehouse', 'checklist',
   '[{"text":"Выдать ТСД и показать вход в WMS","done":true},{"text":"Показать сканирование мест при приёмке","done":true},{"text":"Отработать пересорт и перемещение между ячейками","done":true},{"text":"Показать маркировку повреждённых мест","done":false},{"text":"Принять у Тимура 20 отправлений без ошибок","done":false}]'::jsonb,
   ((current_date + 1) + time '17:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '3 days', now() - interval '2 days', null),

  ('Отчёт по ошибкам сортировки за неделю',
   E'**Зачем.** В пик 11.11 каждая ошибка сортировки – это посылка, уехавшая не в тот город, и лишние 2–3 дня для клиента. Хочу до начала пика понять, где мы ошибаемся чаще всего.\n\n**Что сделать.**\n- выгрузить из WMS ошибки сортировки смены А за последние 7 дней;\n- сгруппировать их по причинам: неверное направление, нечитаемая этикетка, пересорт;\n- предложить 2–3 меры, которые снизят число ошибок.\n\n**Результат:** вывод и цифры в поле отчёта, таблицу можно приложить файлом.\n\n**Готово, когда** я приму отчёт. Вопросы – в комментариях к задаче.',
   seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'medium', 'review', 'warehouse', 'report',
   '[]'::jsonb,
   ((current_date + 1) + time '12:00') at time zone 'Asia/Almaty',
   'За неделю 38 ошибок сортировки (около 0,4% обработанных мест). Причины: нечитаемые или мятые этикетки на рейсах из Урумчи – 17, неверное направление на стыке смен – 12, пересорт в зоне возвратов – 9. По дням: пн 6, вт 5, ср 7, чт 4, пт 8, сб 5, вс 3. Предлагаю: 1) печатать дубль этикетки на приёмке для мятых мест; 2) проводить пятиминутку с разбором направлений при передаче смены; 3) закрепить за зоной возвратов одного оператора на смену.',
   now() - interval '3 hours', now() - interval '4 days', now() - interval '2 days', null),

  ('Приёмка утреннего рейса из Урумчи',
   E'**Зачем.** Олжас Кенжебаев сегодня на обучении по охране труда, а утренний рейс со склада консолидации в Урумчи нужно принять без задержек: в нём отправления маркетплейсов с доставкой на завтра.\n\n**Что сделать.**\n- принять рейс у водителя, проверить пломбы и количество мест по манифесту;\n- отсканировать все места в WMS;\n- повреждённые места отложить в зону претензий и сфотографировать;\n- передать места на сортировку.\n\n**Готово, когда** все места рейса в WMS в статусе «Принято», а расхождения, если они есть, переданы Бауыржану Утепову для акта.\n\n**Вопросы** – по составу рейса к Ли Вэю (склад в Урумчи), по складу – ко мне.',
   seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'high', 'in_progress', 'logistics', 'simple',
   '[]'::jsonb,
   (current_date + time '20:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '26 hours', now() - interval '3 hours', null),

  ('Проверить и зарядить ТСД перед инвентаризацией',
   E'**Зачем.** В субботу пересчитываем зоны B и C, и каждый разряженный или зависший ТСД – минус пара людей на пересчёте.\n\n**Что сделать.**\n- проверить все 12 ТСД смены А: включаются, сканируют, есть вход в WMS;\n- поставить на зарядку запасные аккумуляторы;\n- неисправные ТСД передать в IT-поддержку (внутренний 1010) и отметить в журнале выдачи.\n\n**Готово, когда** на стойке старшего смены 12 исправных ТСД и 6 заряженных запасных аккумуляторов.\n\nЕсли после обновления прошивки ТСД ведёт себя странно, пиши в IT сразу, не жди субботы.',
   seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'urgent', 'todo', 'warehouse', 'simple',
   '[]'::jsonb,
   ((current_date + 1) + time '08:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '20 hours', null, null),

  ('Разобрать паллеты с пересортом в зоне возвратов',
   E'**Зачем.** В зоне возвратов скопились 3 паллеты с пересортом. Пока они стоят, остатки в WMS не сходятся, и это сорвёт субботнюю инвентаризацию.\n\n**Что сделать.**\n- разобрать паллеты по направлениям;\n- отправления с верным адресом вернуть на сортировку;\n- отправления без этикетки отложить в зону претензий и передать список Камиле Абдрахмановой в клиентский сервис.\n\n**Готово, когда** зона возвратов свободна, а список проблемных отправлений передан.\n\nЕсли не успеваешь из-за приёмки рейса, напиши мне – перенесём срок или дам помощника.',
   seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'medium', 'in_progress', 'warehouse', 'simple',
   '[]'::jsonb,
   ((current_date - 1) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '5 days', now() - interval '3 days', null),

  ('Подготовить зону отгрузки к пику 11.11',
   E'**Зачем.** С 16 ноября объём вырастет на 50–60%, и узким местом станет зона отгрузки: у ворот одновременно встают до 6 машин. Подготовить её нужно заранее, пока поток обычный.\n\n**Что сделать** – по шагам чек-листа. Схему расстановки согласуй со мной до того, как двигать стеллажи.\n\n**Готово, когда** все шаги отмечены, а в зоне отгрузки размечены 6 мест под машины и буфер на 20 паллет.\n\n**Вопросы** – ко мне, по работе погрузчиков – к Мирасу Жаксылыкову.',
   seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'high', 'todo', 'logistics', 'checklist',
   '[{"text":"Набросать схему расстановки и согласовать с Ерланом Сапаровым","done":false},{"text":"Освободить буферную зону у ворот 3–4 от пустых паллет","done":false},{"text":"Разметить 6 мест под машины и буфер на 20 паллет","done":false},{"text":"Повесить таблички направлений: Астана, Караганда, Шымкент, Алматы-город","done":false},{"text":"Проверить освещение и сканеры на воротах","done":false}]'::jsonb,
   ((current_date + 8) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '2 days', null, null),

  ('Обновить схему зон склада на стенде у входа',
   E'**Зачем.** После перестановки стеллажей в зоне C старая схема на стенде сбивает с толку новичков и временный персонал.\n\n**Что сделать.**\n- распечатать актуальную схему зон A–D из WMS в формате A2;\n- отметить пешеходные коридоры и зоны работы погрузчиков;\n- заменить схему на стенде у входа и у стойки старшего смены.\n\n**Готово, когда** обе схемы заменены. Сфотографируй стенд и отправь мне в чат.',
   seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'low', 'done', 'warehouse', 'simple',
   '[]'::jsonb,
   ((current_date - 3) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '8 days', now() - interval '6 days', now() - interval '4 days'),

  -- ---------- Дана – личная задача ----------
  ('Подготовить вопросы к встрече один на один с руководителем',
   E'**Зачем.** На встрече один на один с Ерланом хочу обсудить развитие и нагрузку в пик, а не вспоминать всё на ходу.\n\n**Что подготовить:**\n- итоги месяца: инструктаж Тимура, отчёт по ошибкам сортировки;\n- можно ли пройти обучение наставников и получить доплату за наставничество в пик;\n- отпуск: перенести отклонённые ноябрьские даты на декабрь, между пиками;\n- идея: закрепить одного оператора за зоной возвратов.\n\n**Готово, когда** список вопросов готов и отправлен Ерлану накануне встречи.',
   seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0013'), 'low', 'todo', 'general', 'simple',
   '[]'::jsonb,
   ((current_date + 3) + time '10:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '1 day', null, null),

  -- ---------- Тимур Ахметов (JP-0018), новичок ----------
  ('Чек-лист первой недели',
   E'**Зачем.** Первая неделя – самая насыщенная. Этот чек-лист собирает всё, что нужно сделать, чтобы вы спокойно вышли на самостоятельную работу и ничего не потерялось.\n\n**Что сделать** – отмечайте шаги по мере выполнения. Порядок не важен, кроме курса по охране труда: его нужно пройти до самостоятельной работы на складе.\n\n**Готово, когда** отмечены все шаги, включая встречу с HR в конце недели.\n\n**Вопросы** – Мадине Касымовой (кадровые документы) или AI Jana. На смене спрашивайте наставника, Дану Жумабекову.',
   seed_tmp.emp('JP-0018'), seed_tmp.emp('JP-0003'), 'high', 'in_progress', 'hr', 'checklist',
   '[{"text":"Подписать трудовой договор и ознакомиться с ПВТР в Documentolog","done":true},{"text":"Получить пропуск, спецодежду и СИЗ","done":true},{"text":"Пройти вводный инструктаж по охране труда","done":true},{"text":"Проверить свои данные и контакты в профиле JanaMen","done":true},{"text":"Познакомиться с наставником и отработать первую смену","done":true},{"text":"Пройти курс «Добро пожаловать в Jana Post»","done":false},{"text":"Встреча с HR по итогам первой недели","done":false}]'::jsonb,
   ((current_date + 2) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '5 days', now() - interval '5 days', null),

  ('Короткий отчёт о первой самостоятельной смене',
   E'**Зачем.** Мне важно понять, что у вас уже получается, а где нужна помощь, пока ошибки не вошли в привычку.\n\n**Что сделать.** После смены напишите 4–6 предложений:\n- какие операции делали сами (приёмка, сортировка, пересорт);\n- что было непонятно или неудобно;\n- где пришлось просить помощи у наставника;\n- какие вопросы остались.\n\nЕсли что-то в зоне показалось опасным или неудобным, приложите фото.\n\n**Готово, когда** вы отправите отчёт «На проверку», а я его приму. Не успеваете – напишите мне, это не экзамен.',
   seed_tmp.emp('JP-0018'), seed_tmp.emp('JP-0012'), 'medium', 'todo', 'warehouse', 'report',
   '[]'::jsonb,
   ((current_date + 1) + time '21:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '1 day', null, null),

  ('Выучить карту зон склада и адресацию ячеек',
   E'**Зачем.** Чтобы быстро находить ячейку и не терять время на поиск, нужно понимать, как устроены зоны и адреса.\n\n**Что сделать.**\n- изучить схему на стенде у входа: зона A – приёмка, B и C – хранение, D – буфер и отгрузка;\n- разобраться в адресе ячейки: зона, ряд, стеллаж, ярус (например, B-12-07-2);\n- пройти с наставником зоны B и C и найти 10 ячеек по адресам из WMS.\n\n**Готово, когда** вы найдёте 10 ячеек за 15 минут без подсказки. Отметьте задачу «Готово», а Дана Жумабекова проверит на смене.',
   seed_tmp.emp('JP-0018'), seed_tmp.emp('JP-0012'), 'medium', 'in_progress', 'warehouse', 'simple',
   '[]'::jsonb,
   ((current_date + 3) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '4 days', now() - interval '3 days', null),

  ('Получить спецодежду, СИЗ и пропуск',
   E'**Зачем.** Без защитной обуви, жилета и пропуска в зону сортировки не пускают – это требование охраны труда.\n\n**Что сделать.**\n- получить у кладовщика Бауыржана Утепова куртку, жилет, защитную обувь и перчатки, расписаться в ведомости;\n- в службе безопасности сфотографироваться на пропуск (до выдачи постоянного действует временный);\n- проверить, что пропуск открывает зоны A–D.\n\n**Готово, когда** у вас полный комплект СИЗ и пропуск. Если размер не подошёл, его можно поменять в течение двух недель.',
   seed_tmp.emp('JP-0018'), seed_tmp.emp('JP-0012'), 'high', 'done', 'hr', 'simple',
   '[]'::jsonb,
   ((current_date - 4) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '5 days', now() - interval '5 days', now() - interval '4 days 20 hours'),

  -- ---------- Ерлан Сапаров (JP-0012) – задачи от Руслана Ибраева ----------
  ('Подготовить план смен на пик 11.11',
   E'**Зачем.** С 16 по 30 ноября ждём рост объёма на 50–60%. План смен нужен, чтобы вовремя заказать временный персонал и не согласовать отпуска, которые сорвут пик.\n\n**Что сделать.**\n- рассчитать потребность в людях по сменам с учётом прогноза объёма из Урумчи;\n- учесть согласованные отпуска и правило «не более 10% смены»;\n- определить, сколько временных сотрудников нужно и на какие участки;\n- назначить наставников из опытных операторов.\n\n**Результат:** график смен на 16–30 ноября и короткая записка о потребности во временном персонале.\n\n**Готово, когда** я приму отчёт. Вопросы – мне напрямую.',
   seed_tmp.emp('JP-0012'), seed_tmp.emp('JP-0011'), 'urgent', 'in_progress', 'logistics', 'report',
   '[]'::jsonb,
   ((current_date + 5) + time '12:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '4 days', now() - interval '3 days', null),

  ('Согласовать график отпусков склада на декабрь',
   E'**Зачем.** После пика многие захотят в отпуск, а с 10 по 28 декабря второй пик перед Новым годом. Нужно распределить отпуска так, чтобы люди отдохнули, а смены остались укомплектованы.\n\n**Что сделать.**\n- собрать пожелания сотрудников склада на декабрь;\n- в первую очередь учесть тех, кому отказали в ноябре, и тех, у кого накоплено больше 30 дней (например, Мирас Жаксылыков);\n- с 10 по 28 декабря – не более 10% смены одновременно;\n- рассмотреть заявки в JanaMen.\n\n**Готово, когда** все заявки на декабрь рассмотрены, а я получил короткую сводку.',
   seed_tmp.emp('JP-0012'), seed_tmp.emp('JP-0011'), 'medium', 'todo', 'logistics', 'simple',
   '[]'::jsonb,
   ((current_date + 12) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '2 days', null, null),

  ('Заявка на временный персонал и технику на пик',
   E'**Зачем.** Кадровое агентство набирает временных сотрудников за 10 рабочих дней, а аренда дополнительных ТСД и погрузчика требует договора. Если не подать заявку на этой неделе, люди и техника не успеют к 16 ноября.\n\n**Что сделать** – по шагам чек-листа, цифры бери из плана смен на пик.\n\n**Готово, когда** заявка в агентство отправлена, а потребность в технике передана Гульнаре Есеновой для согласования бюджета.\n\n**Вопросы** – мне; по бюджету – Гульнаре Есеновой, по ТСД – Дмитрию Паку.',
   seed_tmp.emp('JP-0012'), seed_tmp.emp('JP-0011'), 'high', 'todo', 'logistics', 'checklist',
   '[{"text":"Определить число временных сотрудников по сменам","done":false},{"text":"Согласовать с HR требования и курсы для временного персонала","done":false},{"text":"Рассчитать потребность в дополнительных ТСД","done":false},{"text":"Запросить аренду одного погрузчика на 16–30 ноября","done":false},{"text":"Передать заявку и бюджет финансовому директору","done":false}]'::jsonb,
   ((current_date + 3) + time '15:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '1 day', null, null),

  -- ---------- Склад и сортировка (D41) ----------
  ('Перемаркировать стеллажи зоны C',
   E'**Зачем.** После перестановки стеллажей в зоне C адресные таблички не совпадают с адресами в WMS: операторы кладут отправления «по памяти», отсюда пересорт.\n\n**Что сделать.**\n- распечатать новые таблички адресов C-01 – C-24 из WMS;\n- заменить таблички на стеллажах, старые снять;\n- выборочно проверить 10 ячеек: адрес на табличке совпадает с WMS.\n\n**Готово, когда** все стеллажи зоны C промаркированы заново. Принтер этикеток – на стойке старшего смены; закончились этикетки – скажи Бауыржану Утепову.\n\n**Важно:** до субботней инвентаризации зона C должна быть готова.',
   seed_tmp.emp('JP-0015'), seed_tmp.emp('JP-0012'), 'medium', 'todo', 'warehouse', 'simple',
   '[]'::jsonb,
   ((current_date - 3) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '9 days', null, null),

  ('Сдать отчёт по возвратам за сентябрь',
   E'**Зачем.** Клиентский сервис просит понять, почему в сентябре выросло число возвратов на склад: часть отправлений можно было выдать клиенту.\n\n**Что сделать.**\n- выгрузить из WMS возвраты за сентябрь;\n- разделить их по причинам: отказ клиента, истёк срок хранения в ПВЗ, повреждение, неверный адрес;\n- отметить 5–10 случаев, где возврата можно было избежать.\n\n**Результат:** короткий вывод в поле отчёта и таблица во вложении.\n\n**Готово, когда** я приму отчёт. Если непонятно с выгрузкой, спроси Дану Жумабекову: она делала похожий отчёт по ошибкам сортировки.',
   seed_tmp.emp('JP-0015'), seed_tmp.emp('JP-0012'), 'low', 'in_progress', 'warehouse', 'report',
   '[]'::jsonb,
   ((current_date - 1) + time '12:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '8 days', now() - interval '6 days', null),

  ('Проверить исправность погрузчика №2 перед ночной сменой',
   E'**Зачем.** В субботу инвентаризация, и погрузчик №2 будет единственным, который работает в зонах B и C. По новым правилам неисправный погрузчик на линию не выходит.\n\n**Что проверить** по чек-листу осмотра:\n- тормоза и стояночный тормоз;\n- гидравлику и подъём вил под нагрузкой;\n- звуковой сигнал, проблесковый маячок и фары;\n- заряд АКБ и состояние шин.\n\n**Результат:** короткий вывод в отчёте и фото панели приборов.\n\n**Готово, когда** я приму отчёт. Нашёл неисправность – погрузчик на линию не выпускать и сразу сообщить мне.',
   seed_tmp.emp('JP-0017'), seed_tmp.emp('JP-0012'), 'high', 'review', 'warehouse', 'report',
   '[]'::jsonb,
   (current_date + time '20:00') at time zone 'Asia/Almaty',
   'Осмотр провёл перед ночной сменой. Тормоза и стояночный тормоз в норме, гидравлика держит 1,5 т без просадки, сигнал, маячок и фары работают, заряд АКБ 92%. Замечание: износ левой передней шины около 70%, до пика лучше заменить. Фото панели приборов и шины отправил в чат смены.',
   now() - interval '19 hours', now() - interval '1 day', now() - interval '20 hours', null),

  ('Сверить остатки упаковочных материалов',
   E'**Зачем.** В пик расход скотча, стретч-плёнки и пакетов вырастет в полтора раза. Чтобы не остановить упаковку, заказ нужно сделать заранее.\n\n**Что сделать.**\n- пересчитать остатки расходников: скотч 48 мм, стретч-плёнка, курьерские пакеты S/M/L, наполнитель;\n- посчитать, на сколько дней хватит при текущем и при пиковом расходе (+50%);\n- предложить объём заказа.\n\n**Результат:** остатки и предложение по заказу в поле отчёта.\n\n**Готово, когда** я приму отчёт и передам заказ в закупки.',
   seed_tmp.emp('JP-0016'), seed_tmp.emp('JP-0012'), 'medium', 'review', 'warehouse', 'report',
   '[]'::jsonb,
   ((current_date + 1) + time '12:00') at time zone 'Asia/Almaty',
   'Остатки на сегодня: скотч 48 мм – 36 рулонов (хватит на 9 дней, в пик на 6), стретч-плёнка – 14 рулонов (7 и 5 дней), курьерские пакеты S – 1 200 шт., M – 650 шт., L – 180 шт. (L закончатся первыми, примерно через 4 дня), наполнитель – 6 мешков. Предлагаю заказать: скотч 120 рулонов, плёнку 40 рулонов, пакеты L 1 500 шт. и M 1 000 шт.',
   now() - interval '2 hours', now() - interval '2 days', now() - interval '1 day', null),

  ('Оформить акт расхождений по рейсу из Урумчи',
   E'**Зачем.** По прошлому рейсу из Урумчи не хватает 3 мест по манифесту, а 2 места пришли с повреждённой упаковкой. Без акта мы не сможем предъявить претензию перевозчику, а клиенты не получат компенсацию.\n\n**Что сделать.**\n- сверить фактически принятые места с манифестом в WMS;\n- сфотографировать повреждённые места и упаковку;\n- оформить акт расхождений по шаблону и подписать у старшего смены;\n- передать копию акта Индире Жакуповой для таможенной части.\n\n**Результат:** акт и фото во вложении.\n\n**Готово, когда** я приму отчёт. По составу рейса уточняй у Ли Вэя в Урумчи.',
   seed_tmp.emp('JP-0014'), seed_tmp.emp('JP-0012'), 'high', 'todo', 'logistics', 'report',
   '[]'::jsonb,
   (current_date + time '17:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '5 hours', null, null),

  -- ---------- Склад консолидации Урумчи (D44) ----------
  ('Прогноз объёма консолидации на пик 11.11',
   E'**Зачем.** Сортировочный центр в Алматы планирует смены и временный персонал по нашему прогнозу. Ошибёмся – в пик либо не хватит людей, либо будем платить за простой.\n\n**Что сделать.**\n- собрать у ключевых маркетплейсов прогноз отгрузок на 11–20 ноября;\n- рассчитать ожидаемое число мест и рейсов в сутки;\n- оценить, хватит ли двух рейсов в сутки и в какие дни нужен третий.\n\n**Результат:** таблица по дням во вложении и короткий вывод о рисках в поле отчёта.\n\n**Готово, когда** я приму отчёт. Копию прогноза направьте Ерлану Сапарову.',
   seed_tmp.emp('JP-0019'), seed_tmp.emp('JP-0011'), 'high', 'in_progress', 'logistics', 'report',
   '[]'::jsonb,
   ((current_date + 4) + time '12:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '3 days', now() - interval '2 days', null),

  -- ---------- Курьерская служба (D42) ----------
  ('Повторная доставка недоставленных отправлений',
   E'**Зачем.** Вчера 9 отправлений не доставлены: клиенты не отвечали на звонки. Срок доставки по ним истекает сегодня, после этого клиент вправе требовать компенсацию.\n\n**Что сделать** – по шагам чек-листа. Интервал доставки согласуйте с клиентом по телефону заранее.\n\n**Готово, когда** все отправления доставлены или переданы в ближайший ПВЗ с уведомлением клиента, а статусы обновлены в приложении курьера.\n\n**Вопросы** – мне. Если клиент второй раз не отвечает, сообщите в клиентский сервис.',
   seed_tmp.emp('JP-0022'), seed_tmp.emp('JP-0021'), 'urgent', 'in_progress', 'delivery', 'checklist',
   '[{"text":"Забрать 9 отправлений на стойке выдачи курьерам","done":true},{"text":"Обзвонить клиентов и согласовать интервалы","done":true},{"text":"Доставить отправления по согласованным интервалам","done":false},{"text":"Недоставленные передать в ближайший ПВЗ","done":false},{"text":"Обновить статусы в приложении курьера","done":false},{"text":"Сдать возвраты на склад до 20:00","done":false}]'::jsonb,
   (current_date + time '20:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '7 hours', now() - interval '5 hours', null),

  -- ---------- Сеть ПВЗ (D43) ----------
  ('Фотоотчёт: оформление ПВЗ Шымкент по стандарту',
   E'**Зачем.** ПВЗ в Шымкенте открылся недавно, и клиенты должны видеть единый стандарт Jana Post: навигацию, режим работы, правила возврата. Это влияет на оценку пункта в приложении.\n\n**Что сделать.**\n- проверить вывеску и табличку с режимом работы (ежедневно 09:00–21:00);\n- разместить на стойке памятку о сроке хранения и возвратах;\n- проверить, что ячейки хранения подписаны по схеме;\n- сфотографировать вход, стойку выдачи, зону ячеек и примерочную.\n\n**Результат:** 4–6 фото во вложении и короткий комментарий, чего не хватает.\n\n**Готово, когда** я приму отчёт. Не хватает материалов – напишите мне, отправим из Алматы.',
   seed_tmp.emp('JP-0027'), seed_tmp.emp('JP-0025'), 'medium', 'todo', 'client', 'report',
   '[]'::jsonb,
   ((current_date + 1) + time '13:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '1 day', null, null),

  ('Разобрать невостребованные отправления в ПВЗ Караганда',
   E'**Зачем.** В ПВЗ Караганда заканчиваются свободные ячейки: часть отправлений лежит дольше срока хранения. Перед пиком нужно освободить место под новый поток.\n\n**Что сделать** – по шагам чек-листа. Отправления, по которым клиент уже попросил продлить хранение, не возвращайте: отметьте их в списке отдельно.\n\n**Готово, когда** все отправления с истёкшим сроком хранения либо выданы, либо оформлены на возврат, а клиенты получили уведомление.\n\n**Вопросы** – мне в «Сообщения»; по уведомлениям клиентов – Асель Ермековой, клиентский сервис.',
   seed_tmp.emp('JP-0026'), seed_tmp.emp('JP-0025'), 'medium', 'todo', 'client', 'checklist',
   '[{"text":"Сформировать список отправлений с истёкшим сроком хранения","done":false},{"text":"Сверить список с фактическим наличием в ячейках","done":false},{"text":"Отправить клиентам последнее напоминание через клиентский сервис","done":false},{"text":"Оформить возврат невостребованных отправлений на склад","done":false},{"text":"Передать возвраты курьеру в день отгрузки","done":false}]'::jsonb,
   ((current_date + 3) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '1 day', null, null),

  -- ---------- Клиентский сервис (D50) ----------
  ('Обновить шаблоны ответов по возвратам',
   E'**Зачем.** О возвратах клиенты пишут чаще всего, а операторы отвечают по-разному. Перед пиком нужны единые шаблоны, чтобы отвечать быстро и одинаково точно.\n\n**Что сделать.**\n- собрать 10 самых частых вопросов о возвратах за последний месяц;\n- обновить шаблоны по новым правилам возврата маркетплейсов;\n- добавить в шаблоны ПВЗ Шымкент и его режим работы;\n- формулировки о компенсациях согласовать с юристом.\n\n**Результат:** файл с шаблонами во вложении.\n\n**Готово, когда** я приму шаблоны и мы загрузим их в систему поддержки.',
   seed_tmp.emp('JP-0030'), seed_tmp.emp('JP-0029'), 'medium', 'in_progress', 'client', 'report',
   '[]'::jsonb,
   ((current_date + 3) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '3 days', now() - interval '2 days', null),

  -- ---------- HR (D10) ----------
  ('Подготовить отчёт по обучению за квартал',
   E'**Зачем.** На совещании руководителей нужно показать, как идёт обязательное обучение перед пиком: сколько людей прошли «Охрану труда» и «Информационную безопасность» и где просрочки.\n\n**Что сделать.**\n- выгрузить из Jana Academy статистику по курсам и подразделениям;\n- выделить подразделения, где пройдено меньше 80% обязательных курсов;\n- предложить меры: напоминания, окна для обучения в сменах, назначение курсов новичкам.\n\n**Результат:** 1–2 слайда во вложении и короткий вывод в отчёте.\n\n**Готово, когда** я приму отчёт. Данные по сотрудникам – в «Пульсе компании».',
   seed_tmp.emp('JP-0004'), seed_tmp.emp('JP-0002'), 'medium', 'in_progress', 'hr', 'report',
   '[]'::jsonb,
   ((current_date + 6) + time '18:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '2 days', now() - interval '1 day', null),

  ('Ответить на открытые обращения сотрудников',
   E'**Зачем.** AI Jana передала в HR вопросы, на которые нет ответа в базе знаний. Сотрудники ждут, а ответ висит дольше суток.\n\n**Что сделать.**\n- ответить Олжасу Кенжебаеву о компенсации проезда после смены, которая заканчивается ночью (уточнить у Гульнары Есеновой);\n- ответить Сабине Мусиной об оформлении отпуска по уходу за ребёнком и документах (статья базы знаний «Отпуск по беременности и родам и по уходу за ребёнком»);\n- если ответ пригодится другим, предложить дополнить базу знаний.\n\n**Готово, когда** оба обращения в статусе «Отвечено». Вопросы – мне.',
   seed_tmp.emp('JP-0003'), seed_tmp.emp('JP-0002'), 'high', 'todo', 'hr', 'simple',
   '[]'::jsonb,
   ((current_date + 1) + time '12:00') at time zone 'Asia/Almaty',
   null, null, now() - interval '1 day', null, null);

-- ---------- Комментарии к задачам ----------

insert into public.task_comments (task_id, author_id, body, created_at)
select t.id, seed_tmp.emp('JP-0013'), 'Сканирование и пересорт отработали, Тимур схватывает быстро. Маркировку повреждённых мест покажу завтра на утреннем рейсе.', now() - interval '1 day'
from public.tasks t where t.title = 'Провести инструктаж новичка по работе с ТСД';
insert into public.task_comments (task_id, author_id, body, created_at)
select t.id, seed_tmp.emp('JP-0012'), 'Отлично, спасибо! Возьми его с собой на приёмку рейса из Урумчи, там как раз будут повреждённые места.', now() - interval '20 hours'
from public.tasks t where t.title = 'Провести инструктаж новичка по работе с ТСД';

insert into public.task_comments (task_id, author_id, body, created_at)
select t.id, seed_tmp.emp('JP-0013'), 'Отправила на проверку. Таблицу по дням могу скинуть файлом, если нужно для планёрки.', now() - interval '3 hours'
from public.tasks t where t.title = 'Отчёт по ошибкам сортировки за неделю';

insert into public.task_comments (task_id, author_id, body, created_at)
select t.id, seed_tmp.emp('JP-0012'), 'Олжас, срок прошёл. Что мешает? Если не хватает этикеток или времени, напиши: до субботы зона C должна быть готова.', now() - interval '1 day'
from public.tasks t where t.title = 'Перемаркировать стеллажи зоны C';
insert into public.task_comments (task_id, author_id, body, created_at)
select t.id, seed_tmp.emp('JP-0015'), 'Закончились этикетки для принтера, Бауыржан выдаст завтра утром. Сделаю до конца смены.', now() - interval '20 hours'
from public.tasks t where t.title = 'Перемаркировать стеллажи зоны C';

insert into public.task_comments (task_id, author_id, body, created_at)
select t.id, seed_tmp.emp('JP-0017'), 'Фото панели приборов и левой передней шины отправил в чат «Смена А · склад».', now() - interval '19 hours'
from public.tasks t where t.title = 'Проверить исправность погрузчика №2 перед ночной сменой';

insert into public.task_comments (task_id, author_id, body, created_at)
select t.id, seed_tmp.emp('JP-0011'), 'Ерлан, прогноз от Ли Вэя будет через пару дней, но на 18–22 ноября сразу закладывай +60%: это самые тяжёлые дни.', now() - interval '1 day 4 hours'
from public.tasks t where t.title = 'Подготовить план смен на пик 11.11';
insert into public.task_comments (task_id, author_id, body, created_at)
select t.id, seed_tmp.emp('JP-0012'), 'Принял. Черновик графика выложу сюда, временный персонал считаю под смены 2/2 по 12 часов.', now() - interval '1 day 2 hours'
from public.tasks t where t.title = 'Подготовить план смен на пик 11.11';

-- Задачи «Пройти курс»: у каждого незавершённого назначения курса есть задача с кнопкой перехода в курс
-- (в работе триггер course_assignment_sync_task делает то же самое при назначении)
insert into public.tasks (title, description, assignee_id, created_by, priority, status, category, kind, course_id, due_at, created_at, started_at)
select 'Пройти курс «' || c.title || '»',
       coalesce(c.description, '') || E'\n\nКурс займёт около ' || c.duration_minutes || E' минут. Задача закроется сама, когда вы сдадите итоговый тест.',
       ca.employee_id, ca.assigned_by, case when c.is_mandatory then 'high' else 'medium' end,
       case when ca.status = 'in_progress' then 'in_progress' else 'todo' end, 'training', 'course', c.id,
       case when ca.due_date is not null then (ca.due_date + time '18:00') at time zone 'Asia/Almaty' end,
       ca.created_at, ca.started_at
from public.course_assignments ca
join public.courses c on c.id = ca.course_id
where ca.status <> 'completed' and ca.assigned_by is not null and ca.assigned_by <> ca.employee_id;

-- ---------- Объявления ----------

insert into public.announcements (title, summary, body, category, cover, pinned, audience_department_id, author_id, created_at) values

  ('JanaMen: все HR-сервисы в одном окне',
   'Отпуск, аванс, справки, задачи, обучение и ответы на вопросы теперь в одном приложении. Рассказываем, с чего начать и куда писать, если что-то не работает.',
   E'### Что такое JanaMen\nJanaMen – единая HR-платформа Jana Post. Она заменяет бумажные заявления, переписку в мессенджерах и поиск нужного человека в HR. Официальные кадровые данные (должность, подразделение, остаток отпуска) подтягиваются из **1С:ЗУП**, а документы оформляются в **Documentolog**.\n\n### Что уже можно делать\n- **Заявки**: отпуск, аванс (до 50% оклада, не чаще раза в месяц), справка с места работы, изменение данных. Маршрут прозрачен: руководитель → HR → приказ или выплата в 1С:ЗУП → документ в Documentolog. Статус видно в карточке заявки.\n- **Мои задачи**: поручения с дедлайном и приоритетом, отчёты с фото и чек-листы.\n- **Jana Academy**: короткие курсы со статьями, видео и практикой, итоговый тест и сертификат.\n- **AI Jana**: отвечает на вопросы по базе знаний HR и всегда показывает источник. Если ответа нет, вопрос уходит специалисту HR.\n- **Объявления и уведомления**: всё важное приходит в колокольчик.\n\n### С чего начать\n1. Войдите в JanaMen и проверьте данные в профиле. Если что-то не так, оформите заявку «Изменение данных».\n2. Посмотрите остаток отпуска на главной странице.\n3. Откройте «Мои задачи» и Jana Academy: возможно, вам уже назначен курс.\n4. Задайте AI Jana любой вопрос, например «Как заказать справку для банка?».\n\n### Если что-то не работает\nПишите в HR через раздел «Сообщения» (Айгерим Нурланова, Мадина Касымова) или задайте вопрос AI Jana. Проблемы со входом решает IT-поддержка: it@jana.test, внутренний номер 1010.\n\n**Мы будем улучшать JanaMen по вашим отзывам**, поэтому рассказывайте, что неудобно и чего не хватает.\n\n*Айгерим Нурланова, HR-директор*',
   'hr', 'launch', true, null, seed_tmp.emp('JP-0002'), now() - interval '13 days'),

  ('Подготовка к пику 11.11: что меняется с 16 ноября',
   'С 16 по 30 ноября ожидаем рост объёма на 50–60%. Усиленный график, ограничения отпусков, временный персонал и горячее питание на сортировке.',
   E'### Почему это важно\nПосле распродаж 11.11 поток посылок из Китая резко растёт: в пиковые дни объём доходит до +60% к обычному. Чтобы клиенты получили заказы вовремя, склад консолидации в Урумчи, сортировочный центр, курьерская служба и сеть ПВЗ работают в усиленном режиме **с 16 по 30 ноября**.\n\n### Что меняется\n- **Графики смен** на пик руководители опубликуют до 10 ноября. Дополнительные смены – только с вашего согласия и с повышенной оплатой.\n- **Отпуска**: с 16 по 30 ноября одновременно может отсутствовать не более 10% сотрудников смены, согласование – с директором по логистике. Уже согласованные отпуска остаются в силе.\n- **Временный персонал**: на сортировку выйдут около 40 временных сотрудников. Опытные операторы станут наставниками, наставничество оплачивается отдельно.\n- **Склад в Урумчи** переходит на ежедневную консолидацию и два рейса в сутки.\n- **ПВЗ** в пиковые дни продлевают работу до 22:00.\n\n### Что сделать сейчас\n1. Если планировали отпуск в ноябре, обсудите даты с руководителем до 1 ноября.\n2. Пройдите курс «Охрана труда на складе и в ПВЗ», если он ещё не пройден.\n3. Проверьте ТСД и рабочие телефоны, о проблемах сообщите в IT-поддержку.\n\n### Забота о команде\nВ пиковые дни на сортировочном центре **бесплатное горячее питание** для всех смен. Не пропускайте перерывы и говорите старшему смены, если чувствуете перегрузку.\n\nВопросы по графику – к своему руководителю, по отпускам и оплате – в HR или к AI Jana (статья «Работа в пиковый сезон 11.11»).\n\n*Руслан Ибраев, директор по логистике*',
   'logistics', 'peak', true, null, seed_tmp.emp('JP-0011'), now() - interval '3 days'),

  ('Плановая инвентаризация в субботу: зоны B и C',
   'В субботу с 08:00 пересчитываем зоны B и C. Приёмка в эти зоны закрыта до окончания пересчёта, старшим смен нужно заранее подготовить ТСД и листы пересчёта.',
   E'### Что происходит\nВ эту субботу проводим плановую инвентаризацию **зон B и C** сортировочного центра. Начало в **08:00**, ориентировочное окончание в **14:00**.\n\n### Что меняется в работе склада\n- С 08:00 до окончания пересчёта приёмка и размещение в зонах B и C **приостановлены**. Входящие отправления временно размещаем в буферной зоне D.\n- Отгрузка из зоны A идёт в обычном режиме.\n- Погрузчики в зонах B и C не работают, кроме погрузчика №2 по команде старшего смены.\n\n### Кто участвует\n- Смена А в полном составе, старшая по пересчёту – **Дана Жумабекова**.\n- Сверка с WMS и акты расхождений – **Бауыржан Утепов**.\n- Новые сотрудники работают в паре с опытными коллегами.\n\n### Что подготовить до субботы\n1. Старшим смен: проверить и зарядить ТСД, запасные аккумуляторы положить на стойку старшего смены.\n2. Распечатать листы пересчёта по ячейкам (шаблон – в задаче «Инвентаризация зоны B-12»).\n3. Разобрать пересорт в зоне возвратов, чтобы он не сбил остатки.\n4. Закончить перемаркировку стеллажей зоны C.\n\n### Правила пересчёта\n- Каждую ячейку считают двое, расхождения сразу фиксируют на листе и в ТСД.\n- Повреждённые отправления не перемещаем: фотографируем и вносим в акт.\n- Перерыв – по графику, лист пересчёта перед уходом сдаётся старшему.\n\nВопросы – мне в «Сообщения» или в группу «Смена А · склад».\n\n*Ерлан Сапаров, руководитель склада и сортировки*',
   'urgent', 'inventory', false, (select id from public.departments where zup_id = 'D41'), seed_tmp.emp('JP-0012'), now() - interval '21 hours'),

  ('25 октября – День Республики: как отдыхаем и работаем',
   'День Республики выпадает на воскресенье, поэтому понедельник, 26 октября, – выходной. Склад, сортировка и ПВЗ работают по отдельному графику.',
   E'### Как отдыхаем\n**25 октября** – День Республики, национальный праздник Казахстана. В 2026 году он выпадает на воскресенье, поэтому по Закону «О праздниках в Республике Казахстан» выходным становится следующий рабочий день – **понедельник, 26 октября**.\n\nОфис (пятидневная неделя) отдыхает 24, 25 и 26 октября и выходит на работу во вторник, 27 октября.\n\n### Как работают склад, сортировка и ПВЗ\n- **Сортировочный центр и склад** работают по графику смен 2/2 без перерыва.\n- **ПВЗ** 25 и 26 октября открыты с 10:00 до 18:00.\n- **Курьерская служба** 26 октября доставляет срочные и уже назначенные на этот день отправления.\n- **Клиентский сервис** отвечает в чате в обычном режиме, телефонная линия работает с 10:00 до 18:00.\n\n### Оплата за работу в праздник\nРабота в праздничный день оплачивается не ниже чем в полуторном размере дневной (часовой) ставки (ст. 109 Трудового кодекса РК). По вашему желанию вместо повышенной оплаты можно получить другой день отдыха (ст. 85 ТК РК) – сообщите об этом руководителю. Как будет учтён 26 октября в вашем сменном графике, подскажет руководитель.\n\n### Если планируете отпуск\nПраздничный день 25 октября не входит в число дней отпуска, JanaMen учтёт это автоматически при расчёте заявки.\n\n### Встреча перед праздником\nВ пятницу, 23 октября, в 16:00 – короткая встреча с генеральным директором Бекжаном Сулейменовым в столовой сортировочного центра и онлайн: итоги года и поздравления командам.\n\nС праздником!\n\n*Мадина Касымова, HR*',
   'event', 'holiday', false, null, seed_tmp.emp('JP-0003'), now() - interval '2 days'),

  ('Обязательный курс: информационная безопасность и персональные данные',
   'Всем сотрудникам назначен 20-минутный курс о паролях, фишинге и работе с данными клиентов. Пройти его нужно до конца месяца, проходной балл – 80%.',
   E'### Зачем это нужно\nКаждый день через Jana Post проходят тысячи отправлений с именами, телефонами и адресами клиентов. Одна утечка – и под угрозой доверие клиентов и репутация компании. Поэтому курс **«Информационная безопасность и персональные данные»** обязателен для всех: от оператора ПВЗ до разработчика.\n\n### Что внутри\n- как придумать надёжный пароль и почему его нельзя сообщать даже «сотруднику IT»;\n- как распознать фишинговое письмо и звонок «из службы поддержки»;\n- что можно и что нельзя делать с данными клиентов и коллег;\n- что делать, если потеряли телефон, ТСД или ноутбук.\n\nКурс состоит из коротких статей, видео и практики с мгновенной проверкой. В конце – итоговый тест: **проходной балл 80%**, количество попыток не ограничено. После сдачи на странице курса появится сертификат.\n\n### Как пройти\n1. Откройте задачу «Пройти курс» в разделе «Мои задачи» и нажмите «Перейти к курсу» – или найдите курс в Jana Academy.\n2. Пройдите уроки по порядку, прогресс сохраняется.\n3. Сдайте итоговый тест – задача закроется автоматически.\n\n**Срок – до конца текущего месяца.** Курс займёт около 20 минут; пройдите его в рабочее время, согласовав с руководителем удобное окно в смене.\n\nПросроченные обязательные курсы видны руководителю и HR, поэтому лучше не откладывать.\n\nВопросы по курсу – Жанне Омаровой, Jana Academy.\n\n*Жанна Омарова, специалист по обучению*',
   'hr', 'learning', false, null, seed_tmp.emp('JP-0004'), now() - interval '6 days'),

  ('Открыт новый пункт выдачи в Шымкенте',
   'Сеть ПВЗ выросла: в Шымкенте открылся пункт выдачи с примерочной и зоной возвратов. Работает ежедневно с 09:00 до 21:00.',
   E'### Что открылось\nJana Post открыла пункт выдачи заказов в **Шымкенте**. Адрес и схема проезда уже есть в приложении Jana Post, клиенты города могут выбирать новый пункт при оформлении заказа.\n\n### Коротко о пункте\n- **Режим работы:** ежедневно с 09:00 до 21:00.\n- **Ёмкость:** до 1 500 отправлений в день, 600 ячеек хранения.\n- **Примерочная** и отдельная **зона возвратов**.\n- **Оплата** картой и по QR.\n\n### Команда\nПункт запустила команда сети ПВЗ во главе с Динарой Исмаиловой. Первым оператором стала Томирис Байжанова, наставником в первые недели – Анель Бекова из ПВЗ Астана. С оборудованием помогли склад и IT.\n\n### Что это значит для коллег\n- **Клиентский сервис:** добавьте ПВЗ Шымкент в ответы о пунктах выдачи, режим работы – выше.\n- **Склад и сортировка:** отправления в Шымкент собираются в отдельные мешки направления «ШЫМ-01».\n- **Курьерская служба:** недоставленные курьерские отправления по Шымкенту можно перенаправлять в новый пункт с уведомлением клиента.\n\n### Спасибо\nСпасибо всем, кто помог запустить пункт за три недели! Если у вас есть родные и друзья в Шымкенте, расскажите им о новом ПВЗ.\n\n*Динара Исмаилова, руководитель сети ПВЗ*',
   'news', 'branch', false, null, seed_tmp.emp('JP-0025'), now() - interval '10 days'),

  ('Неделя безопасности: новые правила работы с погрузчиками',
   'На складах вводятся обновлённые правила движения погрузчиков: пешеходные коридоры, скорость не более 5 км/ч и осмотр перед каждой сменой. Плюс неделя пятиминуток и практических занятий.',
   E'### Почему мы это делаем\nЗа последний квартал на складах было два случая, когда погрузчик проехал в опасной близости от сотрудника. Никто не пострадал, но перед пиком, когда людей и паллет станет больше, рисковать нельзя.\n\n### Новые правила\n- **Скорость** внутри склада – не более 5 км/ч, в зоне сортировки и на поворотах – шагом.\n- **Пешеходные коридоры** обозначены жёлтой разметкой. Пешеходу запрещено заходить в зону работы погрузчика, водителю – заезжать в пешеходный коридор.\n- **Осмотр перед сменой**: водитель проверяет тормоза, гидравлику, звуковой сигнал и огни по чек-листу и отправляет результат старшему смены. Неисправный погрузчик на линию не выходит.\n- **Допуск**: управлять погрузчиком могут только сотрудники с удостоверением водителя погрузчика и пройденным инструктажем.\n- **Наушники и телефон** в зоне работы погрузчиков запрещены и пешеходам, и водителям.\n\n### Программа недели безопасности\n- ежедневно в 08:15 и 20:15 – пятиминутка по безопасности в начале смены;\n- в середине недели – практическое занятие «Мёртвые зоны погрузчика» для смен А и Б;\n- в конце недели – проверка СИЗ: обменяйте изношенные перчатки и обувь у кладовщика.\n\n### Что сделать каждому\n1. Пройдите курс «Охрана труда на складе и в ПВЗ» в Jana Academy, если он ещё не пройден.\n2. Проверьте, что у вас есть светоотражающий жилет и защитная обувь.\n3. Сообщайте старшему смены о любой опасной ситуации, даже если никто не пострадал. **За такие сообщения никого не наказывают** – наоборот, они помогают предотвратить травмы.\n\n*Руслан Ибраев, директор по логистике*',
   'logistics', 'safety', false, null, seed_tmp.emp('JP-0011'), now() - interval '7 days'),

  ('Лучшие сотрудники сентября',
   'Подводим итоги конкурса «Лучший сотрудник месяца»: четыре номинации, отзывы клиентов и голоса коллег. Поздравляем победителей!',
   E'### Как выбирали\nНоминантов предложили руководители подразделений и коллеги. Мы учитывали показатели работы за месяц, отзывы клиентов в приложении Jana Post и то, как человек помогает команде.\n\n### Победители\n**Лучший оператор сортировки – Дана Жумабекова, склад и сортировка.** Точность сортировки 99,8%, обучила двух новых сотрудников работе с ТСД, первой берётся за сложные рейсы из Урумчи.\n\n**Лучший курьер – Бекзат Рахимов, курьерская служба.** 98% доставок в согласованный интервал, ни одной жалобы и 37 благодарностей от клиентов.\n\n**Лучший оператор ПВЗ – Анель Бекова, ПВЗ Астана.** Среднее время выдачи – полторы минуты; помогала запускать новый пункт в Шымкенте.\n\n**Лучший специалист поддержки – Камила Абдрахманова, клиентский сервис.** Оценка клиентов 4,9 из 5, взялась обновить шаблоны ответов по возвратам.\n\n### Что получают победители\n- премию по приказу генерального директора;\n- дополнительный оплачиваемый выходной по согласованию с руководителем;\n- фото на доске почёта в сортировочном центре.\n\n### Как попасть в номинацию октября\nПредложить коллегу может любой сотрудник: напишите своему руководителю до 5-го числа следующего месяца и коротко объясните, за что. Отзывы клиентов в приложении тоже учитываются.\n\nСпасибо всем за работу в сентябре!\n\n*Айгерим Нурланова, HR-директор*',
   'news', 'team', false, null, seed_tmp.emp('JP-0002'), now() - interval '9 days'),

  ('Забота о себе в пик: сон, вода и перерывы',
   'Пик 11.11 – это марафон, а не спринт. Пять простых правил, которые помогают сохранить силы, и куда обращаться, если тяжело.',
   E'### Почему об этом стоит подумать заранее\nВ пиковые недели нагрузка растёт у всех: больше посылок, звонков и клиентов на ПВЗ. Усталость накапливается незаметно, а вместе с ней растут ошибки и риск травм.\n\n### Пять простых правил\n1. **Сон.** Перед ночной сменой постарайтесь поспать днём хотя бы полтора-два часа, а после ночной не садитесь сразу за руль.\n2. **Вода.** На складе сухой воздух: держите бутылку воды рядом, кулеры есть в каждой зоне.\n3. **Перерывы.** Не пропускайте их, даже когда «горит»: 10 минут отдыха возвращают внимание.\n4. **Еда.** В пиковые дни на сортировочном центре бесплатное горячее питание для всех смен.\n5. **Разминка.** Пять минут упражнений для спины и рук перед сменой – схема на стенде у входа.\n\n### Если тяжело\n- Скажите старшему смены или руководителю: можно перестроить график, дать перерыв или перевести на другой участок.\n- Напишите в HR в «Сообщениях» – разговор останется конфиденциальным.\n- Сотрудники с ДМС могут бесплатно обратиться к терапевту по полису.\n\n### Отпуск после пика\nЕсли давно не отдыхали, запланируйте отпуск между пиками – с 1 по 9 декабря – или после 28 декабря. Остаток дней видно на главной странице JanaMen, заявка оформляется за пару минут.\n\nБерегите себя и друг друга.\n\n*Айгерим Нурланова, HR-директор*',
   'hr', 'wellbeing', false, null, seed_tmp.emp('JP-0002'), now() - interval '4 days'),

  ('Обновление ТСД и смена паролей на этой неделе',
   'IT обновит прошивку всех ТСД в ночные окна, а всем сотрудникам нужно сменить пароль рабочей учётной записи в течение 7 дней. Что сделать и как не попасться на фишинг.',
   E'### Обновление ТСД\nМы обновляем прошивку и приложение WMS на всех терминалах сбора данных. После обновления:\n- быстрее сканируются штрихкоды маркетплейсов на мятых этикетках;\n- при пересорте появляется подсказка ячейки;\n- батарея держит дольше благодаря новому режиму энергосбережения.\n\n**Как проходит обновление.** ТСД обновляются автоматически на зарядной станции в ночное окно 02:00–04:00: в первую ночь – зона A, во вторую – зоны B и C, в третью – зона D. Оставляйте ТСД на зарядке в конце смены, не уносите и не выключайте их. Если утром ТСД просит перезагрузку, перезагрузите его; если ошибка повторяется, сообщите старшему смены.\n\n### Смена паролей\nПароль рабочей учётной записи (почта, WMS) нужно менять раз в 90 дней. **В течение 7 дней** система сама предложит сменить пароль при входе.\n\nТребования к новому паролю:\n- не меньше 12 символов;\n- буквы в разных регистрах и цифры;\n- не совпадает с тремя предыдущими.\n\n### Осторожно: фишинг\nЗлоумышленники любят такие рассылки. Помните:\n- IT **никогда** не просит прислать пароль в чате, письме или по телефону;\n- письма о смене пароля приходят только с адреса it@jana.test;\n- сомневаетесь – позвоните в IT-поддержку.\n\n### Если что-то пошло не так\nНе получается войти, ТСД не включается после обновления или вы ввели пароль на подозрительном сайте – сразу обращайтесь в IT-поддержку: **it@jana.test**, внутренний номер **1010**, ежедневно с 08:00 до 22:00, в ночные смены – дежурный инженер.\n\n*Дмитрий Пак, технический директор*',
   'news', 'it', false, null, seed_tmp.emp('JP-0007'), now() - interval '1 day 6 hours'),

  ('Новый курс в Jana Academy: «Стандарты клиентского сервиса»',
   'Как поприветствовать клиента, что сказать, если посылка задерживается, и как спокойно провести возврат. 20 минут, видео и практика на реальных ситуациях.',
   E'### Для кого\nКурс рекомендован операторам ПВЗ, специалистам поддержки и курьерам, но пригодится всем, кто общается с клиентами. Новым операторам ПВЗ и поддержки руководители назначают его в первый месяц работы.\n\n### Что внутри\n- **Первые 30 секунд:** как начать разговор, чтобы клиент почувствовал заботу.\n- **Сложные ситуации:** посылка задерживается, клиент раздражён, товар повреждён.\n- **Возвраты:** пошаговый порядок и что говорить клиенту на каждом шаге.\n- **Чего не говорить:** фразы, которые портят впечатление даже при хорошем результате.\n\nУроки – это короткие статьи, видео и практика: вы выбираете ответ в ситуации и сразу видите разбор. В конце итоговый тест: **проходной балл 70%**, попыток сколько угодно, после сдачи – сертификат.\n\n### Как пройти\nОткройте **Jana Academy → «Стандарты клиентского сервиса»**. Курс займёт около 20 минут; прогресс сохраняется, поэтому его можно проходить частями между клиентами.\n\n### Бонус\nПервые 30 сотрудников, которые сдадут тест на 90% и выше, получат фирменный термостакан Jana Post. Результаты мы увидим в Jana Academy автоматически, ничего присылать не нужно.\n\nВопросы и идеи для новых курсов пишите Жанне Омаровой в «Сообщения».\n\n*Жанна Омарова, Jana Academy*',
   'hr', 'learning', false, null, seed_tmp.emp('JP-0004'), now() - interval '5 days');

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
  (seed_tmp.emp('JP-0013'), 'Заявка №1004 отклонена', 'Отпуск: Даты попадают на распродажу 11.11 и подготовку к пику. Перенесите, пожалуйста, на 1–9 декабря, между пиками: согласую сразу', '/requests', 'warning', now() - interval '10 days', now() - interval '11 days'),
  (seed_tmp.emp('JP-0013'), 'Заявка оформлена', 'Справка готова, см. карточку заявки', '/requests', 'success', now() - interval '18 days', now() - interval '19 days'),
  (seed_tmp.emp('JP-0012'), 'Новая заявка: Отпуск', 'Бауыржан Утепов · ' || to_char(current_date + 21, 'DD.MM') || '–' || to_char(current_date + 34, 'DD.MM.YYYY'), '/approvals', 'request', null, now() - interval '2 days'),
  (seed_tmp.emp('JP-0012'), 'Новая заявка: Аванс', 'Олжас Кенжебаев · 80 000 ₸', '/approvals', 'request', null, now() - interval '20 hours'),
  (seed_tmp.emp('JP-0012'), 'Задача №111 на проверке', 'Мирас Жаксылыков: Проверить исправность погрузчика №2', '/tasks', 'task', null, now() - interval '3 hours'),
  (seed_tmp.emp('JP-0002'), 'Оформите заявку', 'Айдана Калиева · Отпуск: согласовано руководителем', '/approvals', 'request', null, now() - interval '6 days' + interval '3 hours'),
  (seed_tmp.emp('JP-0002'), 'Новое обращение', 'Олжас Кенжебаев: «Положена ли компенсация за проезд, если смена заканчивается ночью?»', '/tickets', 'ticket', null, now() - interval '1 day'),
  (seed_tmp.emp('JP-0002'), 'Новое обращение', 'Сабина Мусина: «Как оформить отпуск по уходу за ребёнком?»', '/tickets', 'ticket', null, now() - interval '5 hours'),
  (seed_tmp.emp('JP-0018'), 'Добро пожаловать в Jana Post!', 'Начните с курса «Добро пожаловать в Jana Post» в Jana Academy', '/academy/welcome', 'course', null, now() - interval '5 days'),
  (seed_tmp.emp('JP-0018'), 'Назначен курс: Охрана труда на складе и в ПВЗ', 'Jana Academy · пройти до ' || to_char(current_date + 7, 'DD.MM.YYYY'), '/academy/safety', 'course', null, now() - interval '5 days');

-- ---------- Сообщения: несколько переписок, чтобы раздел не был пустым ----------

do $$
declare
  v_dana uuid := seed_tmp.emp('JP-0013');
  v_erlan uuid := seed_tmp.emp('JP-0012');
  v_hr uuid := seed_tmp.emp('JP-0002');
  v_timur uuid := seed_tmp.emp('JP-0018');
  v_miras uuid := seed_tmp.emp('JP-0017');
  v_olzhas uuid := seed_tmp.emp('JP-0015');
  c uuid;
  q uuid;
begin
  -- Дана и руководитель: последнее сообщение Дана ещё не прочитала
  insert into public.chats (kind, created_by, created_at) values ('direct', v_erlan, now() - interval '26 hours') returning id into c;
  insert into public.chat_messages (chat_id, author_id, body, created_at) values
    (c, v_erlan, 'Дана, привет! Сможешь завтра подменить Олжаса на приёмке рейса из Урумчи?', now() - interval '26 hours'),
    (c, v_dana, 'Да, смогу. С 8:00?', now() - interval '25 hours 50 minutes'),
    (c, v_erlan, 'Да, с 8:00. Спасибо!', now() - interval '25 hours 45 minutes'),
    (c, v_dana, 'Отчёт по ошибкам сортировки за неделю отправила в задачах.', now() - interval '3 hours'),
    (c, v_erlan, 'Видел, спасибо. Обсудим завтра на планёрке.', now() - interval '2 hours');
  insert into public.chat_members (chat_id, employee_id, joined_at, last_read_at) values
    (c, v_erlan, now() - interval '26 hours', now() - interval '2 hours'),
    (c, v_dana, now() - interval '26 hours', now() - interval '3 hours');

  -- Дана и HR
  insert into public.chats (kind, created_by, created_at) values ('direct', v_hr, now() - interval '2 days') returning id into c;
  insert into public.chat_messages (chat_id, author_id, body, created_at) values
    (c, v_hr, 'Дана, добрый день! Напоминаю про курс по информационной безопасности, его нужно пройти до ' || to_char(current_date + 11, 'DD.MM') || '.', now() - interval '2 days'),
    (c, v_dana, 'Спасибо, пройду на этой неделе.', now() - interval '2 days' + interval '12 minutes'),
    (c, v_hr, 'Если будут вопросы по отпуску или справкам, пишите сюда.', now() - interval '50 minutes');
  insert into public.chat_members (chat_id, employee_id, joined_at, last_read_at) values
    (c, v_hr, now() - interval '2 days', now() - interval '50 minutes'),
    (c, v_dana, now() - interval '2 days', now() - interval '2 days' + interval '12 minutes');

  -- Группа смены: ответ Даны на вопрос новичка
  insert into public.chats (kind, title, created_by, created_at) values ('group', 'Смена А · склад', v_erlan, now() - interval '20 hours') returning id into c;
  insert into public.chat_messages (chat_id, author_id, body, created_at) values
    (c, v_erlan, 'Коллеги, в субботу с 08:00 инвентаризация зон B и C. Проверьте ТСД.', now() - interval '20 hours'),
    (c, v_miras, 'Погрузчик №2 проверил, всё исправно.', now() - interval '19 hours');
  insert into public.chat_messages (chat_id, author_id, body, created_at)
  values (c, v_timur, 'Подскажите, где взять листы пересчёта?', now() - interval '5 hours') returning id into q;
  insert into public.chat_messages (chat_id, author_id, body, reply_to, created_at) values
    (c, v_dana, 'На стойке у старшего смены, утром покажу.', q, now() - interval '4 hours 50 minutes'),
    (c, v_erlan, 'Спасибо, Дана! Тимур, если что, пиши мне.', null, now() - interval '1 hour');
  insert into public.chat_members (chat_id, employee_id, joined_at, last_read_at) values
    (c, v_erlan, now() - interval '20 hours', now() - interval '1 hour'),
    (c, v_dana, now() - interval '20 hours', now() - interval '4 hours 50 minutes'),
    (c, v_timur, now() - interval '20 hours', now() - interval '4 hours'),
    (c, v_miras, now() - interval '20 hours', now() - interval '19 hours'),
    (c, v_olzhas, now() - interval '20 hours', now() - interval '20 hours');

  -- Новичок и HR
  insert into public.chats (kind, created_by, created_at) values ('direct', v_hr, now() - interval '4 days') returning id into c;
  insert into public.chat_messages (chat_id, author_id, body, created_at) values
    (c, v_hr, 'Тимур, добро пожаловать в Jana Post! Начните с курса «Добро пожаловать» в Jana Academy.', now() - interval '4 days'),
    (c, v_timur, 'Спасибо! Уже начал.', now() - interval '4 days' + interval '30 minutes');
  insert into public.chat_members (chat_id, employee_id, joined_at, last_read_at) values
    (c, v_hr, now() - interval '4 days', now() - interval '3 days'),
    (c, v_timur, now() - interval '4 days', now() - interval '4 days' + interval '30 minutes');

  -- Руководитель и HR
  insert into public.chats (kind, created_by, created_at) values ('direct', v_hr, now() - interval '1 day') returning id into c;
  insert into public.chat_messages (chat_id, author_id, body, created_at) values
    (c, v_hr, 'Ерлан, у Олжаса просрочен курс по охране труда. Напомните ему, пожалуйста.', now() - interval '1 day'),
    (c, v_erlan, 'Хорошо, поговорю с ним сегодня.', now() - interval '23 hours');
  insert into public.chat_members (chat_id, employee_id, joined_at, last_read_at) values
    (c, v_hr, now() - interval '1 day', now() - interval '22 hours'),
    (c, v_erlan, now() - interval '1 day', now() - interval '23 hours');

  update public.chats ch set last_message_at = (select max(m.created_at) from public.chat_messages m where m.chat_id = ch.id);
end $$;

-- ---------- Включаем триггеры обратно ----------

alter table public.requests enable trigger trg_requests_after_insert;
alter table public.course_assignments enable trigger trg_course_assignments_notify;
alter table public.course_assignments enable trigger trg_course_assignment_sync_task;
alter table public.tasks enable trigger trg_tasks_notify;
alter table public.announcements enable trigger trg_announcements_notify;
alter table public.hr_tickets enable trigger trg_hr_tickets_after_insert;

-- Журнал аудита начинаем с чистого листа
truncate table public.audit_log restart identity;

drop schema if exists seed_tmp cascade;


notify pgrst, 'reload schema';
