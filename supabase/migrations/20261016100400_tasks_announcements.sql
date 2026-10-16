-- =====================================================================
-- JanaМен — 5/7. Задачи и объявления
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
