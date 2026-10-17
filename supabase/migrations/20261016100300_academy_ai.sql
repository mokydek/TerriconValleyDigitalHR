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
