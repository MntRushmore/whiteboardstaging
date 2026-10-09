import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FAMILY_COPY } from "@/lib/family/copy";
import { GRADE_SECTION_COPY } from "@/lib/onboarding/choice";

/**
 * A kid profile on /account (reachable by typing it; the skill path no longer links a kid there):
 * their address is nobody's sign-in, and their name and grade are their grown-up's to change on the
 * Family page, which keeps the profile and the app bar's name together.
 */

const KID = "kid-3f2a9c1e-0000-4000-8000-000000000001@kids.agathon.app";
const PARENT = "parent@example.com";

const section = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {}, from: () => ({}) } }));
vi.mock("@/components/account/useSection", () => ({
  useSection: () => ({ state: { status: "ready", data: section.data, error: null }, retry: () => undefined }),
}));

const { ProfileCard } = await import("../ProfileCard");
const { GradeSection } = await import("../GradeSection");

const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("the account page's Profile card", () => {
  it("a kid: no address, no 'your sign-in', their name and who changes it, no editor", () => {
    section.data = { display_name: "Ben" };
    const out = html(<ProfileCard userId="k1" email={KID} />);
    expect(out).not.toContain("kids.agathon.app");
    expect(out).not.toContain('data-testid="profile-email"');
    expect(out).not.toMatch(/sign-in/i);
    expect(out).toContain(FAMILY_COPY.kidProfileDescription);
    expect(out).toMatch(/data-testid="profile-display-name"[^>]*>Ben</);
    expect(out).toContain(FAMILY_COPY.kidNameHint);
    expect(out).not.toContain("Edit display name");
    expect(out).not.toContain("<input");
  });

  it("a grown-up: their email, and Edit for the display name", () => {
    section.data = { display_name: "Pat" };
    const out = html(<ProfileCard userId="p1" email={PARENT} />);
    expect(out).toMatch(/data-testid="profile-email"[^>]*>parent@example.com</);
    expect(out).toContain("Edit display name");
    expect(out).not.toContain(FAMILY_COPY.kidNameHint);
  });
});

describe("the account page's Grade card", () => {
  it("a kid sees their grade, and that their grown-up changes it: no picker", () => {
    section.data = { kind: "grade", grade: 3 };
    const out = html(<GradeSection userId="k1" kid />);
    expect(out).toContain('id="grade"');
    expect(out).toContain('data-testid="kid-grade"');
    expect(out).toContain(">3rd grade<");
    expect(out).toContain(FAMILY_COPY.kidGradeHint);
    expect(out).not.toContain(GRADE_SECTION_COPY.label);
    expect(out).not.toContain('role="combobox"');
  });

  it("a kid with no grade yet: Not picked yet", () => {
    section.data = null;
    const out = html(<GradeSection userId="k1" kid />);
    expect(out).toContain(FAMILY_COPY.kidGradeNone);
  });

  it("a grown-up picks the grade", () => {
    section.data = { kind: "grade", grade: 3 };
    const out = html(<GradeSection userId="p1" />);
    expect(out).not.toContain('data-testid="kid-grade"');
    expect(out).toContain(GRADE_SECTION_COPY.label);
  });
});
