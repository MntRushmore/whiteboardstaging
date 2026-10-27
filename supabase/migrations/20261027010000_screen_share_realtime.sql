-- "Share a window to your iPad" (agathon.app/share → the board's Mac screen panel, 2026-10-27).
--
-- The Mac sends JPEG frames over a PRIVATE Supabase Realtime broadcast channel, `screen:<user id>`,
-- and the iPad listens on it. Realtime Authorization (private channels) checks realtime.messages'
-- RLS when a client joins: only the signed-in person may read (listen) or write (send) on their own
-- channel. Nothing is stored — broadcasts are not persisted — these policies are only the gate.
--
-- Tables: none. Policies: two on realtime.messages (broadcast only, own topic only).

drop policy if exists "screen share: own channel listens" on realtime.messages;
create policy "screen share: own channel listens"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'screen:' || (select auth.uid())::text
  );

drop policy if exists "screen share: own channel sends" on realtime.messages;
create policy "screen share: own channel sends"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'screen:' || (select auth.uid())::text
  );
