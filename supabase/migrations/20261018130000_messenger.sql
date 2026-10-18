-- =====================================================================
-- JanaMen: мессенджер как в Telegram
--   группы и каналы с владельцем и админами, «Избранное», закреп и «без звука»,
--   фото/видео/файлы/голосовые/контакты, реакции, опросы, ответы, пересылка,
--   редактирование и удаление, закреплённое сообщение, служебные события, упоминания.
-- Писать можно только через функции ниже: каждая проверяет участие в чате и роль.
-- =====================================================================

-- ---------- Чаты ----------

alter table public.chats drop constraint if exists chats_kind_check;
alter table public.chats add constraint chats_kind_check check (kind in ('direct', 'group', 'channel', 'saved'));
alter table public.chats add column if not exists description text;
alter table public.chats add column if not exists avatar text;
alter table public.chats add column if not exists pinned_message_id uuid;
alter table public.chats drop constraint if exists chats_description_len;
alter table public.chats add constraint chats_description_len check (description is null or length(description) <= 500);
alter table public.chats drop constraint if exists chats_avatar_check;
alter table public.chats add constraint chats_avatar_check
  check (avatar is null or (avatar ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' and length(avatar) <= 400000));

-- ---------- Участники: роль, «без звука», закреплённый чат ----------

alter table public.chat_members add column if not exists role text not null default 'member';
alter table public.chat_members drop constraint if exists chat_members_role_check;
alter table public.chat_members add constraint chat_members_role_check check (role in ('owner', 'admin', 'member'));
alter table public.chat_members add column if not exists muted boolean not null default false;
alter table public.chat_members add column if not exists pinned boolean not null default false;
-- создатель уже существующих групп становится владельцем
update public.chat_members m set role = 'owner'
  from public.chats c
 where c.id = m.chat_id and c.kind in ('group', 'channel') and c.created_by = m.employee_id and m.role = 'member';

-- ---------- Сообщения ----------

alter table public.chat_messages drop constraint if exists chat_messages_body_check;
alter table public.chat_messages drop constraint if exists chat_messages_body_len;
alter table public.chat_messages add constraint chat_messages_body_len check (length(body) <= 4000);
alter table public.chat_messages alter column body set default '';
alter table public.chat_messages add column if not exists kind text not null default 'text';
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'system', 'poll'));
-- служебное событие: {event, targets[], title, message}; текст собирает интерфейс на языке читателя
alter table public.chat_messages add column if not exists meta jsonb;
alter table public.chat_messages add column if not exists edited_at timestamptz;
alter table public.chat_messages add column if not exists deleted_at timestamptz;
alter table public.chat_messages add column if not exists forward_author_id uuid;
alter table public.chat_messages add column if not exists forward_chat_title text;
alter table public.chat_messages drop constraint if exists chat_messages_forward_author_fk;
alter table public.chat_messages add constraint chat_messages_forward_author_fk
  foreign key (forward_author_id) references public.employees (id) on delete set null;

alter table public.chats drop constraint if exists chats_pinned_message_fk;
alter table public.chats add constraint chats_pinned_message_fk
  foreign key (pinned_message_id) references public.chat_messages (id) on delete set null;

-- ---------- Вложения: фото, видео, файл, голосовое, контакт коллеги ----------
-- Файл хранится data URL прямо в базе (как фото профиля): одинаково в облаке и в Docker-стеке.
-- Список сообщений берёт только описание и маленькое превью, сам файл грузится по требованию.

create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  chat_id uuid not null,
  kind text not null check (kind in ('image', 'video', 'file', 'voice', 'contact')),
  name text not null default '' check (length(name) <= 200),
  mime text not null default '' check (length(mime) <= 120),
  size integer not null default 0 check (size >= 0),
  data text,
  thumb text,
  width integer,
  height integer,
  duration numeric(8, 2),
  waveform jsonb,
  contact_id uuid,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint chat_attachments_message_fk foreign key (message_id) references public.chat_messages (id) on delete cascade,
  constraint chat_attachments_chat_fk foreign key (chat_id) references public.chats (id) on delete cascade,
  constraint chat_attachments_contact_fk foreign key (contact_id) references public.employees (id) on delete cascade,
  -- data URL из интерфейса или ссылка на фото Unsplash в демо-данных
  constraint chat_attachments_data_check check (
    data is null or ((data ~ '^data:[a-z0-9.+/-]+;base64,' or data ~ '^https://images\.unsplash\.com/') and length(data) <= 7000000)),
  constraint chat_attachments_thumb_check check (
    thumb is null or ((thumb ~ '^data:image/(jpeg|png|webp);base64,' or thumb ~ '^https://images\.unsplash\.com/') and length(thumb) <= 80000)),
  constraint chat_attachments_payload check ((kind = 'contact') = (contact_id is not null) and (kind = 'contact' or data is not null))
);
create index if not exists chat_attachments_message_idx on public.chat_attachments (message_id, position);
create index if not exists chat_attachments_media_idx on public.chat_attachments (chat_id, kind, created_at desc);

-- ---------- Реакции: одна на человека, как в Telegram ----------

create table if not exists public.chat_reactions (
  message_id uuid not null,
  chat_id uuid not null,
  employee_id uuid not null,
  reaction text not null check (reaction in ('like', 'heart', 'fire', 'party', 'laugh', 'ok')),
  created_at timestamptz not null default now(),
  primary key (message_id, employee_id),
  constraint chat_reactions_message_fk foreign key (message_id) references public.chat_messages (id) on delete cascade,
  constraint chat_reactions_chat_fk foreign key (chat_id) references public.chats (id) on delete cascade,
  constraint chat_reactions_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade
);

-- ---------- Опросы ----------

create table if not exists public.chat_polls (
  message_id uuid primary key,
  chat_id uuid not null,
  question text not null check (length(btrim(question)) between 1 and 300),
  options jsonb not null,             -- [{id, text}]
  multiple boolean not null default false,
  anonymous boolean not null default true,
  closed_at timestamptz,
  constraint chat_polls_message_fk foreign key (message_id) references public.chat_messages (id) on delete cascade,
  constraint chat_polls_chat_fk foreign key (chat_id) references public.chats (id) on delete cascade
);

create table if not exists public.chat_poll_votes (
  message_id uuid not null,
  chat_id uuid not null,
  employee_id uuid not null,
  option_id integer not null,
  created_at timestamptz not null default now(),
  primary key (message_id, employee_id, option_id),
  constraint chat_poll_votes_poll_fk foreign key (message_id) references public.chat_polls (message_id) on delete cascade,
  constraint chat_poll_votes_employee_fk foreign key (employee_id) references public.employees (id) on delete cascade
);

-- ---------- Права на чтение ----------

alter table public.chat_attachments enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_polls enable row level security;
alter table public.chat_poll_votes enable row level security;
drop policy if exists chat_attachments_select on public.chat_attachments;
drop policy if exists chat_reactions_select on public.chat_reactions;
drop policy if exists chat_polls_select on public.chat_polls;
drop policy if exists chat_poll_votes_select on public.chat_poll_votes;
create policy chat_attachments_select on public.chat_attachments for select to authenticated using (public.is_chat_member(chat_id));
create policy chat_reactions_select on public.chat_reactions for select to authenticated using (public.is_chat_member(chat_id));
create policy chat_polls_select on public.chat_polls for select to authenticated using (public.is_chat_member(chat_id));
-- голоса анонимного опроса видны только самому голосующему; итоги отдаёт chat_poll_state()
create policy chat_poll_votes_select on public.chat_poll_votes for select to authenticated
  using (public.is_chat_member(chat_id)
         and (employee_id = public.current_employee_id()
              or not exists (select 1 from public.chat_polls p where p.message_id = chat_poll_votes.message_id and p.anonymous)));

grant select on public.chat_attachments, public.chat_reactions, public.chat_polls, public.chat_poll_votes to authenticated;
revoke insert, update, delete on public.chat_attachments, public.chat_reactions, public.chat_polls, public.chat_poll_votes from authenticated;
grant select, insert, update, delete on public.chat_attachments, public.chat_reactions, public.chat_polls, public.chat_poll_votes to service_role;
revoke all on public.chat_attachments, public.chat_reactions, public.chat_polls, public.chat_poll_votes from anon;

-- ---------- Вспомогательные ----------

-- Роль текущего пользователя в чате (null — не участник)
create or replace function public.chat_role(p_chat uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from public.chat_members m where m.chat_id = p_chat and m.employee_id = public.current_employee_id()
$$;

-- Может ли текущий пользователь писать в чат: в канале только владелец и админы
create or replace function public.chat_can_post(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chats c join public.chat_members m on m.chat_id = c.id
                  where c.id = p_chat and m.employee_id = public.current_employee_id()
                    and (c.kind <> 'channel' or m.role in ('owner', 'admin')))
$$;

-- Служебное сообщение в ленте («создал группу», «добавил …», «закрепил сообщение»)
create or replace function public.chat_system_event(p_chat uuid, p_event text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := clock_timestamp();
begin
  insert into public.chat_messages (chat_id, author_id, body, kind, meta, created_at)
  values (p_chat, public.current_employee_id(), '', 'system', jsonb_build_object('event', p_event) || coalesce(p_meta, '{}'::jsonb), v_at);
  update public.chats set last_message_at = v_at where id = p_chat;
  update public.chat_members set last_read_at = greatest(last_read_at, v_at)
   where chat_id = p_chat and employee_id = public.current_employee_id();
end $$;

-- Проверка и запись вложений одного сообщения
create or replace function public.chat_store_attachments(p_chat uuid, p_message uuid, p_attachments jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a jsonb; v_kind text; v_data text; v_thumb text; v_mime text; v_total bigint := 0; v_pos int := 0;
begin
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then return 0; end if;
  if jsonb_array_length(p_attachments) > 10 then raise exception 'Не больше 10 вложений в одном сообщении'; end if;
  for a in select value from jsonb_array_elements(p_attachments) loop
    v_kind := a->>'kind';
    v_data := a->>'data';
    v_thumb := nullif(a->>'thumb', '');
    v_mime := coalesce(a->>'mime', '');
    if v_kind not in ('image', 'video', 'file', 'voice', 'contact') then raise exception 'Неизвестный тип вложения'; end if;
    if v_kind = 'contact' then
      if not exists (select 1 from public.employees e where e.id = (a->>'contact_id')::uuid and e.status <> 'terminated') then
        raise exception 'Сотрудник не найден';
      end if;
      v_data := null;
    else
      if v_data is null or v_data !~ '^data:[a-z0-9.+/-]+;base64,' then raise exception 'Файл не прочитан, приложите его ещё раз'; end if;
      if length(v_data) > 7000000 then raise exception 'Файл больше 5 МБ'; end if;
      if v_kind = 'image' and v_mime not like 'image/%' then raise exception 'Неизвестный тип вложения'; end if;
      if v_kind = 'video' and v_mime not like 'video/%' then raise exception 'Неизвестный тип вложения'; end if;
      if v_kind = 'voice' and v_mime not like 'audio/%' then raise exception 'Неизвестный тип вложения'; end if;
      v_total := v_total + length(v_data);
      if v_total > 21000000 then raise exception 'Вложения в одном сообщении больше 15 МБ'; end if;
    end if;
    if v_thumb is not null and (v_thumb !~ '^data:image/(jpeg|png|webp);base64,' or length(v_thumb) > 80000) then v_thumb := null; end if;
    insert into public.chat_attachments (message_id, chat_id, kind, name, mime, size, data, thumb, width, height, duration, waveform, contact_id, position)
    values (p_message, p_chat, v_kind, left(coalesce(a->>'name', ''), 200), left(v_mime, 120),
            greatest(0, coalesce((a->>'size')::bigint, 0))::int, v_data, v_thumb,
            nullif(a->>'width', '')::int, nullif(a->>'height', '')::int,
            least(600, greatest(0, coalesce(nullif(a->>'duration', '')::numeric, 0))),
            case when jsonb_typeof(a->'waveform') = 'array' and jsonb_array_length(a->'waveform') <= 64 then a->'waveform' end,
            case when v_kind = 'contact' then (a->>'contact_id')::uuid end, v_pos);
    v_pos := v_pos + 1;
  end loop;
  return v_pos;
end $$;

-- Уведомить упомянутых (@Имя) участников группы или канала
create or replace function public.chat_notify_mentions(p_chat uuid, p_body text, p_mentions uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_title text;
begin
  if p_mentions is null or array_length(p_mentions, 1) is null then return; end if;
  select c.title into v_title from public.chats c where c.id = p_chat and c.kind in ('group', 'channel');
  if v_title is null then return; end if;
  insert into public.notifications (employee_id, title, body, link, kind)
  select distinct m.employee_id, 'Вас упомянули в чате «' || v_title || '»',
         public.employee_name(v_me) || ': ' || left(p_body, 140), '/messages?chat=' || p_chat, 'info'
    from public.chat_members m
   where m.chat_id = p_chat and m.employee_id = any (p_mentions) and m.employee_id <> v_me;
end $$;

-- ---------- Отправка ----------

drop function if exists public.send_message(uuid, text, uuid);
create or replace function public.send_message(p_chat uuid, p_body text default '', p_reply_to uuid default null,
                                               p_attachments jsonb default '[]'::jsonb, p_mentions uuid[] default null)
returns public.chat_messages language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id(); v_body text := btrim(coalesce(p_body, '')); v_msg public.chat_messages;
  v_count int := coalesce(jsonb_array_length(case when jsonb_typeof(p_attachments) = 'array' then p_attachments end), 0);
begin
  if v_me is null or not public.is_chat_member(p_chat) then raise exception 'Чат не найден' using errcode = '42501'; end if;
  if not public.chat_can_post(p_chat) then raise exception 'В канале публикуют только администраторы' using errcode = '42501'; end if;
  if v_body = '' and v_count = 0 then raise exception 'Сообщение пустое'; end if;
  if length(v_body) > 4000 then raise exception 'Сообщение длиннее 4000 символов'; end if;
  if p_reply_to is not null
     and not exists (select 1 from public.chat_messages m where m.id = p_reply_to and m.chat_id = p_chat and m.deleted_at is null) then
    raise exception 'Сообщение для ответа не найдено';
  end if;
  insert into public.chat_messages (chat_id, author_id, body, reply_to, created_at)
  values (p_chat, v_me, v_body, p_reply_to, clock_timestamp()) returning * into v_msg;
  perform public.chat_store_attachments(p_chat, v_msg.id, p_attachments);
  update public.chats set last_message_at = v_msg.created_at where id = p_chat;
  update public.chat_members set last_read_at = v_msg.created_at where chat_id = p_chat and employee_id = v_me;
  if v_body <> '' then perform public.chat_notify_mentions(p_chat, v_body, p_mentions); end if;
  return v_msg;
end $$;

-- Изменить своё сообщение
create or replace function public.edit_message(p_message uuid, p_body text)
returns public.chat_messages language plpgsql security definer set search_path = public as $$
declare v_msg public.chat_messages; v_body text := btrim(coalesce(p_body, ''));
begin
  select * into v_msg from public.chat_messages where id = p_message;
  if v_msg.id is null or not public.is_chat_member(v_msg.chat_id) or v_msg.deleted_at is not null then
    raise exception 'Сообщение не найдено';
  end if;
  if v_msg.author_id <> public.current_employee_id() or v_msg.kind <> 'text' then
    raise exception 'Изменить можно только своё сообщение' using errcode = '42501';
  end if;
  if length(v_body) > 4000 then raise exception 'Сообщение длиннее 4000 символов'; end if;
  if v_body = '' and not exists (select 1 from public.chat_attachments a where a.message_id = p_message) then
    raise exception 'Сообщение пустое';
  end if;
  if v_body = v_msg.body then return v_msg; end if;
  update public.chat_messages set body = v_body, edited_at = now() where id = p_message returning * into v_msg;
  return v_msg;
end $$;

-- Удалить сообщение: своё всегда, в группе и канале — любое для владельца и админов
create or replace function public.delete_message(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_msg public.chat_messages; v_kind text;
begin
  select * into v_msg from public.chat_messages where id = p_message;
  if v_msg.id is null or not public.is_chat_member(v_msg.chat_id) or v_msg.deleted_at is not null then
    raise exception 'Сообщение не найдено';
  end if;
  select kind into v_kind from public.chats where id = v_msg.chat_id;
  if v_msg.author_id <> public.current_employee_id()
     and not (v_kind in ('group', 'channel') and public.chat_role(v_msg.chat_id) in ('owner', 'admin')) then
    raise exception 'Удалить можно только своё сообщение' using errcode = '42501';
  end if;
  delete from public.chat_attachments where message_id = p_message;
  delete from public.chat_reactions where message_id = p_message;
  delete from public.chat_polls where message_id = p_message;
  update public.chat_messages set deleted_at = now(), body = '', meta = null where id = p_message;
  update public.chats set pinned_message_id = null where id = v_msg.chat_id and pinned_message_id = p_message;
end $$;

-- Поставить или снять реакцию (одна на человека: новая заменяет прежнюю)
create or replace function public.toggle_reaction(p_message uuid, p_reaction text)
returns text language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_chat uuid; v_old text;
begin
  select chat_id into v_chat from public.chat_messages where id = p_message and deleted_at is null and kind <> 'system';
  if v_chat is null or not public.is_chat_member(v_chat) then raise exception 'Сообщение не найдено'; end if;
  if p_reaction not in ('like', 'heart', 'fire', 'party', 'laugh', 'ok') then raise exception 'Неизвестная реакция'; end if;
  select reaction into v_old from public.chat_reactions where message_id = p_message and employee_id = v_me;
  if v_old = p_reaction then
    delete from public.chat_reactions where message_id = p_message and employee_id = v_me;
    return null;
  end if;
  insert into public.chat_reactions (message_id, chat_id, employee_id, reaction) values (p_message, v_chat, v_me, p_reaction)
  on conflict (message_id, employee_id) do update set reaction = excluded.reaction, created_at = now();
  return p_reaction;
end $$;

-- Переслать сообщения в другой чат (можно с комментарием)
create or replace function public.forward_messages(p_messages uuid[], p_to uuid, p_comment text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id(); v_src record; v_new uuid; v_n int := 0; v_at timestamptz;
begin
  if v_me is null or not public.is_chat_member(p_to) then raise exception 'Чат не найден' using errcode = '42501'; end if;
  if not public.chat_can_post(p_to) then raise exception 'В канале публикуют только администраторы' using errcode = '42501'; end if;
  if coalesce(array_length(p_messages, 1), 0) = 0 then raise exception 'Выберите сообщения'; end if;
  if array_length(p_messages, 1) > 50 then raise exception 'Можно переслать не больше 50 сообщений за раз'; end if;
  if nullif(btrim(coalesce(p_comment, '')), '') is not null then
    perform public.send_message(p_to, p_comment);
  end if;
  for v_src in
    select m.*, c.kind as chat_kind, c.title as chat_title
      from public.chat_messages m join public.chats c on c.id = m.chat_id
     where m.id = any (p_messages) and m.deleted_at is null and m.kind = 'text'
     order by m.created_at
  loop
    if not public.is_chat_member(v_src.chat_id) then raise exception 'Сообщение не найдено'; end if;
    v_at := clock_timestamp();
    insert into public.chat_messages (chat_id, author_id, body, forward_author_id, forward_chat_title, created_at)
    values (p_to, v_me, v_src.body, coalesce(v_src.forward_author_id, v_src.author_id),
            coalesce(v_src.forward_chat_title, case when v_src.chat_kind = 'channel' then v_src.chat_title end), v_at)
    returning id into v_new;
    insert into public.chat_attachments (message_id, chat_id, kind, name, mime, size, data, thumb, width, height, duration, waveform, contact_id, position)
    select v_new, p_to, a.kind, a.name, a.mime, a.size, a.data, a.thumb, a.width, a.height, a.duration, a.waveform, a.contact_id, a.position
      from public.chat_attachments a where a.message_id = v_src.id;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Сообщение не найдено'; end if;
  update public.chats set last_message_at = v_at where id = p_to;
  update public.chat_members set last_read_at = v_at where chat_id = p_to and employee_id = v_me;
  return v_n;
end $$;

-- Закрепить сообщение (null — открепить). В группе и канале — владелец и админы
create or replace function public.pin_message(p_chat uuid, p_message uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_kind text;
begin
  if not public.is_chat_member(p_chat) then raise exception 'Чат не найден' using errcode = '42501'; end if;
  select kind into v_kind from public.chats where id = p_chat;
  if v_kind in ('group', 'channel') and public.chat_role(p_chat) not in ('owner', 'admin') then
    raise exception 'Закреплять сообщения могут владелец и администраторы' using errcode = '42501';
  end if;
  if p_message is not null and not exists (
       select 1 from public.chat_messages m where m.id = p_message and m.chat_id = p_chat and m.deleted_at is null and m.kind <> 'system') then
    raise exception 'Сообщение не найдено';
  end if;
  update public.chats set pinned_message_id = p_message where id = p_chat;
  if p_message is not null and v_kind in ('group', 'channel') then
    perform public.chat_system_event(p_chat, 'pinned', jsonb_build_object('message', p_message));
  end if;
end $$;

-- ---------- Группы и каналы ----------

drop function if exists public.create_group_chat(text, uuid[]);
create or replace function public.create_group_chat(p_title text, p_members uuid[], p_kind text default 'group',
                                                    p_description text default null, p_avatar text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_chat uuid; v_ids uuid[];
begin
  if v_me is null then raise exception 'Сотрудник не найден' using errcode = '42501'; end if;
  if p_kind not in ('group', 'channel') then raise exception 'Неизвестный тип чата'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'Укажите название группы'; end if;
  select array_agg(distinct e.id) into v_ids from public.employees e
   where e.id = any (coalesce(p_members, '{}')) and e.id <> v_me and e.status <> 'terminated';
  if coalesce(array_length(v_ids, 1), 0) < 1 then raise exception 'Выберите хотя бы одного коллегу'; end if;
  if array_length(v_ids, 1) > 300 then raise exception 'В группе может быть не больше 300 человек'; end if;
  insert into public.chats (kind, title, description, avatar, created_by)
  values (p_kind, left(btrim(p_title), 80), nullif(left(btrim(coalesce(p_description, '')), 500), ''), p_avatar, v_me)
  returning id into v_chat;
  insert into public.chat_members (chat_id, employee_id, role) values (v_chat, v_me, 'owner');
  insert into public.chat_members (chat_id, employee_id) select v_chat, x from unnest(v_ids) x;
  perform public.chat_system_event(v_chat, 'created', jsonb_build_object('title', left(btrim(p_title), 80)));
  return v_chat;
end $$;

-- Название, описание, фото группы или канала (владелец и админы)
create or replace function public.update_chat(p_chat uuid, p_title text default null, p_description text default null,
                                              p_avatar text default null, p_clear_avatar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_old public.chats;
begin
  select * into v_old from public.chats where id = p_chat;
  if v_old.id is null or not public.is_chat_member(p_chat) then raise exception 'Чат не найден' using errcode = '42501'; end if;
  if v_old.kind not in ('group', 'channel') or public.chat_role(p_chat) not in ('owner', 'admin') then
    raise exception 'Менять группу могут владелец и администраторы' using errcode = '42501';
  end if;
  if p_title is not null and btrim(p_title) = '' then raise exception 'Укажите название группы'; end if;
  update public.chats
     set title = coalesce(left(btrim(p_title), 80), title),
         description = case when p_description is null then description else nullif(left(btrim(p_description), 500), '') end,
         avatar = case when p_clear_avatar then null else coalesce(p_avatar, avatar) end
   where id = p_chat;
  if p_title is not null and left(btrim(p_title), 80) <> v_old.title then
    perform public.chat_system_event(p_chat, 'renamed', jsonb_build_object('title', left(btrim(p_title), 80)));
  end if;
  if p_avatar is not null or (p_clear_avatar and v_old.avatar is not null) then
    perform public.chat_system_event(p_chat, case when p_clear_avatar then 'photo_removed' else 'photo' end);
  end if;
end $$;

-- Добавить участников: в группе любой участник, в канале — владелец и админы
create or replace function public.add_chat_members(p_chat uuid, p_members uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_kind text; v_ids uuid[];
begin
  select kind into v_kind from public.chats where id = p_chat;
  if v_kind is null or not public.is_chat_member(p_chat) then raise exception 'Чат не найден' using errcode = '42501'; end if;
  if v_kind not in ('group', 'channel') then raise exception 'В личный чат нельзя добавить участников'; end if;
  if v_kind = 'channel' and public.chat_role(p_chat) not in ('owner', 'admin') then
    raise exception 'Добавлять в канал могут владелец и администраторы' using errcode = '42501';
  end if;
  select array_agg(distinct e.id) into v_ids from public.employees e
   where e.id = any (coalesce(p_members, '{}')) and e.status <> 'terminated'
     and not exists (select 1 from public.chat_members m where m.chat_id = p_chat and m.employee_id = e.id);
  if coalesce(array_length(v_ids, 1), 0) = 0 then return 0; end if;
  if (select count(*) from public.chat_members where chat_id = p_chat) + array_length(v_ids, 1) > 300 then
    raise exception 'В группе может быть не больше 300 человек';
  end if;
  insert into public.chat_members (chat_id, employee_id) select p_chat, x from unnest(v_ids) x;
  perform public.chat_system_event(p_chat, 'added', jsonb_build_object('targets', to_jsonb(v_ids)));
  return array_length(v_ids, 1);
end $$;

-- Исключить участника: владелец — любого, админ — обычных участников
create or replace function public.remove_chat_member(p_chat uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_my text := public.chat_role(p_chat); v_their text;
begin
  if v_my is null then raise exception 'Чат не найден' using errcode = '42501'; end if;
  select role into v_their from public.chat_members where chat_id = p_chat and employee_id = p_member;
  if v_their is null then raise exception 'Сотрудник не найден'; end if;
  if p_member = public.current_employee_id() then raise exception 'Чтобы выйти, нажмите «Покинуть группу»'; end if;
  if not exists (select 1 from public.chats where id = p_chat and kind in ('group', 'channel'))
     or not (v_my = 'owner' or (v_my = 'admin' and v_their = 'member')) then
    raise exception 'Недостаточно прав в этой группе' using errcode = '42501';
  end if;
  delete from public.chat_members where chat_id = p_chat and employee_id = p_member;
  perform public.chat_system_event(p_chat, 'removed', jsonb_build_object('targets', jsonb_build_array(p_member)));
end $$;

-- Покинуть группу или канал. Уходящий владелец передаёт права админу или самому давнему участнику
create or replace function public.leave_chat(p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_role text := public.chat_role(p_chat); v_heir uuid;
begin
  if v_role is null then raise exception 'Чат не найден' using errcode = '42501'; end if;
  if not exists (select 1 from public.chats where id = p_chat and kind in ('group', 'channel')) then
    raise exception 'Покинуть можно только группу или канал';
  end if;
  perform public.chat_system_event(p_chat, 'left');
  delete from public.chat_members where chat_id = p_chat and employee_id = v_me;
  if not exists (select 1 from public.chat_members where chat_id = p_chat) then
    delete from public.chats where id = p_chat;
    return;
  end if;
  if v_role = 'owner' then
    select employee_id into v_heir from public.chat_members where chat_id = p_chat
     order by (role = 'admin') desc, joined_at limit 1;
    update public.chat_members set role = 'owner' where chat_id = p_chat and employee_id = v_heir;
  end if;
end $$;

-- Назначить или снять администратора (только владелец)
create or replace function public.set_chat_member_role(p_chat uuid, p_member uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.chat_role(p_chat) is distinct from 'owner' then
    raise exception 'Назначать администраторов может только владелец' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'member') then raise exception 'Неизвестная роль'; end if;
  if p_member = public.current_employee_id() then raise exception 'Нельзя изменить свою роль'; end if;
  update public.chat_members set role = p_role where chat_id = p_chat and employee_id = p_member;
  if not found then raise exception 'Сотрудник не найден'; end if;
  if p_role = 'admin' then
    perform public.chat_system_event(p_chat, 'admin', jsonb_build_object('targets', jsonb_build_array(p_member)));
  end if;
end $$;

-- Личные настройки чата: «без звука» и закреп в списке
create or replace function public.set_chat_prefs(p_chat uuid, p_muted boolean default null, p_pinned boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.chat_members set muted = coalesce(p_muted, muted), pinned = coalesce(p_pinned, pinned)
   where chat_id = p_chat and employee_id = public.current_employee_id();
  if not found then raise exception 'Чат не найден' using errcode = '42501'; end if;
end $$;

-- «Избранное»: чат с самим собой для заметок и пересланного
create or replace function public.open_saved_chat()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_chat uuid;
begin
  if v_me is null then raise exception 'Сотрудник не найден' using errcode = '42501'; end if;
  select c.id into v_chat from public.chats c join public.chat_members m on m.chat_id = c.id
   where c.kind = 'saved' and m.employee_id = v_me limit 1;
  if v_chat is null then
    insert into public.chats (kind, created_by) values ('saved', v_me) returning id into v_chat;
    insert into public.chat_members (chat_id, employee_id, role) values (v_chat, v_me, 'owner');
  end if;
  return v_chat;
end $$;

-- ---------- Опросы ----------

create or replace function public.create_poll(p_chat uuid, p_question text, p_options text[],
                                              p_multiple boolean default false, p_anonymous boolean default true)
returns public.chat_messages language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id(); v_msg public.chat_messages; v_opts jsonb; v_clean text[];
begin
  if v_me is null or not public.is_chat_member(p_chat) then raise exception 'Чат не найден' using errcode = '42501'; end if;
  if not exists (select 1 from public.chats where id = p_chat and kind in ('group', 'channel')) then
    raise exception 'Опрос можно создать в группе или канале';
  end if;
  if not public.chat_can_post(p_chat) then raise exception 'В канале публикуют только администраторы' using errcode = '42501'; end if;
  if coalesce(btrim(p_question), '') = '' then raise exception 'Укажите вопрос опроса'; end if;
  select array_agg(left(btrim(o), 100) order by n) into v_clean
    from unnest(p_options) with ordinality as t(o, n) where btrim(coalesce(o, '')) <> '';
  if coalesce(array_length(v_clean, 1), 0) < 2 then raise exception 'В опросе нужно хотя бы два варианта'; end if;
  if array_length(v_clean, 1) > 10 then raise exception 'В опросе может быть не больше 10 вариантов'; end if;
  select jsonb_agg(jsonb_build_object('id', n - 1, 'text', o) order by n) into v_opts from unnest(v_clean) with ordinality as t(o, n);
  insert into public.chat_messages (chat_id, author_id, body, kind, created_at)
  values (p_chat, v_me, left(btrim(p_question), 300), 'poll', clock_timestamp()) returning * into v_msg;
  insert into public.chat_polls (message_id, chat_id, question, options, multiple, anonymous)
  values (v_msg.id, p_chat, left(btrim(p_question), 300), v_opts, coalesce(p_multiple, false), coalesce(p_anonymous, true));
  update public.chats set last_message_at = v_msg.created_at where id = p_chat;
  update public.chat_members set last_read_at = v_msg.created_at where chat_id = p_chat and employee_id = v_me;
  return v_msg;
end $$;

-- Проголосовать (пустой список — отозвать голос)
create or replace function public.vote_poll(p_message uuid, p_options integer[])
returns void language plpgsql security definer set search_path = public as $$
declare v_poll public.chat_polls; v_me uuid := public.current_employee_id(); v_n int; v_max int;
begin
  select * into v_poll from public.chat_polls where message_id = p_message;
  if v_poll.message_id is null or not public.is_chat_member(v_poll.chat_id) then raise exception 'Опрос не найден'; end if;
  if v_poll.closed_at is not null then raise exception 'Опрос уже завершён'; end if;
  v_n := coalesce(array_length(p_options, 1), 0);
  v_max := jsonb_array_length(v_poll.options) - 1;
  if v_n > 1 and not v_poll.multiple then raise exception 'В этом опросе можно выбрать только один вариант'; end if;
  if exists (select 1 from unnest(coalesce(p_options, '{}')) o where o < 0 or o > v_max) then raise exception 'Нет такого варианта'; end if;
  delete from public.chat_poll_votes where message_id = p_message and employee_id = v_me;
  insert into public.chat_poll_votes (message_id, chat_id, employee_id, option_id)
  select distinct p_message, v_poll.chat_id, v_me, o from unnest(coalesce(p_options, '{}')) o;
end $$;

create or replace function public.close_poll(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_poll public.chat_polls; v_author uuid;
begin
  select * into v_poll from public.chat_polls where message_id = p_message;
  if v_poll.message_id is null or not public.is_chat_member(v_poll.chat_id) then raise exception 'Опрос не найден'; end if;
  select author_id into v_author from public.chat_messages where id = p_message;
  if v_author <> public.current_employee_id() and public.chat_role(v_poll.chat_id) not in ('owner', 'admin') then
    raise exception 'Завершить опрос может автор или администратор' using errcode = '42501';
  end if;
  update public.chat_polls set closed_at = coalesce(closed_at, now()) where message_id = p_message;
end $$;

-- Итоги опросов: число голосов по вариантам, мои голоса, а в открытом опросе — кто как проголосовал
create or replace function public.chat_poll_state(p_messages uuid[])
returns table (message_id uuid, counts jsonb, total integer, mine integer[], voters jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id();
begin
  return query
  select p.message_id,
         coalesce((select jsonb_object_agg(x.option_id, x.n) from
                    (select v.option_id, count(*) as n from public.chat_poll_votes v where v.message_id = p.message_id group by v.option_id) x),
                  '{}'::jsonb),
         (select count(distinct v.employee_id)::int from public.chat_poll_votes v where v.message_id = p.message_id),
         coalesce((select array_agg(v.option_id order by v.option_id) from public.chat_poll_votes v
                    where v.message_id = p.message_id and v.employee_id = v_me), '{}'),
         case when p.anonymous then null else
           coalesce((select jsonb_object_agg(x.option_id, x.ids) from
                      (select v.option_id, jsonb_agg(v.employee_id order by v.created_at) as ids
                         from public.chat_poll_votes v where v.message_id = p.message_id group by v.option_id) x), '{}'::jsonb)
         end
    from public.chat_polls p
   where p.message_id = any (p_messages) and public.is_chat_member(p.chat_id);
end $$;

-- ---------- Список чатов ----------

drop function if exists public.chat_list();
create or replace function public.chat_list()
returns table (id uuid, kind text, title text, peer_id uuid, member_count integer, avatar text, description text,
               my_role text, muted boolean, pinned boolean,
               last_body text, last_kind text, last_meta jsonb, last_attachment text, last_attachments integer,
               last_author_id uuid, last_author_name text, last_at timestamptz, unread integer)
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id();
begin
  return query
  select c.id, c.kind,
         case when c.kind = 'direct' then public.employee_name(peer.employee_id) else c.title end,
         peer.employee_id,
         (select count(*)::int from public.chat_members m where m.chat_id = c.id),
         c.avatar, c.description, mine.role, mine.muted, mine.pinned,
         lm.body, lm.kind, lm.meta,
         (select a.kind from public.chat_attachments a where a.message_id = lm.id order by a.position limit 1),
         (select count(*)::int from public.chat_attachments a where a.message_id = lm.id),
         lm.author_id, public.employee_name(lm.author_id), coalesce(lm.created_at, c.created_at),
         (select count(*)::int from public.chat_messages x
           where x.chat_id = c.id and x.author_id <> v_me and x.deleted_at is null and x.created_at > mine.last_read_at)
  from public.chat_members mine
  join public.chats c on c.id = mine.chat_id
  left join lateral (select m.employee_id from public.chat_members m
                      where c.kind = 'direct' and m.chat_id = c.id and m.employee_id <> v_me limit 1) peer on true
  left join lateral (select x.id, x.body, x.kind, x.meta, x.author_id, x.created_at from public.chat_messages x
                      where x.chat_id = c.id and x.deleted_at is null order by x.created_at desc limit 1) lm on true
  where mine.employee_id = v_me
  order by mine.pinned desc, coalesce(lm.created_at, c.created_at) desc;
end $$;

-- ---------- Права на функции ----------

do $$
declare f text;
begin
  foreach f in array array[
    'public.chat_role(uuid)', 'public.chat_can_post(uuid)',
    'public.send_message(uuid, text, uuid, jsonb, uuid[])', 'public.edit_message(uuid, text)', 'public.delete_message(uuid)',
    'public.toggle_reaction(uuid, text)', 'public.forward_messages(uuid[], uuid, text)', 'public.pin_message(uuid, uuid)',
    'public.create_group_chat(text, uuid[], text, text, text)', 'public.update_chat(uuid, text, text, text, boolean)',
    'public.add_chat_members(uuid, uuid[])', 'public.remove_chat_member(uuid, uuid)', 'public.leave_chat(uuid)',
    'public.set_chat_member_role(uuid, uuid, text)', 'public.set_chat_prefs(uuid, boolean, boolean)', 'public.open_saved_chat()',
    'public.create_poll(uuid, text, text[], boolean, boolean)', 'public.vote_poll(uuid, integer[])', 'public.close_poll(uuid)',
    'public.chat_poll_state(uuid[])', 'public.chat_list()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- внутренние помощники вызываются только из функций выше
  foreach f in array array[
    'public.chat_system_event(uuid, text, jsonb)', 'public.chat_store_attachments(uuid, uuid, jsonb)',
    'public.chat_notify_mentions(uuid, text, uuid[])'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------- Realtime: реакции, правки, голоса и прочтения приходят сразу ----------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['public.chat_messages', 'public.chat_reactions', 'public.chat_poll_votes', 'public.chat_members', 'public.chats'] loop
      begin
        execute format('alter publication supabase_realtime add table %s', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
