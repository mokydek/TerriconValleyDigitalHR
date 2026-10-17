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
