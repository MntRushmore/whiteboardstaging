/**
 * The account screen's submit and the kid's hand-off (src/lib/start/account.ts), against fakes:
 * sign-up's own checks and sentences (src/lib/loginForm.ts, src/lib/loginErrorMessage.ts), the
 * request with the Terms version, then the answers saved (or kept for the first sign-in).
 */
import { describe, expect, it, vi } from "vitest";
import { TERMS_VERSION } from "@/lib/legal";
import { LOGIN_COPY, passwordTooShortMessage } from "@/lib/loginErrorMessage";
import { FORM_COPY, NEW_PASSWORD_MIN_LENGTH, signUpRequest } from "@/lib/loginForm";
import { PLAN_PATH } from "@/lib/onboarding/planMarker";
import type { StartAnswers } from "../contracts";
import type { FinishResult } from "../finish";
import { copyStartLink, handoffMailto, handoffMessage, shareStartLink, START_ACCOUNT_COPY, submitStartAccount, type SubmitDeps } from "../account";

const USER = "11111111-2222-4333-8444-555555555555";
const SAM: StartAnswers = { role: "parent", name: "Sam", choice: { kind: "grade", grade: 3 }, focus: ["times_tables"], tried: null, heardFrom: "school" };
const FINISHED: FinishResult = { next: PLAN_PATH, boardId: "board-1", saved: true, name: "named", failed: [] };
const LINK = "https://www.agathon.app/start#a=eyJyb2xlIjoia2lkIn0";

function fakeDeps(reply: Awaited<ReturnType<SubmitDeps["signUp"]>> | Error = { data: { session: { user: { id: USER } }, user: { id: USER } }, error: null }) {
  const order: string[] = [];
  const deps = {
    signUp: vi.fn(async () => {
      order.push("signUp");
      if (reply instanceof Error) throw reply;
      return reply;
    }),
    finish: vi.fn(async () => {
      order.push("finish");
      return FINISHED;
    }),
    linkJourney: vi.fn(async () => {
      order.push("link");
    }),
    record: vi.fn(),
    report: vi.fn(),
    keep: vi.fn(() => void order.push("keep")),
    forget: vi.fn(() => void order.push("forget")),
  } satisfies SubmitDeps;
  return { deps, order };
}

const GOOD = { email: "  parent@example.com ", password: "correct horse", agreed: true, answers: SAM };

describe("submitStartAccount: sign-up's checks, unchanged", () => {
  it("an empty form, a short password and no consent: sign-up's own sentences, and no request", async () => {
    const { deps } = fakeDeps();
    expect(await submitStartAccount({ ...GOOD, email: "", password: "", agreed: false }, deps)).toEqual({
      kind: "invalid",
      errors: { email: FORM_COPY.emailRequired, password: FORM_COPY.passwordRequired, consent: FORM_COPY.consentRequired },
    });
    expect(await submitStartAccount({ ...GOOD, email: "parent@", password: "short" }, deps)).toEqual({
      kind: "invalid",
      errors: { email: FORM_COPY.emailInvalid, password: passwordTooShortMessage(NEW_PASSWORD_MIN_LENGTH) },
    });
    expect(deps.signUp).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
  });

  it("asks Supabase with the trimmed address and the Terms version, as LoginForm does", async () => {
    const { deps } = fakeDeps();
    await submitStartAccount(GOOD, deps);
    expect(deps.signUp).toHaveBeenCalledWith(signUpRequest("parent@example.com", "correct horse"));
    expect(deps.signUp.mock.calls[0]).toEqual([{ email: "parent@example.com", password: "correct horse", options: { data: { terms_version: TERMS_VERSION } } }]);
  });
});

describe("submitStartAccount: Supabase says no", () => {
  it("an account with that email: under the email, in sign-up's words, not reported", async () => {
    const { deps } = fakeDeps({ data: { session: null, user: null }, error: Object.assign(new Error("User already registered"), { code: "user_already_exists", status: 422 }) });
    expect(await submitStartAccount(GOOD, deps)).toEqual({ kind: "failed", field: "email", message: LOGIN_COPY.alreadyRegistered });
    expect(deps.report).not.toHaveBeenCalled();
    expect(deps.finish).not.toHaveBeenCalled();
    expect(deps.keep).not.toHaveBeenCalled();
  });

  it("a weak password: under the password", async () => {
    const { deps } = fakeDeps({ data: null, error: Object.assign(new Error("Password should be at least 8 characters."), { code: "weak_password", reasons: ["length"] }) });
    const out = await submitStartAccount(GOOD, deps);
    expect(out).toMatchObject({ kind: "failed", field: "password" });
  });

  it("the network: on the form, and reported as ours (never the address)", async () => {
    const { deps } = fakeDeps(new TypeError("Failed to fetch"));
    expect(await submitStartAccount(GOOD, deps)).toEqual({ kind: "failed", field: "form", message: LOGIN_COPY.network });
    expect(deps.report).toHaveBeenCalledWith({ kind: "live.auth", code: "signup_network", message: LOGIN_COPY.network });
    expect(JSON.stringify(deps.report.mock.calls)).not.toContain("parent@example.com");
  });
});

describe("submitStartAccount: the account is made", () => {
  it("with a session: counted, kept until saved, the journey linked, the answers saved, then forgotten", async () => {
    const { deps, order } = fakeDeps();
    const out = await submitStartAccount(GOOD, deps);
    expect(out).toEqual({ kind: "done", next: "/welcome/plan", result: FINISHED });
    expect(deps.record).toHaveBeenCalledWith("start_account", { role: "parent", session: true });
    expect(deps.keep).toHaveBeenCalledWith(SAM, USER);
    expect(deps.linkJourney).toHaveBeenCalledWith(USER);
    expect(deps.finish).toHaveBeenCalledWith(USER, SAM);
    expect(order).toEqual(["signUp", "keep", "link", "finish", "forget"]);
  });

  it("a kid's grown-up: the step says so", async () => {
    const { deps } = fakeDeps();
    await submitStartAccount({ ...GOOD, answers: { ...SAM, role: "kid" }, grownUpHere: true }, deps);
    expect(deps.record).toHaveBeenCalledWith("start_account", { role: "kid", grownUpHere: true, session: true });
  });

  it("a journey link that fails does not stop the save", async () => {
    const { deps } = fakeDeps();
    deps.linkJourney.mockRejectedValueOnce(new Error("offline"));
    expect((await submitStartAccount(GOOD, deps)).kind).toBe("done");
    expect(deps.finish).toHaveBeenCalled();
  });

  it("without a session (email confirmation on): check your email; the answers wait for that account's first sign-in", async () => {
    const { deps } = fakeDeps({ data: { session: null, user: { id: USER } }, error: null });
    expect(await submitStartAccount(GOOD, deps)).toEqual({ kind: "confirm", email: "parent@example.com" });
    expect(deps.keep).toHaveBeenCalledWith(SAM, USER);
    expect(deps.finish).not.toHaveBeenCalled();
    expect(deps.forget).not.toHaveBeenCalled();
    expect(deps.record).toHaveBeenCalledWith("start_account", { role: "parent", session: false });
  });
});

describe("Send it to my grown-up", () => {
  it("the share sheet gets the link and the kid's message", async () => {
    const share = vi.fn(async () => undefined);
    expect(await shareStartLink({ share }, "Sam", LINK)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Save Sam’s Agathon plan", text: handoffMessage("Sam", LINK).text, url: LINK });
  });

  it("closing the sheet stays put; a refused sheet or none at all shows the link to copy", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    expect(await shareStartLink({ share: async () => Promise.reject(abort) }, null, LINK)).toBe("cancelled");
    const refused = Object.assign(new Error("no"), { name: "NotAllowedError" });
    expect(await shareStartLink({ share: async () => Promise.reject(refused) }, null, LINK)).toBe("unavailable");
    expect(await shareStartLink({}, null, LINK)).toBe("unavailable");
    expect(await shareStartLink(null, null, LINK)).toBe("unavailable");
  });

  it("copies the link, or says it could not", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await copyStartLink({ clipboard: { writeText } }, LINK)).toBe(true);
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await copyStartLink({ clipboard: { writeText: async () => Promise.reject(new Error("denied")) } }, LINK)).toBe(false);
    expect(await copyStartLink({}, LINK)).toBe(false);
  });

  it("the email has no address in it (the kid never types one), only the link", () => {
    const mailto = handoffMailto("Sam", LINK);
    expect(mailto.startsWith("mailto:?")).toBe(true);
    const params = new URLSearchParams(mailto.slice("mailto:?".length));
    expect(params.get("subject")).toBe("Save Sam’s Agathon plan");
    expect(params.get("body")).toContain(LINK);
    expect(handoffMailto(null, LINK)).toContain(encodeURIComponent("Save my Agathon plan"));
  });
});

describe("the words", () => {
  it("names the kid when there is a name", () => {
    expect(START_ACCOUNT_COPY.save("Sam")).toBe("Save Sam’s plan");
    expect(START_ACCOUNT_COPY.save(null)).toBe("Save your plan");
    expect(START_ACCOUNT_COPY.grownUpLede("Sam")).toContain("Sam’s plan");
    expect(START_ACCOUNT_COPY.confirmNext(null)).toContain("your plan");
  });
});
