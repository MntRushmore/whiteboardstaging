import { describe, expect, it } from "vitest";
import { hasPlan, type UnlimitedStatus } from "@/lib/billing/unlimited";
import { JUST_PAID_MS, gateNeedsAdmin, markCheckoutReturn, planGate, returnedFromCheckout, type PlanGateInput } from "@/lib/billing/planGate";
import { planView } from "@/lib/onboarding/plan";

const NO_PLAN: PlanGateInput = { enabled: true, checkoutOpen: true, known: true, state: { status: "none" }, justPaid: false, admin: false };
const gate = (over: Partial<PlanGateInput>) => planGate({ ...NO_PLAN, ...over });

const ALL: UnlimitedStatus[] = ["none", "trialing", "repeat_trial", "active", "past_due", "canceled", "incomplete"];

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("the paywall: no free plan", () => {
  it("locks out an account without a plan, and one whose plan ended", () => {
    expect(gate({})).toBe("locked");
    expect(gate({ state: { status: "canceled" } })).toBe("locked");
  });

  it("lets in every account with a plan, including one being set up or with a payment to fix", () => {
    for (const status of ["trialing", "active", "repeat_trial", "incomplete", "past_due"] as const) expect(gate({ state: { status } })).toBe("open");
  });

  it("agrees with the plan screen: whoever it locks out is pitched, whoever it lets in skips the pitch", () => {
    for (const status of ALL) {
      const view = planView({ loading: false, unlimited: { status }, checkoutUrl: "https://buy.stripe.com/x" });
      expect(gate({ state: { status } }) === "locked").toBe(view === "offer" || view === "restart");
      expect(hasPlan({ status })).toBe(view === "skip");
    }
  });

  it("fails open: no checkout to pay with, the plan not read (or the read failed)", () => {
    expect(gate({ checkoutOpen: false })).toBe("open");
    expect(gate({ known: false })).toBe("checking");
  });

  it("leaves alone a page that asked (the welcome, the guided first board)", () => {
    expect(gate({ enabled: false })).toBe("open");
  });

  it("stays open just after checkout, while the webhook catches up", () => {
    expect(gate({ justPaid: true })).toBe("open");
  });

  it("lets admins look around, and waits for is_admin() before locking anyone out", () => {
    expect(gate({ admin: true })).toBe("open");
    expect(gate({ admin: null })).toBe("checking");
    // a subscriber is never held up by the admin check
    expect(gate({ admin: null, state: { status: "active" } })).toBe("open");
  });

  it("asks is_admin() only when the answer would lock someone out", () => {
    const input: Omit<PlanGateInput, "admin"> = { enabled: true, checkoutOpen: true, known: true, state: { status: "none" }, justPaid: false };
    expect(gateNeedsAdmin(input)).toBe(true);
    expect(gateNeedsAdmin({ ...input, state: { status: "trialing" } })).toBe(false);
    expect(gateNeedsAdmin({ ...input, known: false })).toBe(false);
    expect(gateNeedsAdmin({ ...input, enabled: false })).toBe(false);
  });
});

describe("back from checkout", () => {
  it("is remembered for the tab for JUST_PAID_MS", () => {
    const storage = memoryStorage();
    expect(returnedFromCheckout(storage, 1_000)).toBe(false);
    markCheckoutReturn(storage, 1_000);
    expect(returnedFromCheckout(storage, 1_000)).toBe(true);
    expect(returnedFromCheckout(storage, 1_000 + JUST_PAID_MS - 1)).toBe(true);
    expect(returnedFromCheckout(storage, 1_000 + JUST_PAID_MS)).toBe(false);
  });

  it("never throws on a storage that does", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => undefined,
    };
    expect(() => markCheckoutReturn(broken, 1)).not.toThrow();
    expect(returnedFromCheckout(broken, 1)).toBe(false);
    expect(returnedFromCheckout(null, 1)).toBe(false);
  });
});
