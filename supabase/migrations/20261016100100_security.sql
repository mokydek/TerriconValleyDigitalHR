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
