#!/bin/sh
# Минимальный набор ролей и схем, который в Supabase Cloud создаёт сама платформа.
# Выполняется один раз при инициализации пустого тома базы.
set -eu
PW="$(cat /secrets/db_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password '$PW';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole noinherit password '$PW';

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter database $POSTGRES_DB set search_path = "\$user", public, extensions;

create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
alter role supabase_auth_admin set search_path = auth;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
