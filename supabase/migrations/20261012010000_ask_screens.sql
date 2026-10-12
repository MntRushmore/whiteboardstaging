-- =============================================================================
-- Ask, a chat per screen (2026-10-12). Idempotent; additive. docs/ASK-V2.md, "A chat per screen".
--
-- A board is a stack of fixed 16:9 screens (tldraw pages, src/lib/screens/screens.ts), and each
-- screen now has its own Ask chat. A turn says which screen's chat it is in:
--
--   ask_messages.screen_id   the screen's tldraw page id (`page:…`, AskScreenIdSchema in
--                            src/lib/live/ask/contracts.ts), or null: a turn saved before chats were
--                            per screen (or by a client that does not say), which is the board's
--                            FIRST screen's. POST /api/live/ask saves it with the student's own token
--                            (saveAskTurns); GET /api/live/ask/history?boardId=&screenId=&first= reads
--                            one screen's chat: its own rows, plus the null ones when the client says
--                            the screen is the board's first (`first=1`: the client knows its pages,
--                            the server does not).
--
--   ask_move_turns(p_board_id, p_turn_ids, p_screen_id)
--                            the tutor's own actions started a new screen (more problems on a full
--                            one), so the exchange that asked for it moves into the new screen's chat
--                            with them (POST /api/live/ask/history/move, `moveAskTurns`). Re-tags at
--                            most 4 of the CALLER'S OWN turns on a board the caller owns (not
--                            deleted) to p_screen_id, and answers how many it moved. Only screen_id
--                            changes. Raises 42501 when the board is not the caller's (another's, a
--                            deleted one, none: the same answer), 22023 for a bad argument.
--
-- Why a function and not an update grant. The table has no update grant (a saved turn is never
-- rewritten). A column grant `update (screen_id)` with an owner policy would let a student re-tag
-- any number of their turns in one PATCH, on any board of theirs, to any value the check allows, and
-- it would add the first update path to a table whose rows the rest of the code treats as written
-- once. The function moves only what the move route needs: at most 4 turns, of the caller, on one
-- board the caller owns. Security definer because the caller has no update grant; it acts only as
-- auth.uid() and touches only screen_id.
--
-- The page id is not checked against the board's pages: the server cannot see them (they live in
-- the board's snapshot, which may not be saved yet when the move comes), and a turn re-tagged to a
-- screen that is not there only leaves the student's own chat.
--
-- Values. screen_id null or `page:` and 1 to 64 of [A-Za-z0-9_-] (tldraw's page ids, as the contract
-- says). ask_messages_screen_id_format refuses anything else (23514).
--
-- Index. (board_id, screen_id, seq desc): one screen's newest turns. The board-wide
-- (board_id, seq desc) index stays for ask_messages_keep_newest() and an older client's read.
--
-- Deploy order: any time, before or after the code. Without the column the store saves without it
-- (a turn is the first screen's, as before; saveAskTurns retries once without screen_id on 42703 /
-- PGRST204), the history route reads the whole board's chat as one, and the move route answers
-- 503 (no function). Nothing breaks; the chats are per board until it is applied.
--
-- Down:
--   drop function if exists public.ask_move_turns(uuid, uuid[], text);
--   drop index if exists public.ask_messages_board_screen_seq_idx;
--   alter table public.ask_messages drop constraint if exists ask_messages_screen_id_format;
--   alter table public.ask_messages drop column if exists screen_id;
--   grant insert (board_id, user_id, role, body, notes, wrote, client_id) on public.ask_messages to authenticated;
--   (dropping the column takes its column grant with it)
--
-- Objects:
--   columns     ask_messages.screen_id text null
--   constraints ask_messages_screen_id_format
--   indexes     ask_messages_board_screen_seq_idx (board_id, screen_id, seq desc)
--   functions   ask_move_turns(uuid, uuid[], text) [security definer, authenticated + service_role]
--   grants      ask_messages: authenticated insert on screen_id too
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The column, its check and its index
-- -----------------------------------------------------------------------------
alter table public.ask_messages add column if not exists screen_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ask_messages_screen_id_format' and conrelid = 'public.ask_messages'::regclass
  ) then
    alter table public.ask_messages
      add constraint ask_messages_screen_id_format
      check (screen_id is null or screen_id ~ '^page:[A-Za-z0-9_-]{1,64}$');
  end if;
end;
$$;

-- One screen's newest turns (the history read).
create index if not exists ask_messages_board_screen_seq_idx on public.ask_messages (board_id, screen_id, seq desc);

-- The store writes the screen with the rest of the turn (the insert policy is unchanged: own rows on
-- an own board). Column grants add up: this re-states the whole list with screen_id in it.
grant insert (board_id, user_id, role, body, notes, wrote, client_id, screen_id) on public.ask_messages to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Moving the caller's own turns to another screen of the same board
-- -----------------------------------------------------------------------------
create or replace function public.ask_move_turns(p_board_id uuid, p_turn_ids uuid[], p_screen_id text)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_moved integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_board_id is null then
    raise exception 'p_board_id is required' using errcode = '22023';
  end if;
  if p_turn_ids is null or cardinality(p_turn_ids) < 1 or cardinality(p_turn_ids) > 4 or array_position(p_turn_ids, null) is not null then
    raise exception 'p_turn_ids must hold 1 to 4 ids' using errcode = '22023';
  end if;
  if p_screen_id is null or p_screen_id !~ '^page:[A-Za-z0-9_-]{1,64}$' then
    raise exception 'p_screen_id must be a page id' using errcode = '22023';
  end if;
  -- the board must be the caller's, and not deleted (anyone else's, a deleted one and none at all
  -- are the same answer)
  if not exists (
    select 1 from public.whiteboards w
     where w.id = p_board_id and w.user_id = v_uid and w.deleted_at is null
  ) then
    raise exception 'not a board of yours' using errcode = '42501';
  end if;

  update public.ask_messages m
     set screen_id = p_screen_id
   where m.board_id = p_board_id
     and m.user_id = v_uid
     and m.id = any (p_turn_ids);
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;
revoke all on function public.ask_move_turns(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.ask_move_turns(uuid, uuid[], text) to authenticated, service_role;

-- PostgREST caches the schema; the new column and function need a reload.
notify pgrst, 'reload schema';
