/**
 * deleteBoardWithAssets against the LOCAL Supabase stack with a real supabase-js
 * client signed in as the QA student. Opt-in: runs only when RUN_DB_TESTS=1.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/assets/__tests__/deleteBoard.integration.test.ts
 *
 * This is the runtime proof behind `asDeleteBoardClient`: the structural slice
 * cannot be checked against the real client at compile time (TS2589, see
 * deleteBoard.ts), so here the real client goes through the whole flow — board
 * row, Storage object and registry row created as the user, then removed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ensureUser, resolveSupabaseEnv, waitForHealth } from "../../../../scripts/lib/supabaseHttp.mjs";
import { asDeleteBoardClient, deleteBoardWithAssets } from "../deleteBoard";
import { BOARD_ASSETS_BUCKET, BOARD_ASSETS_TABLE } from "../boardAssetStore";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "deleteBoardWithAssets (integration, local stack)"
  : "deleteBoardWithAssets integration — skipped: set RUN_DB_TESTS=1 with the local stack running (`npx supabase start`) to enable";

const EMAIL = process.env.SMOKE_EMAIL || "qa-student@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "password123";
// 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// Compile-time: the adapter must accept the real client (any Database generic).
const _accepts = (c: SupabaseClient) => asDeleteBoardClient(c);
void _accepts;

suite(title, () => {
  let url: string;
  let client: SupabaseClient;
  let userId: string;
  const created: string[] = [];

  beforeAll(async () => {
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey) {
      throw new Error("RUN_DB_TESTS=1 but no Supabase target: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY or start the local stack.");
    }
    url = env.url;
    if (!(await waitForHealth(url, { timeoutMs: 30_000 }))) throw new Error(`Supabase at ${url} is not healthy`);
    const session = await ensureUser({ url, anonKey: env.anonKey, serviceKey: env.serviceKey, email: EMAIL, password: PASSWORD });
    userId = session.userId;
    client = createClient(url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
    });
  }, 60_000);

  afterAll(async () => {
    // Anything a failed assertion left behind.
    for (const id of created) await client.from("whiteboards").delete().eq("id", id);
  });

  async function publicStatus(path: string): Promise<number> {
    const res = await fetch(`${url}/storage/v1/object/public/${BOARD_ASSETS_BUCKET}/${path}`);
    await res.arrayBuffer();
    return res.status;
  }

  it("removes the board row, its registry rows and its Storage objects as the signed-in user", async () => {
    const { data: board, error: insertError } = await client
      .from("whiteboards")
      .insert({ title: "deleteBoard integration", data: {}, user_id: userId })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    const boardId = (board as { id: string }).id;
    created.push(boardId);

    const paths = [`${userId}/${boardId}/one.png`, `${userId}/${boardId}/two.png`];
    for (const path of paths) {
      const { error } = await client.storage.from(BOARD_ASSETS_BUCKET).upload(path, new Blob([PNG], { type: "image/png" }), { contentType: "image/png", upsert: true });
      expect(error, path).toBeNull();
      const { error: regError } = await client
        .from(BOARD_ASSETS_TABLE)
        .insert({ whiteboard_id: boardId, user_id: userId, object_path: path, mime_type: "image/png", bytes: PNG.byteLength, source: "user" });
      expect(regError, path).toBeNull();
    }
    for (const path of paths) expect(await publicStatus(path), path).toBe(200);

    const result = await deleteBoardWithAssets(asDeleteBoardClient(client), boardId);
    expect(result).toEqual({ assetsFound: 2, assetsRemoved: 2, assetErrors: [] });

    const { data: rows } = await client.from("whiteboards").select("id").eq("id", boardId);
    expect(rows).toEqual([]);
    const { data: registry } = await client.from(BOARD_ASSETS_TABLE).select("object_path").eq("whiteboard_id", boardId);
    expect(registry).toEqual([]);
    // Supabase Storage answers a missing public object with 400 ("Object not found") or 404 depending on version.
    for (const path of paths) expect([400, 404], path).toContain(await publicStatus(path));
    created.splice(created.indexOf(boardId), 1);
  }, 60_000);

  it("a board without registered assets is deleted with no Storage calls failing", async () => {
    const { data: board } = await client.from("whiteboards").insert({ title: "deleteBoard integration (empty)", data: {}, user_id: userId }).select("id").single();
    const boardId = (board as { id: string }).id;
    created.push(boardId);
    const result = await deleteBoardWithAssets(asDeleteBoardClient(client), boardId);
    expect(result).toEqual({ assetsFound: 0, assetsRemoved: 0, assetErrors: [] });
    const { data: rows } = await client.from("whiteboards").select("id").eq("id", boardId);
    expect(rows).toEqual([]);
    created.splice(created.indexOf(boardId), 1);
  }, 30_000);
});
