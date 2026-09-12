-- =============================================================================
-- Agathon Classroom (whiteboardstaging) -- Supabase schema, reconstructed from code
-- Generated 2026-09-11. Idempotent; safe to run in the Supabase SQL editor
-- (runs as postgres) or via `supabase db push` as a migration.
--
-- Sources (file:line in the repo):
--   whiteboards      src/app/page.tsx:84-87,103-109,132-135,150-153
--                    src/app/board/[id]/page.tsx:1535-1550,1575-1579,1821-1825
--   user_settings    src/lib/featureLabs.ts:88-92,121-125
--   bug_reports      src/components/BugReportButton.tsx:94-102
--   training_samples src/app/train/page.tsx:82-85,181-197
--   bucket           src/app/train/page.tsx:23,163-177  (paths: <auth.uid()>/<sampleId>/*.png)
--   trainer          src/app/train/page.tsx:22 (hardcoded email)
--
-- PART A = what the current code needs to run.
-- PART B = recommended target design (assets bucket, versioned saves, soft delete).
--          Part B is additive and does not break the current client.
-- =============================================================================


create extension if not exists pgcrypto;   -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- Shared helper: updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- PART A -- tables the app reads/writes today
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A1. whiteboards
-- Client inserts {title, data:{}, user_id} (page.tsx:106) and expects the row
-- back with id (page.tsx:113). Client updates {data, updated_at, preview?}
-- (board page:1535-1550) and {title} (page.tsx:152). Client selects
-- id,title,created_at,updated_at,preview (page.tsx:86) and data (board:1823).
-- -----------------------------------------------------------------------------
create table if not exists public.whiteboards (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,
  title       text        not null default 'Untitled Whiteboard',
  -- full tldraw editor snapshot {document:{store,schema}, session} (getSnapshot)
  data        jsonb       not null default '{}'::jsonb,
  -- data:image/png;base64 thumbnail; client only writes it when <= 8000 chars
  preview     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ---- Part B columns (additive; harmless for the current client) ----
  version     bigint      not null default 1,
  deleted_at  timestamptz,
  constraint whiteboards_title_len check (char_length(title) between 1 and 200),
  constraint whiteboards_preview_len check (preview is null or char_length(preview) <= 20000)
);

-- Dashboard query: .order('updated_at', desc) filtered by RLS on user_id
create index if not exists whiteboards_user_updated_idx
  on public.whiteboards (user_id, updated_at desc);

drop trigger if exists whiteboards_set_updated_at on public.whiteboards;
create trigger whiteboards_set_updated_at
  before update on public.whiteboards
  for each row execute function public.set_updated_at();

alter table public.whiteboards enable row level security;

drop policy if exists "whiteboards: owner select" on public.whiteboards;
create policy "whiteboards: owner select"
  on public.whiteboards for select
  to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null);

drop policy if exists "whiteboards: owner insert" on public.whiteboards;
create policy "whiteboards: owner insert"
  on public.whiteboards for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "whiteboards: owner update" on public.whiteboards;
create policy "whiteboards: owner update"
  on public.whiteboards for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "whiteboards: owner delete" on public.whiteboards;
create policy "whiteboards: owner delete"
  on public.whiteboards for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- No anon access at all.
revoke all on public.whiteboards from anon;
grant select, insert, update, delete on public.whiteboards to authenticated;

-- -----------------------------------------------------------------------------
-- A2. user_settings  (featureLabs.ts:88-92 select features; :121-125 upsert
-- {user_id, features, updated_at}). upsert() needs a PK/unique on user_id.
-- -----------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id     uuid        primary key default auth.uid()
                          references auth.users (id) on delete cascade,
  features    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_settings_features_is_object check (jsonb_typeof(features) = 'object')
);

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "user_settings: owner select" on public.user_settings;
create policy "user_settings: owner select"
  on public.user_settings for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "user_settings: owner insert" on public.user_settings;
create policy "user_settings: owner insert"
  on public.user_settings for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "user_settings: owner update" on public.user_settings;
create policy "user_settings: owner update"
  on public.user_settings for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.user_settings from anon;
grant select, insert, update on public.user_settings to authenticated;

-- -----------------------------------------------------------------------------
-- A3. bug_reports  (BugReportButton.tsx:94-102). Client inserts
-- {user_id|null, user_email|null, board_id|null, message|null, screenshot|null,
--  diagnostics (object), logs (array of {level,time,args[]})}.
-- Insert-only for users; nobody reads these from the client (owner reads via
-- dashboard / service role).
-- -----------------------------------------------------------------------------
create table if not exists public.bug_reports (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users (id) on delete set null,
  user_email  text,
  board_id    text,                 -- route param; not FK so reports about deleted boards survive
  message     text,
  screenshot  text,                 -- data:image/png;base64 (scale .75 viewport PNG)
  diagnostics jsonb       not null default '{}'::jsonb,
  logs        jsonb       not null default '[]'::jsonb,   -- ring buffer, max 200 entries
  created_at  timestamptz not null default now()
);

create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;

drop policy if exists "bug_reports: authenticated insert own" on public.bug_reports;
create policy "bug_reports: authenticated insert own"
  on public.bug_reports for insert
  to authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- The button is only rendered inside the (auth-gated) board page, so anon
-- inserts are not needed. If you ever want anon reports, add a separate
-- policy `to anon with check (user_id is null)`.
revoke all on public.bug_reports from anon;
grant insert on public.bug_reports to authenticated;

-- -----------------------------------------------------------------------------
-- A4. Trainer role + training_samples + training-data bucket
-- train/page.tsx gates by a hardcoded email (line 22) on the CLIENT ONLY.
-- Server-side enforcement lives here: a `trainers` allow-list table and an
-- is_trainer() helper used by RLS on the table and on storage.objects.
-- -----------------------------------------------------------------------------
create table if not exists public.trainers (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.trainers enable row level security;
-- Users may check whether *they* are a trainer; nobody can write via the API.
drop policy if exists "trainers: self select" on public.trainers;
create policy "trainers: self select"
  on public.trainers for select
  to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.trainers from anon;
grant select on public.trainers to authenticated;

create or replace function public.is_trainer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.trainers t where t.user_id = auth.uid());
$$;
revoke all on function public.is_trainer() from public;
grant execute on function public.is_trainer() to authenticated;

-- Seed the trainer used by the code (no-op until that user has signed up).
insert into public.trainers (user_id)
select id from auth.users where lower(email) = lower('rushilchopra123@gmail.com')
on conflict do nothing;

create table if not exists public.training_samples (
  id               uuid        primary key,                -- client supplies crypto.randomUUID() (train:158,184)
  created_by       uuid        not null default auth.uid()
                               references auth.users (id) on delete cascade,
  created_by_email text,
  subject          text        not null check (subject in ('math','chemistry','physics','biology','other')),
  topic            text,
  difficulty       text        not null check (difficulty in ('easy','medium','hard')),
  mode             text        not null check (mode in ('feedback','suggest','answer')),
  notes            text,
  -- storage object paths inside bucket training-data: <created_by>/<id>/before.png etc.
  before_url       text        not null,
  after_full_url   text        not null,
  tldraw_snapshot  jsonb       not null default '{}'::jsonb,
  status           text        not null default 'pending'
                               check (status in ('pending','approved','rejected')),
  schema_version   integer     not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists training_samples_created_by_idx
  on public.training_samples (created_by, created_at desc);
create index if not exists training_samples_status_idx
  on public.training_samples (status);

drop trigger if exists training_samples_set_updated_at on public.training_samples;
create trigger training_samples_set_updated_at
  before update on public.training_samples
  for each row execute function public.set_updated_at();

alter table public.training_samples enable row level security;

-- count(*) head query (train:82-85) needs SELECT; insert (train:181-197).
drop policy if exists "training_samples: trainer select own" on public.training_samples;
create policy "training_samples: trainer select own"
  on public.training_samples for select
  to authenticated
  using (public.is_trainer() and created_by = (select auth.uid()));

drop policy if exists "training_samples: trainer insert own" on public.training_samples;
create policy "training_samples: trainer insert own"
  on public.training_samples for insert
  to authenticated
  with check (public.is_trainer() and created_by = (select auth.uid()));

revoke all on public.training_samples from anon;
grant select, insert on public.training_samples to authenticated;

-- Storage bucket: private, PNG only, 10 MB cap per object.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-data', 'training-data', false, 10485760, array['image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects already has RLS enabled on Supabase; add bucket policies.
-- Object path convention from train:159-161: '<auth.uid()>/<sampleId>/<file>.png'
drop policy if exists "training-data: trainer upload own folder" on storage.objects;
create policy "training-data: trainer upload own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'training-data'
    and public.is_trainer()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "training-data: trainer read own folder" on storage.objects;
create policy "training-data: trainer read own folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'training-data'
    and public.is_trainer()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No UPDATE/DELETE policy on purpose: samples are append-only (upsert:false in code).

-- =============================================================================
-- PART B -- recommended target design (additive)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B1. Optimistic concurrency: monotonically increasing `version` on whiteboards.
-- Client flow:  UPDATE ... SET data=$1
--               WHERE id=$2 AND version=$expected  RETURNING version
-- (postgrest: .update({ data }).eq('id', id).eq('version', expected).select('version'))
-- The client does NOT set version; the trigger below bumps it on every data
-- change. Zero rows returned => another tab saved first: reload the row, merge
-- (or tell the user), and retry with the new version. Never overwrite blindly.
-- -----------------------------------------------------------------------------
create or replace function public.whiteboards_bump_version()
returns trigger
language plpgsql
as $$
begin
  if new.data is distinct from old.data then
    new.version = old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists whiteboards_bump_version on public.whiteboards;
create trigger whiteboards_bump_version
  before update of data on public.whiteboards
  for each row execute function public.whiteboards_bump_version();

-- -----------------------------------------------------------------------------
-- B2. Soft delete. Dashboard "Delete" should become
--     update whiteboards set deleted_at = now() where id = $1
-- The SELECT policy above already hides deleted rows. A scheduled purge can
-- hard-delete rows older than 30 days:
--     delete from whiteboards where deleted_at < now() - interval '30 days';
-- -----------------------------------------------------------------------------
create index if not exists whiteboards_deleted_idx
  on public.whiteboards (deleted_at) where deleted_at is not null;

-- -----------------------------------------------------------------------------
-- B3. Save history (versioned saves). One row per successful save; the client
-- writes the same snapshot here (or a trigger copies it). Lets students restore
-- and lets the AI pipeline diff "before/after". Keep the last N per board.
-- -----------------------------------------------------------------------------
create table if not exists public.whiteboard_snapshots (
  id            bigint      generated always as identity primary key,
  whiteboard_id uuid        not null references public.whiteboards (id) on delete cascade,
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  version       bigint      not null,
  data          jsonb       not null,
  created_at    timestamptz not null default now(),
  unique (whiteboard_id, version)
);
create index if not exists whiteboard_snapshots_board_idx
  on public.whiteboard_snapshots (whiteboard_id, version desc);

alter table public.whiteboard_snapshots enable row level security;

drop policy if exists "snapshots: owner select" on public.whiteboard_snapshots;
create policy "snapshots: owner select"
  on public.whiteboard_snapshots for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "snapshots: owner insert" on public.whiteboard_snapshots;
create policy "snapshots: owner insert"
  on public.whiteboard_snapshots for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.whiteboards w
                where w.id = whiteboard_id and w.user_id = (select auth.uid()))
  );

revoke all on public.whiteboard_snapshots from anon;
grant select, insert on public.whiteboard_snapshots to authenticated;

-- Automatic history: copy every data change into whiteboard_snapshots,
-- keep the newest 20 per board.
create or replace function public.whiteboards_record_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.data is distinct from old.data then
    insert into public.whiteboard_snapshots (whiteboard_id, user_id, version, data)
    values (new.id, new.user_id, new.version, new.data)
    on conflict (whiteboard_id, version) do nothing;

    delete from public.whiteboard_snapshots s
    where s.whiteboard_id = new.id
      and s.version <= new.version - 20;
  end if;
  return new;
end;
$$;

drop trigger if exists whiteboards_record_snapshot on public.whiteboards;
create trigger whiteboards_record_snapshot
  after update of data on public.whiteboards
  for each row execute function public.whiteboards_record_snapshot();

-- -----------------------------------------------------------------------------
-- B4. Board assets in Storage instead of base64 inside whiteboards.data.
-- Bucket `board-assets`, PUBLIC read (tldraw <img src> needs a plain URL, and
-- the AI routes must be able to fetch it), write restricted to the owner's
-- folder: '<auth.uid()>/<boardId>/<assetId>.<ext>'.
-- Client: pass a TLAssetStore to <Tldraw assets={...}> whose upload() does
--   supabase.storage.from('board-assets').upload(path, file) and returns
--   { src: supabase.storage.from('board-assets').getPublicUrl(path).data.publicUrl }
-- and route AI-generated data URLs through the same upload before createAssets.
-- Result: whiteboards.data holds only URLs; row size drops from MBs to KBs.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board-assets', 'board-assets', true, 15728640,
        array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "board-assets: public read" on storage.objects;
create policy "board-assets: public read"
  on storage.objects for select
  to public
  using (bucket_id = 'board-assets');

drop policy if exists "board-assets: owner upload own folder" on storage.objects;
create policy "board-assets: owner upload own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'board-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "board-assets: owner update own folder" on storage.objects;
create policy "board-assets: owner update own folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'board-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "board-assets: owner delete own folder" on storage.objects;
create policy "board-assets: owner delete own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'board-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Optional registry so orphaned objects can be garbage-collected when a
-- board is deleted or an asset is removed from the snapshot.
create table if not exists public.board_assets (
  id            uuid        primary key default gen_random_uuid(),
  whiteboard_id uuid        not null references public.whiteboards (id) on delete cascade,
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  object_path   text        not null unique,   -- '<uid>/<boardId>/<assetId>.png'
  mime_type     text        not null,
  bytes         integer,
  width         integer,
  height        integer,
  source        text        not null default 'user'
                            check (source in ('user','ai','sticker','pdf','worksheet')),
  created_at    timestamptz not null default now()
);
create index if not exists board_assets_board_idx on public.board_assets (whiteboard_id);

alter table public.board_assets enable row level security;

drop policy if exists "board_assets: owner all" on public.board_assets;
create policy "board_assets: owner all"
  on public.board_assets for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.board_assets from anon;
grant select, insert, update, delete on public.board_assets to authenticated;

-- -----------------------------------------------------------------------------
-- B5. (Optional, NOT recommended as a fix) Raise the PostgREST role timeout.
-- Supabase defaults: anon 3s, authenticated 8s. The app already special-cases
-- 57014. Raising this only hides the root cause (multi-MB base64 rows); do B4.
-- alter role authenticated set statement_timeout = '15s';
-- notify pgrst, 'reload config';
-- -----------------------------------------------------------------------------


-- =============================================================================
-- Post-migration checks (run separately):
--   select tablename, rowsecurity from pg_tables where schemaname='public';
--   select * from pg_policies where schemaname in ('public','storage');
--   select id, public, file_size_limit from storage.buckets;
-- =============================================================================
