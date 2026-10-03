import { describe, expect, it } from "vitest";
import {
  CHECKOUT_COPY,
  INK_RETURN_TIMEOUT_MS,
  INK_RETURN_WINDOW_MS,
  checkoutUrl,
  inkReturnState,
  parseBillingLinks,
  parseInkReturn,
  payerLinks,
} from "../checkout";

const USER = "8d2a3f1e-4b6c-4d7e-9f01-23456789abcd";

describe("parseBillingLinks", () => {
  it("is empty for anything that is not a JSON object of URLs", () => {
    for (const raw of [undefined, null, "", "   ", "{not json", '["https://a.b"]', '"https://a.b"']) {
      expect(parseBillingLinks(raw), String(raw)).toEqual({});
    }
  });
  it("keeps only absolute http(s) URLs under pack-shaped keys", () => {
    expect(
      parseBillingLinks(
        JSON.stringify({
          small: "https://buy.stripe.com/a",
          medium: "javascript:alert(1)",
          large: "not a url",
          "Bad Key": "https://buy.stripe.com/b",
          portal: "https://billing.stripe.com/p/login/x",
          extra: 5,
        }),
      ),
    ).toEqual({ small: "https://buy.stripe.com/a", portal: "https://billing.stripe.com/p/login/x" });
  });
});

describe("checkoutUrl / payerLinks", () => {
  it("adds the user's id as client_reference_id and prefills the email", () => {
    const url = new URL(checkoutUrl("https://buy.stripe.com/test_abc", { userId: USER, email: "kid+1@example.com" })!);
    expect(url.origin + url.pathname).toBe("https://buy.stripe.com/test_abc");
    expect(url.searchParams.get("client_reference_id")).toBe(USER);
    expect(url.searchParams.get("prefilled_email")).toBe("kid+1@example.com");
  });
  it("keeps other query parameters, overwrites a stale reference, and skips an empty email", () => {
    const url = new URL(checkoutUrl("https://buy.stripe.com/x?locale=en&client_reference_id=someone", { userId: USER, email: "  " })!);
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.get("client_reference_id")).toBe(USER);
    expect(url.searchParams.has("prefilled_email")).toBe(false);
  });
  it("refuses to build a checkout nobody could be matched to, or from a bad link", () => {
    expect(checkoutUrl("https://buy.stripe.com/x", null)).toBeNull();
    expect(checkoutUrl("https://buy.stripe.com/x", { userId: "" })).toBeNull();
    expect(checkoutUrl(undefined, { userId: USER })).toBeNull();
    expect(checkoutUrl("not a url", { userId: USER })).toBeNull();
    expect(checkoutUrl("javascript:alert(1)", { userId: USER })).toBeNull();
  });
  it("makes every pack's link this user's, and drops the ones that cannot be", () => {
    const links = { small: "https://buy.stripe.com/s", medium: "https://buy.stripe.com/m", large: "ftp://nope" };
    const out = payerLinks(links, { userId: USER, email: "a@example.com" });
    expect(Object.keys(out)).toEqual(["small", "medium"]);
    expect(new URL(out.medium).searchParams.get("client_reference_id")).toBe(USER);
    expect(payerLinks(links, null)).toEqual({});
  });
});

describe("parseInkReturn", () => {
  it("reads ?ink=<pack> and refuses anything that is not a pack id", () => {
    expect(parseInkReturn("?ink=medium")).toBe("medium");
    expect(parseInkReturn(new URLSearchParams("ink= Large "))).toBe("large");
    expect(parseInkReturn("?ink=")).toBeNull();
    expect(parseInkReturn("?ink=<script>")).toBeNull();
    expect(parseInkReturn("?upgraded=plus")).toBeNull();
    expect(parseInkReturn(null)).toBeNull();
  });
});

describe("inkReturnState (waiting for the webhook)", () => {
  const startedAt = Date.parse("2026-10-02T12:00:00Z");
  const purchase = (pack: string, at: string) => ({ last_purchase: { pack_id: pack, pack_name: pack, ink: 5000, status: "paid", created_at: at } });

  it("is done once the last purchase is the pack paid for, whether the webhook landed before or after the page", () => {
    expect(inkReturnState({ target: "medium", summary: purchase("medium", "2026-10-02T12:00:05Z"), startedAt, now: startedAt + 6000 })).toBe("done");
    expect(inkReturnState({ target: "medium", summary: purchase("medium", "2026-10-02T11:59:20Z"), startedAt, now: startedAt })).toBe("done");
  });

  it("keeps waiting for an older purchase of the same pack, or another pack, or no summary yet", () => {
    const old = new Date(startedAt - INK_RETURN_WINDOW_MS - 1000).toISOString();
    expect(inkReturnState({ target: "medium", summary: purchase("medium", old), startedAt, now: startedAt + 2000 })).toBe("waiting");
    expect(inkReturnState({ target: "large", summary: purchase("medium", "2026-10-02T12:00:05Z"), startedAt, now: startedAt + 2000 })).toBe("waiting");
    expect(inkReturnState({ target: "medium", summary: null, startedAt, now: startedAt })).toBe("waiting");
    expect(inkReturnState({ target: "medium", summary: { last_purchase: null }, startedAt, now: startedAt })).toBe("waiting");
  });

  it("times out after a minute without it, and Check again restarts the clock", () => {
    expect(inkReturnState({ target: "medium", summary: { last_purchase: null }, startedAt, now: startedAt + INK_RETURN_TIMEOUT_MS })).toBe("timeout");
    expect(inkReturnState({ target: "medium", summary: { last_purchase: null }, startedAt: startedAt + INK_RETURN_TIMEOUT_MS, now: startedAt + INK_RETURN_TIMEOUT_MS })).toBe(
      "waiting",
    );
  });

  it("has words for each state", () => {
    expect(CHECKOUT_COPY.waiting("Medium")).toBe("Adding your Medium pack…");
    expect(CHECKOUT_COPY.done).toBe("Ink added");
    expect(CHECKOUT_COPY.doneDetail("5,000 ink", "5,300 ink")).toBe("5,000 ink is yours. You have 5,300 ink now, and it never expires.");
  });
});
