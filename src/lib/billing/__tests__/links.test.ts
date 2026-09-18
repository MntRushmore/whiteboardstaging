import { afterEach, describe, expect, it } from "vitest";
import { billingLinks } from "../links";

const ORIGINAL = process.env.NEXT_PUBLIC_BILLING_LINKS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BILLING_LINKS;
  else process.env.NEXT_PUBLIC_BILLING_LINKS = ORIGINAL;
});

describe("billingLinks", () => {
  it("is empty when the variable is unset or malformed", () => {
    delete process.env.NEXT_PUBLIC_BILLING_LINKS;
    expect(billingLinks()).toEqual({});
    process.env.NEXT_PUBLIC_BILLING_LINKS = "{oops";
    expect(billingLinks()).toEqual({});
  });
  it("reads the JSON map when present", () => {
    process.env.NEXT_PUBLIC_BILLING_LINKS = '{"plus":"https://buy.example/plus","portal":"https://portal.example/"}';
    expect(billingLinks()).toEqual({ plus: "https://buy.example/plus", portal: "https://portal.example/" });
  });
});
