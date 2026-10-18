-- JanaMen: видео в объявлениях.
-- Автор объявления может приложить ролик с YouTube: храним только идентификатор видео (11 символов),
-- плеер встраивается через youtube-nocookie.com, обложкой без своей картинки служит превью ролика.

alter table public.announcements add column if not exists video text;
alter table public.announcements drop constraint if exists announcements_video_id;
alter table public.announcements add constraint announcements_video_id
  check (video is null or video ~ '^[A-Za-z0-9_-]{11}$');

comment on column public.announcements.video is 'Идентификатор ролика YouTube (например, wln_JddiqUA), встраивается в раскрытое объявление';
