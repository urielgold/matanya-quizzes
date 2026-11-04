-- חידוני מתניה — Supabase schema
-- Run this whole file once in Supabase → SQL Editor. It is safe to run again (idempotent).

-- ============================================================
-- Helpers
-- ============================================================
create or replace function public.is_host_user() returns boolean
language sql stable as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

-- ============================================================
-- Quizzes (each host sees only their own)
-- ============================================================
create table if not exists public.quizzes (
  id         text primary key,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null default '',
  questions  jsonb not null default '[]'::jsonb,
  cover      jsonb,
  art        text not null default 'auto',
  updated    bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists quizzes_owner_idx on public.quizzes(owner);
alter table public.quizzes enable row level security;
drop policy if exists quizzes_owner_all on public.quizzes;
create policy quizzes_owner_all on public.quizzes for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid() and public.is_host_user());

-- ============================================================
-- Per-user settings (uploaded songs list)
-- ============================================================
create table if not exists public.profiles (
  id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  songs      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and public.is_host_user());

-- ============================================================
-- Live games
--   games:   one row per live game; only the host writes it, anyone can read it by pin.
--            The correct answer is only put in `state` at reveal time.
--   players: who joined (players act through RPCs with a per-device secret, no account).
--   answers: one answer per player per question; the server rejects late/early answers.
-- ============================================================
create table if not exists public.games (
  pin         text primary key check (pin ~ '^[0-9]{6}$'),
  host        uuid not null references auth.users(id) on delete cascade,
  quiz_id     text,
  state       jsonb not null default '{}'::jsonb,
  status      text not null default 'lobby' check (status in ('lobby','running','ended')),
  round       int  not null default -1,
  accepting   boolean not null default false,
  time_limit  int  not null default 20,
  opened_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists games_host_idx on public.games(host);
alter table public.games enable row level security;
drop policy if exists games_read on public.games;
create policy games_read on public.games for select to anon, authenticated using (true);
drop policy if exists games_host_update on public.games;
create policy games_host_update on public.games for update to authenticated
  using (host = auth.uid()) with check (host = auth.uid());
drop policy if exists games_host_delete on public.games;
create policy games_host_delete on public.games for delete to authenticated
  using (host = auth.uid());

create table if not exists public.players (
  pin       text not null references public.games(pin) on delete cascade,
  pid       uuid not null,
  secret    text not null,
  name      text not null check (char_length(name) between 1 and 24),
  av        int  not null default 0 check (av between 0 and 11),
  joined_at timestamptz not null default now(),
  primary key (pin, pid)
);
alter table public.players enable row level security;
drop policy if exists players_host_read on public.players;
create policy players_host_read on public.players for select to authenticated
  using (exists (select 1 from public.games g where g.pin = players.pin and g.host = auth.uid()));
drop policy if exists players_host_delete on public.players;
create policy players_host_delete on public.players for delete to authenticated
  using (exists (select 1 from public.games g where g.pin = players.pin and g.host = auth.uid()));

create table if not exists public.answers (
  pin        text not null references public.games(pin) on delete cascade,
  round      int  not null,
  pid        uuid not null,
  choice     int  not null check (choice between 0 and 3),
  elapsed_ms int  not null,
  created_at timestamptz not null default now(),
  primary key (pin, round, pid)
);
alter table public.answers enable row level security;
drop policy if exists answers_host_read on public.answers;
create policy answers_host_read on public.answers for select to authenticated
  using (exists (select 1 from public.games g where g.pin = answers.pin and g.host = auth.uid()));

-- ============================================================
-- Host RPCs
-- ============================================================

-- Create (or restart) a game. Returns the pin. p_pin may ask for a specific code.
create or replace function public.create_game(p_quiz text, p_state jsonb, p_pin text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_pin text; v_try int := 0;
begin
  if not public.is_host_user() then raise exception 'not_allowed'; end if;
  delete from games where updated_at < now() - interval '12 hours';
  if p_pin is not null and p_pin !~ '^[0-9]{6}$' then p_pin := null; end if;
  loop
    v_pin := coalesce(p_pin, lpad((floor(random() * 900000) + 100000)::int::text, 6, '0'));
    if exists (select 1 from games where pin = v_pin and host = auth.uid()) then
      -- restarting my own game on the same code ("play again")
      delete from answers where pin = v_pin;
      update games set quiz_id = p_quiz, state = p_state, status = 'lobby', round = -1,
             accepting = false, opened_at = null, updated_at = now()
       where pin = v_pin;
      return v_pin;
    end if;
    begin
      insert into games(pin, host, quiz_id, state) values (v_pin, auth.uid(), p_quiz, p_state);
      return v_pin;
    exception when unique_violation then
      p_pin := null;
      v_try := v_try + 1;
      if v_try > 30 then raise exception 'no_free_pin'; end if;
    end;
  end loop;
end $$;

-- Publish the game state. When p_accepting is true, answers for p_round are accepted
-- until p_time seconds (+ grace) after the question was opened; p_elapsed_ms lets a
-- paused question resume with the time it already used. Returns opened_at.
create or replace function public.host_update(
  p_pin text, p_state jsonb, p_status text, p_round int, p_accepting boolean,
  p_time int default 20, p_elapsed_ms int default 0)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_open timestamptz;
begin
  select opened_at into v_open from games where pin = p_pin and host = auth.uid() for update;
  if not found then raise exception 'not_your_game'; end if;
  if p_accepting then
    v_open := now() - make_interval(secs => greatest(p_elapsed_ms, 0) / 1000.0);
  end if;
  update games set state = p_state, status = p_status, round = p_round, accepting = p_accepting,
         time_limit = greatest(p_time, 1), opened_at = v_open, updated_at = now()
   where pin = p_pin;
  return v_open;
end $$;

-- ============================================================
-- Player RPCs (no account needed; each device keeps its pid + secret)
-- ============================================================
create or replace function public.join_game(p_pin text, p_pid uuid, p_secret text, p_name text, p_av int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g games; p players; v_name text := left(btrim(coalesce(p_name, '')), 24);
begin
  if v_name = '' then raise exception 'name_required'; end if;
  if char_length(coalesce(p_secret, '')) < 16 then raise exception 'bad_secret'; end if;
  select * into g from games where pin = p_pin;
  if not found or g.status = 'ended' then raise exception 'no_game'; end if;
  if coalesce(g.state -> 'kicked', '[]'::jsonb) ? p_pid::text then raise exception 'kicked'; end if;
  select * into p from players where pin = p_pin and pid = p_pid;
  if found then
    if p.secret <> p_secret then raise exception 'bad_secret'; end if;
    update players set name = v_name, av = least(greatest(coalesce(p_av, 0), 0), 11)
     where pin = p_pin and pid = p_pid;
  else
    if (select count(*) from players where pin = p_pin) >= 200 then raise exception 'game_full'; end if;
    insert into players(pin, pid, secret, name, av)
    values (p_pin, p_pid, p_secret, v_name, least(greatest(coalesce(p_av, 0), 0), 11));
  end if;
  return jsonb_build_object('state', g.state, 'status', g.status);
end $$;

create or replace function public.set_avatar(p_pin text, p_pid uuid, p_secret text, p_av int)
returns void language plpgsql security definer set search_path = public as $$
begin
  update players set av = least(greatest(coalesce(p_av, 0), 0), 11)
   where pin = p_pin and pid = p_pid and secret = p_secret;
end $$;

create or replace function public.leave_game(p_pin text, p_pid uuid, p_secret text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from players where pin = p_pin and pid = p_pid and secret = p_secret;
end $$;

-- Returns 'ok' (saved), 'dup' (already answered), or an error code.
create or replace function public.submit_answer(p_pin text, p_pid uuid, p_secret text, p_round int, p_choice int)
returns text language plpgsql security definer set search_path = public as $$
declare g games; v_el int;
begin
  if p_choice is null or p_choice < 0 or p_choice > 3 then return 'bad_choice'; end if;
  if not exists (select 1 from players where pin = p_pin and pid = p_pid and secret = p_secret) then
    return 'not_joined';
  end if;
  select * into g from games where pin = p_pin;
  if not found then return 'no_game'; end if;
  if coalesce(g.state -> 'kicked', '[]'::jsonb) ? p_pid::text then return 'kicked'; end if;
  if not g.accepting or g.round <> p_round or g.opened_at is null then return 'closed'; end if;
  v_el := (extract(epoch from (now() - g.opened_at)) * 1000)::int;
  if v_el > g.time_limit * 1000 + 2500 then return 'late'; end if;
  insert into answers(pin, round, pid, choice, elapsed_ms)
  values (p_pin, p_round, p_pid, p_choice, greatest(v_el, 0))
  on conflict do nothing;
  if found then return 'ok'; end if;
  return 'dup';
end $$;

-- Lets a reconnecting phone learn whether its answer for a round was saved.
create or replace function public.my_answer(p_pin text, p_pid uuid, p_secret text, p_round int)
returns int language sql security definer set search_path = public as $$
  select a.choice from answers a
    join players p on p.pin = a.pin and p.pid = a.pid
   where a.pin = p_pin and a.pid = p_pid and a.round = p_round and p.secret = p_secret
$$;

-- ============================================================
-- Privileges ("Automatically expose new tables" is off, so grant explicitly)
-- ============================================================
revoke all on public.quizzes, public.profiles, public.games, public.players, public.answers from anon, authenticated;
grant select, insert, update, delete on public.quizzes  to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select on public.games to anon, authenticated;
grant update, delete on public.games to authenticated;
grant select, delete on public.players to authenticated;
grant select on public.answers to authenticated;

revoke execute on function public.create_game(text, jsonb, text) from public, anon;
revoke execute on function public.host_update(text, jsonb, text, int, boolean, int, int) from public, anon;
grant execute on function public.create_game(text, jsonb, text) to authenticated;
grant execute on function public.host_update(text, jsonb, text, int, boolean, int, int) to authenticated;
grant execute on function public.join_game(text, uuid, text, text, int) to anon, authenticated;
grant execute on function public.set_avatar(text, uuid, text, int) to anon, authenticated;
grant execute on function public.leave_game(text, uuid, text) to anon, authenticated;
grant execute on function public.submit_answer(text, uuid, text, int, int) to anon, authenticated;
grant execute on function public.my_answer(text, uuid, text, int) to anon, authenticated;
grant execute on function public.is_host_user() to anon, authenticated;

-- ============================================================
-- Realtime: phones follow `games`, the host follows `players` and `answers`
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'games') then
    alter publication supabase_realtime add table public.games;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'players') then
    alter publication supabase_realtime add table public.players;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'answers') then
    alter publication supabase_realtime add table public.answers;
  end if;
end $$;

-- ============================================================
-- Storage: public bucket for question images, cover images and songs.
-- Each host may only write inside a folder named after their user id.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 26214400)
on conflict (id) do update set public = true, file_size_limit = 26214400;

drop policy if exists media_insert_own on storage.objects;
create policy media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_host_user()
              and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists media_update_own on storage.objects;
create policy media_update_own on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists media_read_own on storage.objects;
create policy media_read_own on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
