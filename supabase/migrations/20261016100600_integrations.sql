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
