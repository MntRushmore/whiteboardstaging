/**
 * Where the email links point (src/lib/email/server.ts): the site and the "Manage or cancel" link,
 * from the env, with safe fallbacks.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import { DEFAULT_EMAIL_FROM } from "@/lib/email/resend";
import { PRODUCTION_SITE_URL, getEmailEnv, resolveManageUrl, resolveSiteUrl } from "@/lib/email/server";

describe("resolveSiteUrl / resolveManageUrl", () => {
  it("uses NEXT_PUBLIC_SITE_URL when it is an absolute http(s) URL, else production", () => {
    expect(PRODUCTION_SITE_URL).toBe("https://agathon.app");
    expect(resolveSiteUrl("https://staging.example.com/")).toBe("https://staging.example.com");
    expect(resolveSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of [undefined, null, "", "  ", "whiteboard.example.com", "javascript:alert(1)"]) {
      expect(resolveSiteUrl(bad), String(bad)).toBe(PRODUCTION_SITE_URL);
    }
  });

  it("links the billing portal when set, else the account page", () => {
    expect(resolveManageUrl("https://billing.stripe.com/p/login/abc", "https://x.example")).toEqual({ url: "https://billing.stripe.com/p/login/abc", portal: true });
    expect(resolveManageUrl(undefined, "https://x.example")).toEqual({ url: "https://x.example/account", portal: false });
    expect(resolveManageUrl("not a url", "https://x.example")).toEqual({ url: "https://x.example/account", portal: false });
  });
});

describe("getEmailEnv", () => {
  const VARS = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "OPENROUTER_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "REPORT_LINK_SECRET",
    "REPORT_LINK_SECRET_PREVIOUS",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_BILLING_PORTAL_URL",
    "ALERT_EMAIL",
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resetServerEnvCache();
  });
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
    resetServerEnvCache();
  });

  it("is safe and empty when nothing is configured", () => {
    expect(getEmailEnv()).toEqual({
      cronSecret: undefined,
      reportLinkSecret: undefined,
      hasServiceRole: false,
      resend: { apiKey: null, from: DEFAULT_EMAIL_FROM },
      siteUrl: PRODUCTION_SITE_URL,
      manageUrl: `${PRODUCTION_SITE_URL}/account`,
      manageIsPortal: false,
      alertEmail: null,
    });
  });

  it("reads every email variable", () => {
    Object.assign(process.env, {
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      CRON_SECRET: " cron-secret ",
      RESEND_API_KEY: "re_live_key",
      EMAIL_FROM: "Agathon <team@mail.agathon.app>",
      NEXT_PUBLIC_SITE_URL: "https://whiteboard.example.com",
      NEXT_PUBLIC_BILLING_PORTAL_URL: "https://billing.stripe.com/p/login/xyz",
      ALERT_EMAIL: " owner@example.com ",
    });
    resetServerEnvCache();
    expect(getEmailEnv()).toEqual({
      cronSecret: "cron-secret",
      // no REPORT_LINK_SECRET: the cron's secret signs the unsubscribe link
      reportLinkSecret: "cron-secret",
      hasServiceRole: true,
      resend: { apiKey: "re_live_key", from: "Agathon <team@mail.agathon.app>" },
      siteUrl: "https://whiteboard.example.com",
      manageUrl: "https://billing.stripe.com/p/login/xyz",
      manageIsPortal: true,
      alertEmail: "owner@example.com",
    });
  });

  it("an ALERT_EMAIL that is not one plain address is none", () => {
    Object.assign(process.env, { ALERT_EMAIL: "Owner <owner@example.com>, two@example.com" });
    resetServerEnvCache();
    expect(getEmailEnv().alertEmail).toBeNull();
  });

  it("signs the unsubscribe link with REPORT_LINK_SECRET when it is set", () => {
    Object.assign(process.env, { CRON_SECRET: "cron-secret", REPORT_LINK_SECRET: " link-secret ", REPORT_LINK_SECRET_PREVIOUS: "old-link-secret" });
    resetServerEnvCache();
    expect(getEmailEnv()).toMatchObject({ cronSecret: "cron-secret", reportLinkSecret: "link-secret" });
  });
});
