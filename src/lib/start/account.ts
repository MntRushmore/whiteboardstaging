/**
 * The account screen of /start (`StartAccount`): its words, its submit and the kid's hand-off, with
 * every outside call injected so `__tests__/account.test.ts` runs them against fakes.
 *
 * The form is sign-up's own (src/lib/loginForm.ts): the same checks (`validateLoginForm`), the same
 * request with the Terms version (`signUpRequest`), the same sentences for Supabase's errors
 * (`loginErrorMessage`, `loginErrorField`) and the same reports of ours (`loginFailureReport`).
 * Nothing here forks those rules.
 *
 * Pure: no React, no storage, no network of its own.
 */
import type { UserErrorInput } from "@/lib/clientErrors";
import { loginErrorField, loginErrorMessage, loginFailureReport, type LoginErrorField } from "@/lib/loginErrorMessage";
import { hasFieldErrors, signUpRequest, validateLoginForm, type FieldErrors } from "@/lib/loginForm";
import type { StartAnswers, StartEvent } from "./contracts";
import type { FinishResult } from "./finish";

// ------------------------------------------------------------------ the words

/** "Sam's": the kid's name as the screen says it. */
function possessive(name: string): string {
  return `${name}’s`;
}

export const START_ACCOUNT_COPY = {
  /** the parent's (and the grown-up's, when a kid fetched them) headline and button */
  save: (name: string | null) => (name ? `Save ${possessive(name)} plan` : "Save your plan"),
  saving: "Saving…",
  parentLede: "Use your email and a password, so you can open it again on any device.",
  grownUpLede: (name: string | null) =>
    name ? `Grown-up: use your email and a password to save ${possessive(name)} plan.` : "Grown-up: use your email and a password to save the plan.",
  heardTitle: "How did you hear about Agathon?",
  heardHint: "Optional.",
  haveAccount: "Already have an account?",
  signIn: "Sign in",
  back: "Back",
  // a kid on their own
  askTitle: "Ask a grown-up to save your plan",
  askLede: "A grown-up makes the account. It takes a minute.",
  grownUpHere: "My grown-up is here",
  sendIt: "Send it to my grown-up",
  shareTitle: "Send this to your grown-up",
  shareLede: "When they open the link, they can save your plan.",
  linkLabel: "Link to your plan",
  copy: "Copy link",
  copied: "Copied!",
  copyFailed: "Couldn’t copy. Press and hold the link to copy it.",
  email: "Email it",
  sentTitle: "Sent!",
  sentLede: "When your grown-up opens the link, they can save your plan.",
  // no session back (email confirmation on)
  confirmTitle: "Check your email",
  confirmLede: "We sent a confirmation link to:",
  confirmNext: (name: string | null) => (name ? `Open it, then sign in, and ${possessive(name)} plan is saved.` : "Open it, then sign in, and your plan is saved."),
  confirmSpam: "Nothing after a few minutes? Check your spam folder.",
} as const;

/** What the kid's message to their grown-up says (the share sheet's text, the email's subject and body). */
export function handoffMessage(name: string | null, link: string): { title: string; text: string; subject: string; body: string } {
  const text = "I made my math plan on Agathon. Can you save it? Open this link:";
  const subject = name ? `Save ${possessive(name)} Agathon plan` : "Save my Agathon plan";
  return { title: subject, text, subject, body: `${text}\n\n${link}` };
}

/** `mailto:` with no address (the kid never types one): their grown-up picks who it goes to. */
export function handoffMailto(name: string | null, link: string): string {
  const { subject, body } = handoffMessage(name, link);
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ------------------------------------------------------------------ the form

/** A role as a step's meta (the step counts never carry the name). */
export function roleMeta(answers: Pick<StartAnswers, "role">, grownUpHere = false): Record<string, string | boolean> {
  return { role: answers.role ?? "unknown", ...(grownUpHere ? { grownUpHere: true } : {}) };
}

export type SubmitOutcome =
  | { kind: "invalid"; errors: FieldErrors }
  | { kind: "failed"; field: LoginErrorField; message: string }
  /** no session came back: confirm the email, then the first sign-in finishes the answers */
  | { kind: "confirm"; email: string }
  | { kind: "done"; next: string; result: FinishResult };

interface SignUpReply {
  data: { session: { user: { id: string } } | null; user: { id: string } | null } | null;
  error: unknown;
}

export interface SubmitDeps {
  signUp: (request: ReturnType<typeof signUpRequest>) => Promise<SignUpReply>;
  finish: (userId: string, answers: StartAnswers) => Promise<FinishResult>;
  linkJourney: (userId: string) => Promise<void>;
  record: (event: StartEvent, meta?: Record<string, string | number | boolean | null>) => void;
  report: (error: UserErrorInput) => void;
  /** keep the answers on the device until a signed-in page finishes them (`pending.ts`) */
  keep: (answers: StartAnswers, userId: string | null) => void;
  /** they were saved: forget them */
  forget: () => void;
}

export interface SubmitInput {
  email: string;
  password: string;
  agreed: boolean;
  answers: StartAnswers;
  grownUpHere?: boolean;
}

/**
 * The account screen's submit: sign-up's checks, then Supabase's sign-up with the Terms version,
 * then (with a session) the journey linked and the answers saved (`finishStart`). Never throws.
 */
export async function submitStartAccount(input: SubmitInput, deps: SubmitDeps): Promise<SubmitOutcome> {
  const address = input.email.trim();
  const errors = validateLoginForm("signup", address, input.password, input.agreed);
  if (hasFieldErrors(errors)) return { kind: "invalid", errors };

  let reply: SignUpReply;
  try {
    reply = await deps.signUp(signUpRequest(address, input.password));
    if (reply.error) throw reply.error;
  } catch (error) {
    // ours (the network, a limit, the service) go to the admin page; never the address
    const failure = loginFailureReport(error, "signup");
    if (failure) deps.report(failure);
    return { kind: "failed", field: loginErrorField(error), message: loginErrorMessage(error) };
  }

  const session = reply.data?.session ?? null;
  const userId = session?.user.id ?? reply.data?.user?.id ?? null;
  deps.record("start_account", { ...roleMeta(input.answers, input.grownUpHere), session: Boolean(session) });

  if (!session) {
    // email confirmation is on: the first sign-in on this device finishes them
    deps.keep(input.answers, userId);
    return { kind: "confirm", email: address };
  }

  // kept until saved: a page closed half-way is finished on the next one (`StartResume`)
  deps.keep(input.answers, session.user.id);
  const [, result] = await Promise.all([deps.linkJourney(session.user.id).catch(() => undefined), deps.finish(session.user.id, input.answers)]);
  deps.forget();
  return { kind: "done", next: result.next, result };
}

// ------------------------------------------------------------------ "Send it to my grown-up"

export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

/** How the share sheet went: sent, closed without sending, or not there (show the link to copy). */
export type ShareOutcome = "shared" | "cancelled" | "unavailable";

/** The device's share sheet with the link, when it has one (phones, tablets, Safari). */
export async function shareStartLink(nav: ShareNavigator | null | undefined, name: string | null, link: string): Promise<ShareOutcome> {
  if (!nav || typeof nav.share !== "function") return "unavailable";
  const { title, text } = handoffMessage(name, link);
  try {
    await nav.share({ title, text, url: link });
    return "shared";
  } catch (error) {
    // closing the sheet is not a failure; anything else (a refused permission): copy it instead
    return error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError" ? "cancelled" : "unavailable";
  }
}

/** Copy the link; false when the browser would not. */
export async function copyStartLink(nav: ShareNavigator | null | undefined, link: string): Promise<boolean> {
  try {
    if (!nav?.clipboard) return false;
    await nav.clipboard.writeText(link);
    return true;
  } catch {
    return false;
  }
}
