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
