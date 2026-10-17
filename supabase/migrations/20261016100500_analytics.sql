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
