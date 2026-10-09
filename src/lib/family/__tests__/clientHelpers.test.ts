import { afterEach, describe, expect, it, vi } from "vitest";
import { FAMILY_COPY } from "../copy";
import type { UnlimitedStatus } from "@/lib/billing/unlimited";
import { GRADE_OPTIONS, NO_GRADE, addKidBlock, gradeFromOption, nameError, optionFromGrade, pinFormError, pinInput } from "../forms";
import { FAMILY_MENU, kidDisplayName } from "../menu";
import { OPEN_PICKER_EVENT, onOpenProfilePicker, openProfilePicker } from "../picker";
import { switchErrorView } from "../switchError";
import { MAX_KIDS, isKidEmail } from "../contracts";

describe("switchErrorView", () => {
  it("says a wrong PIN with the tries left, and does not report it", () => {
    expect(switchErrorView({ status: 403, body: { reason: "wrong_pin", triesLeft: 3 } })).toEqual({ message: FAMILY_COPY.pinWrong(3), code: "wrong_pin", expected: true });
    expect(FAMILY_COPY.pinWrong(1)).toMatch(/1 try left/);
    expect(FAMILY_COPY.pinWrong(0)).toMatch(/No tries left/);
  });

  it("says how long to wait after too many tries", () => {
    const view = switchErrorView({ status: 429, retryAfterMs: 9 * 60_000 + 1 });
    expect(view).toMatchObject({ code: "rate_limited", expected: true });
    expect(view.message).toMatch(/10 minutes/);
  });

  it("says the day's lock kindly, with no countdown: the grown-up's sign-in opens it", () => {
    // the wrong PIN that spent the day's last try
    expect(switchErrorView({ status: 403, body: { reason: "wrong_pin", triesLeft: 0, locked: true } })).toEqual({ message: FAMILY_COPY.pinWrongLocked, code: "pin_locked", expected: true });
    // every try after it
    const view = switchErrorView({ status: 429, retryAfterMs: 20 * 60 * 60_000, body: { reason: "pin_locked" } });
    expect(view).toEqual({ message: FAMILY_COPY.pinLockedDay, code: "pin_locked", expected: true });
    expect(view.message).not.toMatch(/minute/);
    expect(FAMILY_COPY.pinLockedDay).toMatch(/grown-up/);
  });

  it("says a counter that could not be asked as 'try again in a moment', and reports it", () => {
    expect(switchErrorView({ status: 503, body: { reason: "pin_unavailable" } })).toEqual({ message: FAMILY_COPY.pinUnavailable, code: "pin_unavailable", expected: false });
  });

  it("reports anything else as a failed switch", () => {
    expect(switchErrorView({ status: 502 })).toEqual({ message: FAMILY_COPY.switchFailed, code: "switch_502", expected: false });
    expect(switchErrorView(new Error("offline"))).toMatchObject({ code: "switch_failed", expected: false });
    expect(switchErrorView(null)).toMatchObject({ expected: false });
  });
});

describe("what stops adding a kid (the Family page)", () => {
  const plan = (status: UnlimitedStatus, known = true) => ({ known, status });

  it("is the plan first: kids share the grown-up's Unlimited", () => {
    for (const status of ["none", "canceled"] as const) {
      expect(addKidBlock({ hasPin: true, kids: 0, plan: plan(status) }), status).toBe("plan");
      expect(addKidBlock({ hasPin: false, kids: 0, plan: plan(status) }), status).toBe("plan");
    }
    // a plan that is not giving Unlimited right now
    for (const status of ["repeat_trial", "past_due", "incomplete"] as const) {
      expect(addKidBlock({ hasPin: true, kids: 0, plan: plan(status) }), status).toBe("active_plan");
    }
    expect(FAMILY_COPY.kidsNeedPlan).toBe("Start your free trial to add kids.");
  });

  it("then the PIN, then MAX_KIDS; nothing with Unlimited, a PIN and room", () => {
    for (const status of ["trialing", "active"] as const) {
      expect(addKidBlock({ hasPin: false, kids: 0, plan: plan(status) })).toBe("pin");
      expect(addKidBlock({ hasPin: true, kids: MAX_KIDS, plan: plan(status) })).toBe("full");
      expect(addKidBlock({ hasPin: true, kids: MAX_KIDS - 1, plan: plan(status) })).toBeNull();
    }
  });

  it("does not block on a plan it could not read (the server's answer says it)", () => {
    expect(addKidBlock({ hasPin: true, kids: 0, plan: plan("none", false) })).toBeNull();
  });
});

describe("the Family page's forms", () => {
  it("wants the same 4 digits twice", () => {
    expect(pinFormError("12", "12")).toBe(FAMILY_COPY.pinInvalid);
    expect(pinFormError("1234", "1243")).toBe(FAMILY_COPY.pinMismatch);
    expect(pinFormError("1234", "1234")).toBeNull();
    expect(pinInput("12a3-45")).toBe("1234");
  });

  it("wants a name of 1-30 characters", () => {
    expect(nameError("   ")).toBe(FAMILY_COPY.nameMissing);
    expect(nameError("x".repeat(31))).toBe(FAMILY_COPY.nameTooLong);
    expect(nameError(" Ava ")).toBeNull();
  });

  it("offers K-8 and no grade, and maps both ways", () => {
    expect(GRADE_OPTIONS[0]).toEqual({ value: "0", label: "Kindergarten" });
    expect(GRADE_OPTIONS.at(-1)?.value).toBe(NO_GRADE);
    expect(GRADE_OPTIONS).toHaveLength(10);
    expect(gradeFromOption("3")).toBe(3);
    expect(gradeFromOption(NO_GRADE)).toBeNull();
    expect(gradeFromOption("9")).toBeNull();
    expect(optionFromGrade(null)).toBe(NO_GRADE);
    expect(optionFromGrade(0)).toBe("0");
  });
});

describe("the app bar's family bits", () => {
  it("knows a kid address", () => {
    expect(isKidEmail("kid-1b2c@kids.agathon.app")).toBe(true);
    expect(isKidEmail("KID-1@Kids.Agathon.App ")).toBe(true);
    expect(isKidEmail("parent@example.com")).toBe(false);
    expect(isKidEmail("someone@notkids.agathon.app.evil.com")).toBe(false);
  });

  it("names a kid from their metadata", () => {
    expect(kidDisplayName({ user_metadata: { display_name: " Ava " } })).toBe("Ava");
    expect(kidDisplayName({ user_metadata: {} })).toBe(FAMILY_MENU.kidFallbackName);
    expect(kidDisplayName(null)).toBe(FAMILY_MENU.kidFallbackName);
  });

  describe("the picker event", () => {
    afterEach(() => vi.unstubAllGlobals());
    it("reaches a listener and stops after unsubscribe", () => {
      const target = new EventTarget();
      vi.stubGlobal("window", target);
      const open = vi.fn();
      const off = onOpenProfilePicker(open);
      openProfilePicker();
      expect(open).toHaveBeenCalledTimes(1);
      off();
      target.dispatchEvent(new Event(OPEN_PICKER_EVENT));
      expect(open).toHaveBeenCalledTimes(1);
    });
    it("is a no-op without a window", () => {
      expect(() => openProfilePicker()).not.toThrow();
      expect(onOpenProfilePicker(() => {})).toBeTypeOf("function");
    });
  });
});
