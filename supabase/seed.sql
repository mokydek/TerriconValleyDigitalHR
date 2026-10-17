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
alter table public.tasks disable trigger trg_tasks_notify;
alter table public.announcements disable trigger trg_announcements_notify;
alter table public.hr_tickets disable trigger trg_hr_tickets_after_insert;

create or replace function seed_tmp.emp(p_tab text) returns uuid language sql stable as $$
  select id from public.employees where zup_id = p_tab
$$;

-- ---------- Производственный календарь РК ----------

insert into public.holidays (day, name) values
  ('2026-01-01', 'Новый год'), ('2026-01-02', 'Новый год'), ('2026-01-07', 'Рождество Христово'),
  ('2026-03-08', 'Международный женский день'), ('2026-03-21', 'Наурыз мейрамы'), ('2026-03-22', 'Наурыз мейрамы'),
  ('2026-03-23', 'Наурыз мейрамы'), ('2026-05-01', 'Праздник единства народа Казахстана'),
  ('2026-05-07', 'День защитника Отечества'), ('2026-05-09', 'День Победы'), ('2026-05-27', 'Курбан айт'),
  ('2026-07-06', 'День Столицы'), ('2026-08-30', 'День Конституции'), ('2026-10-25', 'День Республики'),
  ('2026-10-26', 'Перенос выходного дня (День Республики)'), ('2026-12-16', 'День Независимости'),
  ('2027-01-01', 'Новый год'), ('2027-01-02', 'Новый год'), ('2027-01-07', 'Рождество Христово'),
  ('2027-03-08', 'Международный женский день'), ('2027-03-21', 'Наурыз мейрамы'), ('2027-03-22', 'Наурыз мейрамы'),
  ('2027-03-23', 'Наурыз мейрамы'), ('2027-05-01', 'Праздник единства народа Казахстана'),
  ('2027-05-07', 'День защитника Отечества'), ('2027-05-09', 'День Победы'), ('2027-07-06', 'День Столицы'),
  ('2027-08-30', 'День Конституции'), ('2027-10-25', 'День Республики'), ('2027-12-16', 'День Независимости');

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
     'Пик сезона после 11.11. Перенесите, пожалуйста, на декабрь. Готов согласовать с 14.12'),
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

insert into public.courses (slug, title, description, category, emoji, duration_minutes, is_mandatory, pass_score) values
  ('welcome', 'Добро пожаловать в Jana Post',
   'Адаптационный курс: кто мы, наши ценности, как устроены HR-сервисы в JanaMen и что важно в первые дни.',
   'onboarding', '📦', 25, true, 70),
  ('safety', 'Охрана труда на складе и в ПВЗ',
   'Базовые правила безопасной работы с грузами, техникой и в зоне сортировки. Обязателен для логистики.',
   'safety', '🦺', 30, true, 80),
  ('infosec', 'Информационная безопасность и персональные данные',
   'Пароли, фишинг, работа с персональными данными клиентов и коллег. Обязателен для всех.',
   'compliance', '🔐', 20, true, 80),
  ('service', 'Стандарты клиентского сервиса',
   'Как говорить с клиентом на ПВЗ и в поддержке: приветствие, сложные ситуации, возвраты.',
   'skills', '💬', 20, false, 70);

insert into public.course_lessons (course_id, sort, title, duration_minutes, content)
select c.id, l.sort, l.title, l.minutes, l.content
from public.courses c
join (values
  ('welcome', 1, 'Кто мы: Jana Post сегодня', 6,
   E'**Jana Post** это международная технологическая и логистическая платформа, которая обеспечивает полный цикл трансграничной торговли между Китаем и странами Центральной Азии.\n\nКомпания объединяет собственную логистическую инфраструктуру, цифровые решения и экосистему сервисов для клиентов, предпринимателей, маркетплейсов и бизнеса.\n\n### Jana Post в цифрах\n- **3+ млн** пользователей\n- **1000+** филиалов\n- **5** стран\n- **собственная IT-платформа**\n\n### Маршрут\nКитай → Казахстан → Центральная Азия: Кыргызстан, Узбекистан, Таджикистан, Монголия.\n\nКаждый сотрудник, от оператора сортировки до разработчика, участвует в этом маршруте: посылка клиента проходит через склад консолидации, сортировочный центр, курьера или пункт выдачи.'),
  ('welcome', 2, 'Наши ценности', 5,
   E'В основе Jana Post лежат три ценности.\n\n### 01 Открытость\nГоворим прямо, делимся информацией и признаём ошибки. Если что-то мешает работе, скажите руководителю или HR, а типовые вопросы задайте AI Jana.\n\n### 02 Надёжность\nКлиент доверяет нам свою посылку. Мы выполняем обещания, соблюдаем сроки и стандарты безопасности.\n\n### 03 Результат\nОцениваем работу по результату для клиента и команды, а не по количеству потраченных часов.'),
  ('welcome', 3, 'JanaMen: все HR-сервисы в одном окне', 7,
   E'**JanaMen** это ваш личный кабинет сотрудника.\n\n- **Профиль**: должность, подразделение, руководитель, дата приёма и остаток отпуска. Официальные данные приходят из 1С:ЗУП и доступны только для чтения; чтобы их изменить, оформите заявку «Изменение данных».\n- **Заявки**: отпуск, аванс, справка. Статус и история видны в карточке заявки, а о каждом изменении приходит уведомление.\n- **Jana Academy**: назначенные курсы, прогресс и результаты тестов.\n- **AI Jana**: ответит на типовой HR-вопрос по базе знаний и покажет источник. Если надёжного ответа нет, предложит передать вопрос в HR.\n- **Уведомления**: колокольчик в правом верхнем углу.'),
  ('welcome', 4, 'Первые дни: что важно знать', 7,
   E'### Испытательный срок\nУстанавливается трудовым договором и не может превышать трёх месяцев (Трудовой кодекс РК). В этот период вы проходите адаптационный курс и обязательные инструктажи.\n\n### Охрана труда\nДо начала работы на складе или в ПВЗ пройдите курс «Охрана труда на складе и в ПВЗ».\n\n### Куда обращаться\n- Рабочие вопросы: непосредственный руководитель.\n- Кадровые вопросы: AI Jana, затем HR через кнопку «Спросить HR».\n- Срочные ситуации на смене: старший смены.'),
  ('safety', 1, 'Общие правила безопасности', 8,
   E'- Работайте только в выданной спецодежде и обуви.\n- Проходы и эвакуационные выходы всегда свободны, не ставьте на них коробки и паллеты.\n- В зоне сортировки не пользуйтесь наушниками: вы должны слышать сигналы техники.\n- Сообщайте старшему смены о любой неисправности оборудования.'),
  ('safety', 2, 'Работа с грузами и техникой', 8,
   E'### Ручной подъём\nПрисядьте, держите спину прямо и поднимайте груз за счёт ног, близко к телу. Тяжёлые и крупногабаритные места поднимайте вдвоём или с помощью тележки.\n\n### Погрузочная техника\nУправлять погрузчиком может только обученный сотрудник с допуском. Не находитесь в зоне движения техники и под поднятым грузом.'),
  ('safety', 3, 'Пожарная безопасность и эвакуация', 7,
   E'- Знайте, где находятся огнетушители и план эвакуации вашей зоны.\n- При пожаре: сообщите по номеру **101** или **112**, предупредите коллег, отключите оборудование, если это безопасно, и выходите по плану эвакуации.\n- Не пользуйтесь лифтами при пожаре.'),
  ('safety', 4, 'Что делать при травме', 7,
   E'1. Остановите работу и сообщите старшему смены.\n2. Окажите первую помощь, при необходимости вызовите скорую (**103** или **112**).\n3. Сообщите руководителю: каждый случай фиксируется, даже если травма кажется лёгкой.'),
  ('infosec', 1, 'Пароли и доступы', 5,
   E'- Не передавайте пароль никому, включая коллег и «службу поддержки».\n- Используйте разные пароли для рабочих и личных сервисов, включите двухфакторную аутентификацию.\n- Блокируйте компьютер, когда отходите (Win+L / Ctrl+Cmd+Q).'),
  ('infosec', 2, 'Фишинг: как распознать', 5,
   E'Признаки фишингового письма или сообщения:\n- срочность и давление («аккаунт заблокируют через час»);\n- ссылка ведёт на похожий, но чужой адрес;\n- просьба сообщить пароль, код из SMS или данные карты.\n\nСомневаетесь? Не переходите по ссылке и перешлите письмо в IT.'),
  ('infosec', 3, 'Персональные данные', 5,
   E'Персональные данные клиентов и коллег (ИИН, адрес, телефон, данные посылок) используются только для работы и не передаются третьим лицам.\n\n- Не фотографируйте накладные и экраны с данными клиентов.\n- Не пересылайте данные в личные мессенджеры.\n- В JanaMen каждый видит только то, что разрешено его роли: например, руководитель не видит зарплату и персональные данные сотрудников.'),
  ('infosec', 4, 'Если что-то пошло не так', 5,
   E'Отправили данные не туда, потеряли телефон с рабочими доступами, заметили подозрительную активность, сразу сообщите в IT и руководителю. Быстрая реакция важнее, чем поиск виноватых.'),
  ('service', 1, 'Приветствие и тон', 7,
   E'Здоровайтесь первым, называйте себя и улыбайтесь: даже по телефону это слышно. Говорите на языке клиента: казахском или русском.'),
  ('service', 2, 'Сложные ситуации', 7,
   E'Клиент недоволен задержкой? Выслушайте, не перебивая, признайте проблему, объясните, что вы уже делаете, и назовите срок следующего шага.'),
  ('service', 3, 'Возвраты и претензии', 6,
   E'Примите претензию, зарегистрируйте её в системе и выдайте клиенту номер обращения. Не обещайте того, что не можете гарантировать.')
) as l(slug, sort, title, minutes, content) on l.slug = c.slug;

create table seed_tmp.questions (slug text, sort int, question text, options jsonb, correct int, explanation text);
insert into seed_tmp.questions values
  ('welcome', 1, 'Какие ценности лежат в основе Jana Post?',
   '["Открытость, Надёжность, Результат", "Скорость, Цена, Объём", "Инновации, Рост, Прибыль", "Лояльность, Дисциплина, Контроль"]', 0,
   'Три ценности Jana Post: Открытость, Надёжность и Результат (урок 2).'),
  ('welcome', 2, 'Где оформить заявку на отпуск или аванс?',
   '["В JanaMen → «Заявки»", "Только на бумаге в бухгалтерии", "В личном сообщении руководителю", "По телефону в HR"]', 0,
   'Все типовые заявки оформляются в JanaMen, там же видны статус и история (урок 3).'),
  ('welcome', 3, 'Какова минимальная продолжительность ежегодного оплачиваемого отпуска по Трудовому кодексу РК?',
   '["14 календарных дней", "21 календарный день", "24 календарных дня", "28 календарных дней"]', 2,
   'Ежегодный оплачиваемый трудовой отпуск: не менее 24 календарных дней.'),
  ('welcome', 4, 'Что делает AI Jana, если в базе знаний нет надёжного ответа?',
   '["Честно сообщает об этом и предлагает передать вопрос в HR", "Придумывает правдоподобный ответ", "Отвечает ссылкой на интернет", "Молчит"]', 0,
   'AI Jana отвечает только по базе знаний и показывает источник; без надёжного ответа передаёт вопрос в HR (урок 3).'),
  ('welcome', 5, 'Кто первым согласует заявку на отпуск?',
   '["Непосредственный руководитель", "Генеральный директор", "Бухгалтерия", "Никто, согласуется автоматически"]', 0,
   'Маршрут: руководитель → HR → приказ в 1С:ЗУП.'),
  ('safety', 1, 'Как правильно поднимать тяжёлый груз вручную?',
   '["Присесть, держать спину прямо и поднимать за счёт ног", "Наклониться и поднять рывком", "Поднимать на вытянутых руках", "Тянуть груз на себя спиной"]', 0,
   'Подъём за счёт ног с прямой спиной снижает нагрузку на позвоночник.'),
  ('safety', 2, 'Можно ли ставить коробки в проходе к эвакуационному выходу?',
   '["Нет, проходы и выходы всегда свободны", "Да, если ненадолго", "Да, если это лёгкие коробки", "Только ночью"]', 0,
   'Загромождённый проход может стоить жизни при эвакуации.'),
  ('safety', 3, 'Кто может управлять погрузчиком?',
   '["Только обученный сотрудник с допуском", "Любой сотрудник склада", "Тот, кто умеет водить машину", "Старший смены по устному разрешению"]', 0,
   'К управлению техникой допускаются только обученные сотрудники.'),
  ('safety', 4, 'Что сделать первым при травме коллеги?',
   '["Остановить работу и сообщить старшему смены", "Продолжить смену и сообщить в конце дня", "Самому отвезти коллегу домой", "Ничего, если травма лёгкая"]', 0,
   'Сначала безопасность и сообщение старшему смены; каждый случай фиксируется.'),
  ('safety', 5, 'Почему в зоне сортировки нельзя работать в наушниках?',
   '["Нужно слышать сигналы техники и коллег", "Это мешает музыке", "Так требует дресс-код", "Наушники быстро ломаются"]', 0,
   'Звуковые сигналы техники входят в систему безопасности.'),
  ('infosec', 1, 'Коллега просит ваш пароль, чтобы «быстро проверить заказ». Что делать?',
   '["Отказать: пароль никому не передаётся", "Дать, если это руководитель", "Дать на один раз", "Отправить пароль в мессенджере"]', 0,
   'Пароль не передаётся никому, даже руководителю или «поддержке».'),
  ('infosec', 2, 'Какой признак говорит о фишинге?',
   '["Срочность и просьба ввести пароль по ссылке", "Письмо от коллеги с отчётом", "Приглашение на встречу в календаре", "Рассылка HR о курсе"]', 0,
   'Давление и запрос пароля или кода: главные признаки фишинга.'),
  ('infosec', 3, 'Можно ли сфотографировать экран с данными клиента, чтобы отправить другу?',
   '["Нет, данные используются только для работы", "Да, если без ИИН", "Да, если друг тоже сотрудник", "Да, в личный мессенджер"]', 0,
   'Персональные данные не передаются третьим лицам.'),
  ('infosec', 4, 'Вы потеряли телефон с рабочими доступами. Что делать?',
   '["Сразу сообщить в IT и руководителю", "Подождать, вдруг найдётся", "Ничего, телефон под паролем", "Сообщить через неделю"]', 0,
   'Быстрое сообщение позволяет вовремя заблокировать доступы.'),
  ('service', 1, 'Клиент недоволен задержкой. С чего начать?',
   '["Выслушать, не перебивая, и признать проблему", "Сразу объяснить, что виноват перевозчик", "Попросить прийти позже", "Предложить написать жалобу"]', 0,
   'Сначала выслушать и признать проблему, потом назвать следующий шаг и срок.'),
  ('service', 2, 'На каком языке общаться с клиентом?',
   '["На языке клиента: казахском или русском", "Только на русском", "Только на казахском", "На английском"]', 0,
   'Говорим на языке клиента.'),
  ('service', 3, 'Что выдать клиенту после регистрации претензии?',
   '["Номер обращения", "Ничего", "Личный номер телефона", "Скидку без согласования"]', 0,
   'Номер обращения позволяет клиенту отслеживать претензию.');

insert into public.course_questions (course_id, sort, question, options, explanation)
select c.id, q.sort, q.question, q.options, q.explanation
from seed_tmp.questions q join public.courses c on c.slug = q.slug;

insert into public.course_answer_keys (question_id, correct_index)
select cq.id, q.correct
from seed_tmp.questions q
join public.courses c on c.slug = q.slug
join public.course_questions cq on cq.course_id = c.id and cq.sort = q.sort;

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
   'Подавайте заявку не позднее чем за 14 календарных дней до начала отпуска, так руководитель успеет спланировать смены. Отпускные перечисляются не позднее чем за 3 календарных дня до начала отпуска.'),
  ('vacation-annual', 4, 'Разделение и перенос отпуска', 'разделить перенести части',
   'По согласованию с руководителем отпуск можно разделить на части; рекомендуется, чтобы одна из частей была не менее 14 календарных дней. Заявку, которая ещё не оформлена HR, можно отменить в JanaMen и подать новую. Перенос уже оформленного отпуска оформляется через HR.'),
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

insert into public.tasks (title, description, assignee_id, created_by, priority, status, category, due_date, created_at, started_at, completed_at) values
  ('Провести инструктаж новичка по работе с ТСД', 'Тимур Ахметов, 5-й день. Показать сканирование, пересорт и маркировку мест.', seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'high', 'in_progress', 'warehouse', current_date + 2, now() - interval '3 days', now() - interval '2 days', null),
  ('Инвентаризация зоны B-12', 'Сверить остатки с WMS, расхождения внести в отчёт до конца смены.', seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'medium', 'todo', 'warehouse', current_date + 5, now() - interval '1 day', null, null),
  ('Пройти курс «Информационная безопасность»', 'Обязательный курс для всех сотрудников, он есть в Jana Academy.', seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0004'), 'medium', 'todo', 'training', current_date + 11, now() - interval '3 days', null, null),
  ('Отчёт по ошибкам сортировки за неделю', null, seed_tmp.emp('JP-0013'), seed_tmp.emp('JP-0012'), 'medium', 'done', 'warehouse', current_date - 2, now() - interval '7 days', now() - interval '6 days', now() - interval '2 days'),
  ('Пройти курс «Добро пожаловать в Jana Post»', 'Адаптационный курс на 25 минут.', seed_tmp.emp('JP-0018'), seed_tmp.emp('JP-0004'), 'high', 'todo', 'training', current_date + 9, now() - interval '5 days', null, null),
  ('Получить спецодежду и пропуск', null, seed_tmp.emp('JP-0018'), seed_tmp.emp('JP-0012'), 'high', 'done', 'hr', current_date - 4, now() - interval '5 days', now() - interval '5 days', now() - interval '4 days'),
  ('Подготовить план смен на пик 11.11', 'Учесть рост объёма на 60% с 16 по 30 ноября и согласованные отпуска.', seed_tmp.emp('JP-0012'), seed_tmp.emp('JP-0011'), 'urgent', 'in_progress', 'logistics', current_date + 7, now() - interval '4 days', now() - interval '3 days', null),
  ('Согласовать график отпусков склада на декабрь', null, seed_tmp.emp('JP-0012'), seed_tmp.emp('JP-0011'), 'medium', 'todo', 'logistics', current_date + 14, now() - interval '2 days', null, null),
  ('Перемаркировать стеллажи зоны C', null, seed_tmp.emp('JP-0015'), seed_tmp.emp('JP-0012'), 'medium', 'todo', 'warehouse', current_date - 3, now() - interval '9 days', null, null),
  ('Сдать отчёт по возвратам за сентябрь', null, seed_tmp.emp('JP-0015'), seed_tmp.emp('JP-0012'), 'low', 'in_progress', 'warehouse', current_date - 1, now() - interval '8 days', now() - interval '6 days', null),
  ('Проверить исправность погрузчика №2', 'Перед ночной сменой.', seed_tmp.emp('JP-0017'), seed_tmp.emp('JP-0012'), 'high', 'review', 'warehouse', current_date, now() - interval '1 day', now() - interval '20 hours', null),
  ('Принять партию из Урумчи (рейс 1015)', null, seed_tmp.emp('JP-0014'), seed_tmp.emp('JP-0012'), 'high', 'todo', 'logistics', current_date + 1, now() - interval '5 hours', null, null),
  ('Обновить скрипты ответов по возвратам', null, seed_tmp.emp('JP-0030'), seed_tmp.emp('JP-0029'), 'medium', 'in_progress', 'client', current_date + 4, now() - interval '3 days', now() - interval '2 days', null),
  ('Подготовить отчёт по обучению за квартал', 'Курсы, прогресс, просрочки по подразделениям.', seed_tmp.emp('JP-0004'), seed_tmp.emp('JP-0002'), 'medium', 'in_progress', 'hr', current_date + 6, now() - interval '2 days', now() - interval '1 day', null),
  ('Ответить на обращения сотрудников в JanaMen', null, seed_tmp.emp('JP-0003'), seed_tmp.emp('JP-0002'), 'high', 'todo', 'hr', current_date + 1, now() - interval '1 day', null, null);

-- ---------- Объявления ----------

insert into public.announcements (title, body, category, pinned, audience_department_id, author_id, created_at) values
  ('JanaMen: все HR-сервисы в одном окне',
   E'Коллеги, запускаем JanaMen, единую HR-платформу.\n\nЗдесь вы оформляете отпуск и аванс, видите статусы заявок, проходите курсы Jana Academy и задаёте вопросы AI Jana. Официальные данные подтягиваются из 1С:ЗУП.',
   'hr', true, null, seed_tmp.emp('JP-0002'), now() - interval '6 days'),
  ('Подготовка к пику 11.11',
   E'С 16 по 30 ноября ожидаем рост объёма на 50–60%. Склад, доставка и ПВЗ работают по усиленному графику. Отпуска на эти даты только по согласованию с директором по логистике.',
   'logistics', true, null, seed_tmp.emp('JP-0011'), now() - interval '3 days'),
  ('Плановая инвентаризация в субботу',
   E'В субботу с 08:00 инвентаризация зон B и C. Старшие смен, проверьте ТСД и распечатайте листы пересчёта.',
   'urgent', false, (select id from public.departments where zup_id = 'D41'), seed_tmp.emp('JP-0012'), now() - interval '1 day'),
  ('25 октября: День Республики',
   E'25 октября: государственный праздник. Так как он выпадает на воскресенье, понедельник 26 октября выходной. Склад и ПВЗ работают по отдельному графику.',
   'event', false, null, seed_tmp.emp('JP-0003'), now() - interval '2 days'),
  ('Обязательный курс по информационной безопасности',
   E'Всем сотрудникам назначен курс «Информационная безопасность и персональные данные» (20 минут). Пройдите его до конца месяца в Jana Academy.',
   'hr', false, null, seed_tmp.emp('JP-0004'), now() - interval '3 days'),
  ('Открыт новый пункт выдачи в Шымкенте',
   E'ПВЗ в Шымкенте работает ежедневно с 09:00 до 21:00. Спасибо команде сети ПВЗ за быстрый запуск!',
   'news', false, null, seed_tmp.emp('JP-0025'), now() - interval '9 days');

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
  (seed_tmp.emp('JP-0013'), 'Заявка №1004 отклонена', 'Отпуск: Пик сезона после 11.11. Перенесите, пожалуйста, на декабрь. Готов согласовать с 14.12', '/requests', 'warning', now() - interval '10 days', now() - interval '11 days'),
  (seed_tmp.emp('JP-0013'), 'Заявка оформлена', 'Справка готова, см. карточку заявки', '/requests', 'success', now() - interval '18 days', now() - interval '19 days'),
  (seed_tmp.emp('JP-0012'), 'Новая заявка: Отпуск', 'Бауыржан Утепов · ' || to_char(current_date + 21, 'DD.MM') || '–' || to_char(current_date + 34, 'DD.MM.YYYY'), '/approvals', 'request', null, now() - interval '2 days'),
  (seed_tmp.emp('JP-0012'), 'Новая заявка: Аванс', 'Олжас Кенжебаев · 80 000 ₸', '/approvals', 'request', null, now() - interval '20 hours'),
  (seed_tmp.emp('JP-0012'), 'Задача №111 на проверке', 'Мирас Жаксылыков: Проверить исправность погрузчика №2', '/tasks', 'task', null, now() - interval '3 hours'),
  (seed_tmp.emp('JP-0002'), 'Оформите заявку', 'Айдана Калиева · Отпуск: согласовано руководителем', '/approvals', 'request', null, now() - interval '6 days' + interval '3 hours'),
  (seed_tmp.emp('JP-0002'), 'Новое обращение', 'Олжас Кенжебаев: «Положена ли компенсация за проезд, если смена заканчивается ночью?»', '/tickets', 'ticket', null, now() - interval '1 day'),
  (seed_tmp.emp('JP-0002'), 'Новое обращение', 'Сабина Мусина: «Как оформить отпуск по уходу за ребёнком?»', '/tickets', 'ticket', null, now() - interval '5 hours'),
  (seed_tmp.emp('JP-0018'), 'Добро пожаловать в Jana Post! 👋', 'Начните с курса «Добро пожаловать в Jana Post» в Jana Academy', '/academy/welcome', 'course', null, now() - interval '5 days'),
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
alter table public.tasks enable trigger trg_tasks_notify;
alter table public.announcements enable trigger trg_announcements_notify;
alter table public.hr_tickets enable trigger trg_hr_tickets_after_insert;

-- Журнал аудита начинаем с чистого листа
truncate table public.audit_log restart identity;

drop schema if exists seed_tmp cascade;


notify pgrst, 'reload schema';
