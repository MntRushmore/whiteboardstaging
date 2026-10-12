-- =============================================================================
-- Ask, rebuilt: the saved chat and what the tutor remembers (2026-10-11). Idempotent; additive
-- (nothing else changes). docs/ASK-V2.md, part "memory".
--
--   ask_messages     one row per turn of a board's Ask chat: the student's message or the tutor's
--                    reply, so a reload keeps the chat. POST /api/live/ask saves each finished
--                    exchange with the STUDENT'S OWN JWT (saveAskTurns, src/lib/server/ask/store.ts),
--                    GET /api/live/ask/history reads the newest 60 back, and the admin board viewer's
--                    Ask tab reads a board's chat with the service role (admin_audit 'board.ask').
--   learner_memory   what the tutor remembers about one student across boards: at most 12 short notes
--                    about how they learn ("Gets stuck on borrowing across a zero", "Likes word
--                    problems about animals", "Asked for shorter hints"), never who they are. Written
--                    ONLY by the service role after a turn (rememberFromTurn: a cheap model, then
--                    memoryNoteAllowed, which drops anything personal). Read and cleared by its owner
--                    (the account page's "What Ask remembers"); a grown-up reads and clears a kid's
--                    through GET/DELETE /api/live/ask/memory?kidId=, which checks the kid is theirs
--                    and then uses the service role.
--
-- Who may do what. RLS on both; anon has nothing.
--   ask_messages: authenticated selects its own rows, and inserts rows that are its own AND on a board
--     it owns (not deleted). It writes only board_id, user_id, role, body, notes, wrote and client_id:
--     never id, seq or created_at (the database fills them). No update and no delete: a chat goes with
--     its board or its account. A student could write a "tutor" turn into their own chat this way; it
--     is their own chat, and nothing reads a turn as an instruction.
--   learner_memory: authenticated selects and deletes its own row, nothing else. The notes come from
--     the server alone, so a student cannot write what the tutor believes about them.
--   The service role has everything on both.
--
-- Saving twice. `client_id` is the panel's id for the student's message (AskRequest.clientId), and
-- the store files the tutor's reply to it as `<client_id>:tutor`. unique (board_id, client_id) (NULLs
-- never collide, so turns without one are never refused) lets the store insert with ON CONFLICT DO
-- NOTHING (PostgREST `resolution=ignore-duplicates`, which needs no update grant): a retried request
-- is not saved twice, and the store reads the ids of the turns already there.
--
-- Order. `seq` (an identity) orders a board's turns: the two turns of one exchange are ONE insert and
-- share `created_at` (now() is the transaction's time).
--
-- Values (each a copy of src/lib/live/ask/contracts.ts; the store cleans to them first, so a turn is
-- never refused for a detail). role user|tutor; body 1 to 4,000 characters with something in them
-- besides white space (the route saves at most ASK_LIMITS.message and ASK_LIMITS.reply); notes a JSON
-- array of at most 8 strings of 1 to 200 characters (AskActionsEvent.notes); wrote at most 12 action
-- kinds, each lower-case snake_case (`write_problems`, `graph`: the kind, never the content);
-- client_id 1 to 80 of [A-Za-z0-9_:-]. learner_memory.notes a JSON array of at most 12 strings of 1
-- to 160 characters (ASK_LIMITS.memoryNotes, ASK_LIMITS.memoryNote); its updated_at is the server's
-- clock (a trigger).
--
-- Size. A board keeps its newest 400 turns: after each insert statement, ask_messages_keep_newest()
-- deletes the older ones of every board it inserted into (as the table's owner: a student has no
-- delete grant). The history route shows the newest 60. It is there so a board left open for a year
-- of homework does not grow without end, not to limit students; a student's boards are their own,
-- and a whole account's chat goes with it.
--
-- Deletion. ask_messages goes with its board (ON DELETE CASCADE from whiteboards) and both go with
-- the account (ON DELETE CASCADE from auth.users: delete_own_account(), which also takes a grown-up's
-- kids, a kid removed from the Family page, the dashboard). Every foreign key has an index, so
-- deleting a board or an account never scans the table. Nothing in the code lists tables to delete
-- by name.
--
-- Personal data: a child's chat with the tutor, and notes about how they learn. Never sold, never
-- used to train models; the Privacy Policy (src/app/(platform)/privacy/page.tsx) says what is kept
-- and that a grown-up can clear the notes.
--
-- Deploy order: any time, before or after the code. Without the tables the store saves nothing
-- (saveAskTurns answers null and the chat goes on unsaved), the history route answers no turns and a
-- hello, the memory reads as empty, and the admin viewer's Ask tab says the chat could not be read.
--
-- Down: drop table ask_messages; drop table learner_memory; drop function ask_notes_valid(jsonb,
-- integer, integer), ask_kinds_valid(text[]), ask_messages_keep_newest(), learner_memory_stamp().
--
-- Supabase's default privileges grant ALL on every new public table and function to anon,
-- authenticated and service_role, so each object revokes first and grants exactly what is used.
--
-- Objects:
--   tables      ask_messages, learner_memory
--   constraints ask_messages_role_known, ask_messages_body_len, ask_messages_notes_valid,
--               ask_messages_wrote_valid, ask_messages_client_id_format, ask_messages_board_client_key
--               (unique), learner_memory_notes_valid
--   indexes     ask_messages_board_seq_idx (board_id, seq desc), ask_messages_user_idx (user_id)
--   functions   ask_notes_valid(jsonb, integer, integer), ask_kinds_valid(text[]) [immutable, used by
--               the checks], ask_messages_keep_newest() [trigger, security definer],
--               learner_memory_stamp() [trigger]
--   triggers    ask_messages_keep_newest (AFTER INSERT, each statement),
--               learner_memory_stamp (BEFORE INSERT OR UPDATE, each row)
--   policies    "ask_messages: owner select" / "owner insert",
--               "learner_memory: owner select" / "owner delete"
--   grants      ask_messages: authenticated select, insert on the columns the store writes;
--               learner_memory: authenticated select, delete; service_role: all on both
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The checks' functions
-- -----------------------------------------------------------------------------
-- A JSON array of at most p_max strings, each 1 to p_len characters with something besides white
-- space. A function because a CHECK cannot hold a subquery over jsonb_array_elements. Immutable: it
-- reads nothing but its arguments.
create or replace function public.ask_notes_valid(p_notes jsonb, p_max integer, p_len integer)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v jsonb;
  s text;
begin
  if p_notes is null or jsonb_typeof(p_notes) is distinct from 'array' or jsonb_array_length(p_notes) > p_max then
    return false;
  end if;
  for v in select e from jsonb_array_elements(p_notes) e loop
    if jsonb_typeof(v) <> 'string' then
      return false;
    end if;
    s := v #>> '{}';
    if char_length(s) < 1 or char_length(s) > p_len or s !~ '\S' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
-- A CHECK runs its function with the writer's privileges, so the writers need EXECUTE. It is pure
-- and reveals nothing, so being callable as an RPC is harmless.
revoke all on function public.ask_notes_valid(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.ask_notes_valid(jsonb, integer, integer) to authenticated, service_role;

-- At most 12 action kinds, none null, each lower-case snake_case.
create or replace function public.ask_kinds_valid(p_kinds text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_kinds is not null
     and cardinality(p_kinds) <= 12
     and array_position(p_kinds, null) is null
     and coalesce((select bool_and(k ~ '^[a-z][a-z0-9_]{0,39}$') from unnest(p_kinds) k), true)
$$;
revoke all on function public.ask_kinds_valid(text[]) from public, anon, authenticated;
grant execute on function public.ask_kinds_valid(text[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. ask_messages
-- -----------------------------------------------------------------------------
create table if not exists public.ask_messages (
  id         uuid        primary key default gen_random_uuid(),
  seq        bigint      generated always as identity,
  board_id   uuid        not null references public.whiteboards (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  -- user | tutor
  role       text        not null,
  body       text        not null,
  notes      jsonb       not null default '[]'::jsonb,
  wrote      text[]      not null default '{}'::text[],
  client_id  text,
  created_at timestamptz not null default now(),
  constraint ask_messages_role_known check (role in ('user', 'tutor')),
  constraint ask_messages_body_len check (char_length(body) between 1 and 4000 and body ~ '\S'),
  constraint ask_messages_notes_valid check (public.ask_notes_valid(notes, 8, 200)),
  constraint ask_messages_wrote_valid check (public.ask_kinds_valid(wrote)),
  constraint ask_messages_client_id_format check (client_id is null or client_id ~ '^[A-Za-z0-9_:-]{1,80}$'),
  -- NULLs never collide: only turns with a client id are unique (per board)
  constraint ask_messages_board_client_key unique (board_id, client_id)
);

-- The history read (a board's newest turns) and ON DELETE CASCADE from whiteboards.
create index if not exists ask_messages_board_seq_idx on public.ask_messages (board_id, seq desc);
-- ON DELETE CASCADE from auth.users: without it, deleting an account would scan the whole table.
create index if not exists ask_messages_user_idx on public.ask_messages (user_id);

-- A board keeps its newest 400 turns. Security definer: the student who inserted has no delete
-- grant, and the insert policy already held the rows to boards they own, so this only ever trims
-- the inserter's own boards. It walks one board's index entries past the 400th.
create or replace function public.ask_messages_keep_newest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c_keep constant integer := 400;
  v_board uuid;
  v_floor bigint;
begin
  for v_board in select distinct n.board_id from new_turns n loop
    select m.seq into v_floor
      from public.ask_messages m
     where m.board_id = v_board
     order by m.seq desc
    offset c_keep
     limit 1;
    if v_floor is not null then
      delete from public.ask_messages m where m.board_id = v_board and m.seq <= v_floor;
    end if;
  end loop;
  return null;
end;
$$;
-- Triggers fire whatever the caller's EXECUTE privilege; nobody calls this directly.
revoke all on function public.ask_messages_keep_newest() from public, anon, authenticated;

drop trigger if exists ask_messages_keep_newest on public.ask_messages;
create trigger ask_messages_keep_newest
  after insert on public.ask_messages
  referencing new table as new_turns
  for each statement execute function public.ask_messages_keep_newest();

alter table public.ask_messages enable row level security;

drop policy if exists "ask_messages: owner select" on public.ask_messages;
create policy "ask_messages: owner select"
  on public.ask_messages for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The row's own columns are qualified with the table name, so the subquery's never shadow them.
drop policy if exists "ask_messages: owner insert" on public.ask_messages;
create policy "ask_messages: owner insert"
  on public.ask_messages for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.whiteboards w
                where w.id = ask_messages.board_id and w.user_id = (select auth.uid()) and w.deleted_at is null)
  );

revoke all on public.ask_messages from public, anon, authenticated;
grant select on public.ask_messages to authenticated;
grant insert (board_id, user_id, role, body, notes, wrote, client_id) on public.ask_messages to authenticated;
grant all on public.ask_messages to service_role;

-- -----------------------------------------------------------------------------
-- 3. learner_memory
-- -----------------------------------------------------------------------------
create table if not exists public.learner_memory (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  notes      jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint learner_memory_notes_valid check (public.ask_notes_valid(notes, 12, 160))
);

-- updated_at is the server's clock, whoever writes.
create or replace function public.learner_memory_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.learner_memory_stamp() from public, anon, authenticated;

drop trigger if exists learner_memory_stamp on public.learner_memory;
create trigger learner_memory_stamp
  before insert or update on public.learner_memory
  for each row execute function public.learner_memory_stamp();

alter table public.learner_memory enable row level security;

drop policy if exists "learner_memory: owner select" on public.learner_memory;
create policy "learner_memory: owner select"
  on public.learner_memory for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "learner_memory: owner delete" on public.learner_memory;
create policy "learner_memory: owner delete"
  on public.learner_memory for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.learner_memory from public, anon, authenticated;
grant select, delete on public.learner_memory to authenticated;
grant all on public.learner_memory to service_role;

-- PostgREST caches the schema; the new tables need a reload.
notify pgrst, 'reload schema';
