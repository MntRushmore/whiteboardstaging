/**
 * Deleting a grown-up's account deletes their kids' profiles first (src/lib/billing/deleteAccount.ts,
 * `removeFamily`): after the plan check (a refused deletion touches nothing), before the RPC, and
 * never blocking the deletion when it fails (delete_own_account() deletes any kid left).
 */
import { describe, expect, it } from "vitest";
import { PlanStillActiveError, deleteOwnAccount, type DeleteAccountClient } from "@/lib/billing/deleteAccount";

function fakeClient(order: string[], plan: Array<Record<string, unknown>> = []): DeleteAccountClient {
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
    rpc: (fn) => (order.push(fn), Promise.resolve({ data: null, error: null })),
  };
}

describe("deleteOwnAccount with a family", () => {
  it("removes the kids after the plan check and before the account", async () => {
    const order: string[] = [];
    const out = await deleteOwnAccount(fakeClient(order), { storage: null, removeFamily: async () => (order.push("family"), { removed: 2 }) });
    expect(order).toEqual(["plan", "family", "assets", "delete_own_account", "signOut"]);
    expect(out.family).toEqual({ removed: 2, error: null });
  });

  it("goes on when the kids could not be removed (the database deletes them with the account)", async () => {
    const order: string[] = [];
    const out = await deleteOwnAccount(fakeClient(order), {
      storage: null,
      removeFamily: async () => {
        throw new Error("offline");
      },
    });
    expect(order).toContain("delete_own_account");
    expect(out.family).toEqual({ removed: 0, error: "offline" });
  });

  it("touches no kid while the plan would charge again", async () => {
    const order: string[] = [];
    let called = false;
    const refused = deleteOwnAccount(fakeClient(order, [{ status: "active", cancel_at_period_end: false, cancel_at: null }]), {
      storage: null,
      removeFamily: async () => ((called = true), { removed: 1 }),
    });
    await expect(refused).rejects.toBeInstanceOf(PlanStillActiveError);
    expect(called).toBe(false);
    expect(order).toEqual(["plan"]);
  });

  it("has no family step without removeFamily", async () => {
    const out = await deleteOwnAccount(fakeClient([]), { storage: null });
    expect(out.family).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(["assets", "clearedKeys"]);
  });
});
