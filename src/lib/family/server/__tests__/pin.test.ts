import { describe, expect, it } from "vitest";
import { hashPin, isPin, verifyPin } from "../pin";

describe("the grown-up's PIN", () => {
  it("accepts exactly 4 digits", () => {
    for (const ok of ["0000", "1234", "9876"]) expect(isPin(ok)).toBe(true);
    for (const bad of ["123", "12345", "12a4", " 1234", "1234 ", "١٢٣٤", "", null, 1234]) expect(isPin(bad)).toBe(false);
  });

  it("stores scrypt$<salt>$<hash>, never the digits, with a fresh salt each time", async () => {
    const a = await hashPin("4826");
    const b = await hashPin("4826");
    expect(a).toMatch(/^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(a).not.toContain("4826");
    expect(a).not.toBe(b);
  });

  it("verifies the right PIN and refuses every other one", async () => {
    const stored = await hashPin("4826");
    expect(await verifyPin("4826", stored)).toBe(true);
    for (const wrong of ["4825", "0000", "6284", "48260", "482"]) expect(await verifyPin(wrong, stored)).toBe(false);
  });

  it("refuses (never throws) for a missing or damaged stored value", async () => {
    const stored = await hashPin("4826");
    const [, salt, hash] = stored.split("$");
    for (const bad of [null, undefined, "", "4826", `bcrypt$${salt}$${hash}`, `scrypt$${salt}`, `scrypt$${salt}$${hash.slice(1)}`, `scrypt$$${hash}`, `scrypt$${salt}$${hash}$x`]) {
      expect(await verifyPin("4826", bad as string | null | undefined)).toBe(false);
    }
  });

  it("refuses to hash anything but 4 digits", async () => {
    await expect(hashPin("12345")).rejects.toThrow(/4 digits/);
  });
});
