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
