import { describe, expect, it, vi } from "vitest";
import { AVATARS } from "@/lib/family/contracts";
import { FAMILY_MENU } from "@/lib/family/menu";
import { announceProfileChange, avatarImage, headerName, metadataName, parseOwnProfile, PROFILE_CHANGED_EVENT, type ProfileChange } from "../displayName";

const EMAIL = "qa-night-home-g3@example.com";
const KID = "kid-3f2a9c1e-0000-4000-8000-000000000001@kids.agathon.app";

describe("the app bar's name: headerName", () => {
  it("the profile's display name, for a solo student, a grown-up and a kid alike", () => {
    const profile = { displayName: "Maya", avatar: null };
    expect(headerName({ profile, user: null, email: EMAIL, kid: false })).toBe("Maya");
    expect(headerName({ profile, user: { user_metadata: { display_name: "Old" } }, email: KID, kid: true })).toBe("Maya");
  });

  it("before the profile is read: the name the session carries, then the email's local part", () => {
    expect(headerName({ profile: undefined, user: { user_metadata: { full_name: "Maya Lee" } }, email: EMAIL, kid: false })).toBe("Maya Lee");
    expect(headerName({ profile: undefined, user: { user_metadata: {} }, email: EMAIL, kid: false })).toBe("qa-night-home-g3");
  });

  it("a read profile with no name: the email's local part for a grown-up (not an older sign-up name)", () => {
    const profile = { displayName: null, avatar: null };
    expect(headerName({ profile, user: { user_metadata: { full_name: "Maya Lee" } }, email: EMAIL, kid: false })).toBe("qa-night-home-g3");
    expect(headerName({ profile: null, user: null, email: EMAIL, kid: false })).toBe("qa-night-home-g3");
  });

  it("a kid never shows their address: their metadata name, or Me", () => {
    const profile = { displayName: null, avatar: null };
    expect(headerName({ profile, user: { user_metadata: { display_name: " Ben " } }, email: KID, kid: true })).toBe("Ben");
    expect(headerName({ profile: undefined, user: null, email: KID, kid: true })).toBe(FAMILY_MENU.kidFallbackName);
  });

  it("no email and no name: Account", () => {
    expect(headerName({ profile: null, user: null, email: "", kid: false })).toBe("Account");
  });
});

describe("parseOwnProfile and metadataName", () => {
  it("trims the name, drops a blank one, and keeps only a known picture", () => {
    expect(parseOwnProfile({ display_name: "  Maya ", avatar: "fox" })).toEqual({ displayName: "Maya", avatar: "fox" });
    expect(parseOwnProfile({ display_name: "   ", avatar: "dragon" })).toEqual({ displayName: null, avatar: null });
    expect(parseOwnProfile(null)).toEqual({ displayName: null, avatar: null });
  });

  it("reads display_name before full_name, as sign-up does", () => {
    expect(metadataName({ user_metadata: { display_name: "Pat", full_name: "Patricia Lee" } })).toBe("Pat");
    expect(metadataName({ user_metadata: { full_name: "Patricia Lee" } })).toBe("Patricia Lee");
    expect(metadataName(null)).toBeNull();
  });
});

describe("avatarImage", () => {
  it("the picture's emoji as an SVG image, and nothing without a picture", () => {
    const src = avatarImage("fox");
    expect(src).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(src!.split(",").slice(1).join(","))).toContain(AVATARS.fox);
    expect(avatarImage(null)).toBeUndefined();
    expect(avatarImage(undefined)).toBeUndefined();
  });
});

describe("announceProfileChange", () => {
  it("dispatches the change on the window", () => {
    const seen = vi.fn();
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    target.addEventListener(PROFILE_CHANGED_EVENT, (e) => seen((e as CustomEvent<ProfileChange>).detail));
    announceProfileChange({ userId: "u1", displayName: "Zoe" });
    expect(seen).toHaveBeenCalledWith({ userId: "u1", displayName: "Zoe" });
    vi.unstubAllGlobals();
  });
});
