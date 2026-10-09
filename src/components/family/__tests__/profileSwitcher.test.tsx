import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FamilyState } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";
import { ASK_KEPT_MS, onOpenProfilePicker, openProfilePicker } from "@/lib/family/picker";

/**
 * "Switch profile" (a kid's menu, the Family page's kid view, the kid's plan screen) depends on the
 * switcher having read GET /api/family. Asked before that read lands, or after it failed, the
 * picker must say so (and try again), never do nothing, and never open later on its own.
 */

vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} } }));
vi.mock("@/lib/api-client", () => ({ authedFetch: vi.fn(), apiErrorFromResponse: vi.fn() }));

const { PickerBody } = await import("../ProfileSwitcher");
const { familyView } = await import("../useFamily");

const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const FAMILY: FamilyState = {
  role: "kid",
  me: "ben",
  parentId: "pat",
  hasPin: true,
  members: [
    { userId: "pat", displayName: "Pat", avatar: "owl", grade: null, isParent: true, stats: null },
    { userId: "ben", displayName: "Ben", avatar: "fox", grade: 3, isParent: false, stats: null },
  ],
};

describe("what the switcher knows of the family (useFamily)", () => {
  const read = (version: number, state: FamilyState | null) => ({ userId: "ben", version, state });

  it("before the first read lands: loading, not failed", () => {
    expect(familyView("ben", null, 0, true)).toEqual({ state: null, loading: true, failed: false });
  });

  it("the read failed: failed, and not loading", () => {
    expect(familyView("ben", read(0, null), 0)).toEqual({ state: null, loading: false, failed: true });
  });

  it("tried again after a failure: loading again until it lands, not failed", () => {
    expect(familyView("ben", read(0, null), 1)).toEqual({ state: null, loading: true, failed: false });
    expect(familyView("ben", read(1, FAMILY), 1)).toEqual({ state: FAMILY, loading: false, failed: false });
  });

  it("a re-read of a family it has keeps showing the family", () => {
    expect(familyView("ben", read(0, FAMILY), 1)).toMatchObject({ state: FAMILY, loading: true, failed: false });
  });

  it("another user's read is not this user's", () => {
    expect(familyView("ava", read(0, FAMILY), 0, true)).toEqual({ state: null, loading: true, failed: false });
    expect(familyView(null, null, 0)).toEqual({ state: null, loading: false, failed: false });
  });
});

describe("the picker asked for before the family is ready", () => {
  const body = (props: Partial<React.ComponentProps<typeof PickerBody>>) =>
    html(<PickerBody state={null} loading={false} failed={false} onRetry={vi.fn()} onPinView={vi.fn()} {...props} />);

  it("while GET /api/family is under way: says the pictures are coming", () => {
    const out = body({ loading: true });
    expect(out).toContain('data-testid="picker-loading"');
    expect(out).toContain('role="status"');
    expect(out).toContain(FAMILY_COPY.pickerLoading);
  });

  it("the read failed: says so, with Try again", () => {
    const out = body({ failed: true });
    expect(out).toContain('data-testid="picker-failed"');
    expect(out).toContain('role="alert"');
    expect(out).toContain(FAMILY_COPY.pickerFailed);
    expect(out).toMatch(/<button[^>]*>[\s\S]*Try again/);
  });

  it("the family is read: a tile for everyone", () => {
    const out = body({ state: FAMILY });
    expect(out).toContain(FAMILY_COPY.pickerHint);
    expect(out).toContain("Pat");
    expect(out).toContain("Ben");
    expect(out).not.toContain(FAMILY_COPY.pickerLoading);
  });

  it("no one else to switch to: says so rather than an empty dialog", () => {
    expect(body({})).toContain(FAMILY_COPY.kidsEmpty);
  });
});

describe("an ask made before the switcher's code has arrived", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is answered when the switcher starts listening", () => {
    vi.stubGlobal("window", new EventTarget());
    openProfilePicker();
    const open = vi.fn();
    const off = onOpenProfilePicker(open);
    expect(open).toHaveBeenCalledTimes(1);
    off();
    // answered once: a second listener (the switcher re-subscribing) does not open it again
    const again = vi.fn();
    onOpenProfilePicker(again)();
    expect(again).not.toHaveBeenCalled();
  });

  it("is dropped if the switcher arrives too late: the picker never opens long after a tap", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    openProfilePicker();
    vi.advanceTimersByTime(ASK_KEPT_MS + 1);
    const open = vi.fn();
    onOpenProfilePicker(open)();
    expect(open).not.toHaveBeenCalled();
  });

  it("an ask a listener heard is not kept for the next one", () => {
    vi.stubGlobal("window", new EventTarget());
    const first = vi.fn();
    const off = onOpenProfilePicker(first);
    openProfilePicker();
    expect(first).toHaveBeenCalledTimes(1);
    off();
    const next = vi.fn();
    onOpenProfilePicker(next)();
    expect(next).not.toHaveBeenCalled();
  });
});
