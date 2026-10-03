import { afterEach, describe, expect, it } from "vitest";
import { billingLinks } from "../links";

const ORIGINAL = process.env.NEXT_PUBLIC_BILLING_LINKS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BILLING_LINKS;
  else process.env.NEXT_PUBLIC_BILLING_LINKS = ORIGINAL;
});

describe("billingLinks", () => {
  it("is empty when the variable is unset or malformed (every pack then says Coming soon)", () => {
    delete process.env.NEXT_PUBLIC_BILLING_LINKS;
    expect(billingLinks()).toEqual({});
    process.env.NEXT_PUBLIC_BILLING_LINKS = "{oops";
    expect(billingLinks()).toEqual({});
  });
  it("reads the pack -> Payment Link map when present", () => {
    process.env.NEXT_PUBLIC_BILLING_LINKS = '{"small":"https://buy.example/s","large":"https://buy.example/l"}';
    expect(billingLinks()).toEqual({ small: "https://buy.example/s", large: "https://buy.example/l" });
  });
});
