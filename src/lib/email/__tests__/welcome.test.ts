/**
 * Who gets the welcome email, and that it goes once (src/lib/email/welcome.ts), with fake deps.
 */
import { describe, expect, it } from "vitest";
import { WELCOME_SUBJECT } from "@/lib/email/templates";
import { WELCOME_WINDOW_MS, runWelcome, welcomeEligibility, welcomeIdempotencyKey } from "@/lib/email/welcome";
import { SITE, fakeDeps, silentLog, testEnv } from "./fakes";

const NOW = new Date("2026-10-03T20:00:00Z");
const USER = { id: "11111111-2222-4333-8444-555555555555", email: "parent@example.com", token: "aaaa.bbbb.cccc" };
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("welcomeEligibility", () => {
  it("needs onboarding done, and recently", () => {
    expect(welcomeEligibility(null, NOW)).toBe("not_onboarded");
    expect(welcomeEligibility(undefined, NOW)).toBe("not_onboarded");
    expect(welcomeEligibility("not a date", NOW)).toBe("not_onboarded");
    expect(welcomeEligibility(ago(60_000), NOW)).toBe("eligible");
    expect(welcomeEligibility(ago(WELCOME_WINDOW_MS), NOW)).toBe("eligible");
    expect(welcomeEligibility(ago(WELCOME_WINDOW_MS + 1), NOW)).toBe("not_new");
    // a profile backfilled from an account made months ago (20260928100000_onboarding.sql)
    expect(welcomeEligibility("2026-06-01T12:00:00Z", NOW)).toBe("not_new");
    // a clock a little ahead of ours is still "just now"
    expect(welcomeEligibility(new Date(NOW.getTime() + 5_000).toISOString(), NOW)).toBe("eligible");
  });
});

describe("runWelcome", () => {
  it("sends the welcome to the account's own address, once", async () => {
    const deps = fakeDeps({ now: NOW, onboardedAt: ago(30_000) });
    expect(await runWelcome(deps, testEnv(), USER, silentLog())).toEqual({ status: "sent", id: "re_1" });
    expect(deps.sent).toHaveLength(1);
    const [message] = deps.sent;
    expect(message.to).toBe("parent@example.com");
    expect(message.subject).toBe(WELCOME_SUBJECT);
    expect(message.idempotencyKey).toBe(welcomeIdempotencyKey(USER.id));
    expect(message.idempotencyKey).toBe(`welcome/${USER.id}`);
    expect(message.tags).toEqual({ kind: "welcome" });
    expect(message.html).toContain(`href="${SITE}/"`);
    expect(deps.readOnboardedAt).toHaveBeenCalledWith(USER.token, USER.id);
    expect(deps.log.rows).toEqual([expect.objectContaining({ user_id: USER.id, kind: "welcome", ref: "", resend_id: "re_1" })]);

    expect(await runWelcome(deps, testEnv(), USER, silentLog())).toEqual({ status: "already_sent" });
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it("sends with the deployment's Resend config", async () => {
    const deps = fakeDeps({ now: NOW, onboardedAt: ago(1_000) });
    const env = testEnv({ resend: { apiKey: "re_other", from: "X <x@mail.agathon.app>" } });
    await runWelcome(deps, env, USER, silentLog());
    expect(deps.send).toHaveBeenCalledWith(expect.anything(), env.resend);
  });

  it("skips an account with no usable address, before reading anything", async () => {
    for (const email of [null, "", "  ", "not-an-address"]) {
      const deps = fakeDeps({ now: NOW });
      expect(await runWelcome(deps, testEnv(), { ...USER, email }, silentLog())).toEqual({ status: "skipped", reason: "no_email" });
      expect(deps.readOnboardedAt).not.toHaveBeenCalled();
      expect(deps.log.store.claim).not.toHaveBeenCalled();
    }
  });

  it("skips a student who has not finished onboarding, or finished long ago, without claiming", async () => {
    const notYet = fakeDeps({ now: NOW, onboardedAt: null });
    expect(await runWelcome(notYet, testEnv(), USER, silentLog())).toEqual({ status: "skipped", reason: "not_onboarded" });
    const old = fakeDeps({ now: NOW, onboardedAt: "2026-05-01T00:00:00Z" });
    expect(await runWelcome(old, testEnv(), USER, silentLog())).toEqual({ status: "skipped", reason: "not_new" });
    for (const deps of [notYet, old]) {
      expect(deps.log.store.claim).not.toHaveBeenCalled();
      expect(deps.send).not.toHaveBeenCalled();
    }
  });

  it("a profile that cannot be read is an error, and nothing is sent", async () => {
    const deps = fakeDeps({ now: NOW, onboardedAt: { error: "JWT expired" } });
    expect(await runWelcome(deps, testEnv(), USER, silentLog())).toEqual({ status: "error", error: "JWT expired" });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("a failed send is reported and retried by the next call", async () => {
    const deps = fakeDeps({ now: NOW, onboardedAt: ago(1_000) });
    deps.sendReplies.push({ ok: false, error: "rate_limit_exceeded: slow down", status: 429 });
    expect(await runWelcome(deps, testEnv(), USER, silentLog())).toEqual({ status: "failed", error: "rate_limit_exceeded: slow down" });
    expect(deps.log.rows).toEqual([]);
    expect(await runWelcome(deps, testEnv(), USER, silentLog())).toMatchObject({ status: "sent" });
  });
});
