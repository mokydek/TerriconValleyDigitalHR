#!/bin/sh
# Одноразовый контейнер: применяет миграции JanaMen и (при первом запуске) демо-данные.
#   SEED=once   — демо-данные загружаются, только если база пустая (по умолчанию)
#   SEED=always — демо-данные пересоздаются при каждом `docker compose up`
set -eu
export PGHOST=db PGUSER=postgres PGDATABASE=postgres
export PGPASSWORD="$(cat /secrets/db_password)"
export PGOPTIONS='--client-min-messages=warning'

echo "init: жду схему Supabase Auth…"
i=0
until psql -tAc "select 1 from pg_tables where schemaname = 'auth' and tablename = 'identities'" 2>/dev/null | grep -q 1; do
  i=$((i + 1)); [ "$i" -gt 120 ] && { echo "init: Auth не создал схему за 4 минуты" >&2; exit 1; }
  sleep 2
done

seeded=f
if [ "$(psql -tAc "select to_regclass('public.employees') is not null")" = "t" ]; then
  seeded=$(psql -tAc "select exists (select 1 from public.employees)")
fi

for f in /supabase/migrations/*.sql; do
  echo "init: миграция $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
done

if [ "$seeded" != "t" ] || [ "${SEED:-once}" = "always" ]; then
  echo "init: загружаю демо-данные"
  psql -v ON_ERROR_STOP=1 -q -f /supabase/seed.sql >/dev/null
else
  echo "init: демо-данные уже есть (SEED=always — пересоздать)"
fi

psql -qc "notify pgrst, 'reload schema'"
echo "init: готово"
