/**
 * Deleting a grown-up's account with kids (src/lib/billing/deleteAccount.ts). The kids' ACCOUNTS go in
 * delete_own_account(), in the same transaction as the grown-up's; before it only their saved images
 * are removed (`removeKidImages`): after the plan check (a refused deletion touches nothing), before
 * the RPC, and never blocking the deletion when it fails. So a refused or failed RPC leaves every
 * kid's account where it was.
 */
import { describe, expect, it } from "vitest";
import { PlanStillActiveError, deleteOwnAccount, type DeleteAccountClient } from "@/lib/billing/deleteAccount";

function fakeClient(order: string[], plan: Array<Record<string, unknown>> = [], rpcError: Record<string, unknown> | null = null): DeleteAccountClient {
  return {
    auth: {
      signOut: () => (order.push("signOut"), Promise.resolve({ error: null })),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    },
    from: (table) => ({
      select: () => {
        order.push(table === "unlimited_subscriptions" ? "plan" : "assets");
        return Promise.resolve({ data: table === "unlimited_subscriptions" ? plan : [], error: null });
      },
    }),
    storage: { from: () => ({ remove: () => Promise.resolve({ data: null, error: null }) }) },
    rpc: (fn) => (order.push(fn), Promise.resolve({ data: null, error: rpcError as { message: string } | null })),
  };
}

/** A server side for the test: DELETE /api/family as it now is (images only), over a family of two kids. */
function family() {
  const accounts = new Set(["kid-a", "kid-b"]);
  const images = new Set(["kid-a/1.png", "kid-b/2.png"]);
  return {
    accounts,
    images,
    removeKidImages: async () => {
      images.clear();
      return { removed: accounts.size };
    },
  };
}

describe("deleteOwnAccount with a family", () => {
  it("removes the kids' images after the plan check and before the account; the RPC takes the kids' accounts", async () => {
    const order: string[] = [];
    const out = await deleteOwnAccount(fakeClient(order), { storage: null, removeKidImages: async () => (order.push("kidImages"), { removed: 2 }) });
    expect(order).toEqual(["plan", "kidImages", "assets", "delete_own_account", "signOut"]);
    expect(out.kidImages).toEqual({ removed: 2, error: null });
  });

  it("keeps every kid's account when the RPC refuses (a plan started in another tab meanwhile)", async () => {
    const server = family();
    const refused = deleteOwnAccount(fakeClient([], [], { message: "Cancel Agathon Unlimited first", hint: "unlimited_active" }), { storage: null, removeKidImages: server.removeKidImages });
    await expect(refused).rejects.toBeInstanceOf(PlanStillActiveError);
    // only the images went (SQL cannot remove files); the kids, their boards and progress are all there
    expect([...server.accounts]).toEqual(["kid-a", "kid-b"]);
  });

  it("keeps every kid's account when the RPC fails outright", async () => {
    const server = family();
    const failed = deleteOwnAccount(fakeClient([], [], { message: "upstream timeout" }), { storage: null, removeKidImages: server.removeKidImages });
    await expect(failed).rejects.toMatchObject({ message: "upstream timeout" });
    expect(server.accounts.size).toBe(2);
  });

  it("goes on when the kids' images could not be removed (left for the cleanup)", async () => {
    const order: string[] = [];
    const out = await deleteOwnAccount(fakeClient(order), {
      storage: null,
      removeKidImages: async () => {
        throw new Error("offline");
      },
    });
    expect(order).toContain("delete_own_account");
    expect(out.kidImages).toEqual({ removed: 0, error: "offline" });
  });

  it("touches no kid, not even an image, while the plan would charge again", async () => {
    const order: string[] = [];
    let called = false;
    const refused = deleteOwnAccount(fakeClient(order, [{ status: "active", cancel_at_period_end: false, cancel_at: null }]), {
      storage: null,
      removeKidImages: async () => ((called = true), { removed: 1 }),
    });
    await expect(refused).rejects.toBeInstanceOf(PlanStillActiveError);
    expect(called).toBe(false);
    expect(order).toEqual(["plan"]);
  });

  it("has no family step without removeKidImages", async () => {
    const out = await deleteOwnAccount(fakeClient([]), { storage: null });
    expect(out.kidImages).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(["assets", "clearedKeys"]);
  });
});
