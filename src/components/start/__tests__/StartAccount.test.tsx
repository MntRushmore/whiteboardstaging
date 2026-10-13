/**
 * The account screen (`StartAccount`), driven like a user would: the component is called as a
 * function with React's state hooks swapped for a little store (`hooks` below), so a test can type,
 * tick, tap and submit, then render again and read what shows. The registry controls, the consent
 * box and Next's Link are stand-ins whose props are read off the element tree; Supabase, the save
 * (`finishStart`) and the step counts are fakes. No DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LOGIN_COPY } from "@/lib/loginErrorMessage";
import { FORM_COPY, signUpRequest } from "@/lib/loginForm";
import { HEARD_FROM } from "@/lib/funnel/contracts";
import type { StartAnswers } from "@/lib/start/contracts";
import { decodeStartAnswers } from "@/lib/start/link";
import { START_PENDING_KEY } from "@/lib/start/pending";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], i: 0, effects: [] as (() => void)[], live: false }));

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  function slot<T>(init: () => T): number {
    const i = hooks.i++;
    if (!(i in hooks.slots)) hooks.slots[i] = init();
    return i;
  }
  return {
    ...real,
    useState: <T,>(init: T | (() => T)) => {
      if (!hooks.live) return real.useState(init);
      const i = slot(() => (typeof init === "function" ? (init as () => T)() : init));
      const set = (next: T | ((prev: T) => T)) => {
        hooks.slots[i] = typeof next === "function" ? (next as (prev: T) => T)(hooks.slots[i] as T) : next;
      };
      return [hooks.slots[i] as T, set];
    },
    useRef: <T,>(init: T) => {
      if (!hooks.live) return real.useRef(init);
      return hooks.slots[slot(() => ({ current: init }))] as { current: T };
    },
    useEffect: (effect: () => void, deps?: unknown[]) => {
      if (!hooks.live) return real.useEffect(effect, deps);
      hooks.effects.push(effect);
    },
    useSyncExternalStore: <T,>(subscribe: () => () => void, get: () => T, server?: () => T) => {
      if (!hooks.live) return real.useSyncExternalStore(subscribe, get, server);
      return get();
    },
  };
});

const fakes = vi.hoisted(() => ({
  signUp: vi.fn(),
  finish: vi.fn(),
  record: vi.fn(),
  link: vi.fn(async () => undefined),
  report: vi.fn(),
}));

vi.mock("next/link", () => ({ default: function Link() { return null; } }));
vi.mock("@/components/login/LoginForm", () => ({ ConsentField: function ConsentField() { return null; } }));
vi.mock("@/registry/components/button/button", () => ({ Button: function Button() { return null; } }));
vi.mock("@/registry/components/input/input", () => ({ Input: function Input() { return null; } }));
vi.mock("@/registry/components/password-field/password-field", () => ({ PasswordField: function PasswordField() { return null; } }));
vi.mock("@/registry/components/alert/alert", () => ({ Alert: function Alert() { return null; } }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signUp: fakes.signUp } } }));
vi.mock("@/lib/start/finish", () => ({ asStartClient: (c: unknown) => c, finishStart: fakes.finish }));
vi.mock("@/lib/start/record", () => ({ recordStartStep: fakes.record, linkStartJourney: fakes.link }));
vi.mock("@/lib/reportAppError", () => ({ reportUserError: fakes.report }));
vi.mock("@/lib/logger", () => ({ clientMetric: () => undefined }));

const { StartAccount } = await import("../StartAccount");
const { Button } = await import("@/registry/components/button/button");
const { Input } = await import("@/registry/components/input/input");
const { PasswordField } = await import("@/registry/components/password-field/password-field");
const { Alert } = await import("@/registry/components/alert/alert");
const { ConsentField } = await import("@/components/login/LoginForm");
const { default: Link } = await import("next/link");

const USER = "11111111-2222-4333-8444-555555555555";
const SAM: StartAnswers = { role: "parent", name: "Sam", choice: { kind: "grade", grade: 3 }, focus: ["times_tables"], tried: { checked: true, solved: true }, heardFrom: null };
const KID: StartAnswers = { ...SAM, role: "kid" };

// ------------------------------------------------------------------ the harness

type El = ReactElement<Record<string, unknown>>;

function* walk(node: ReactNode): Generator<El> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as El;
  yield el;
  yield* walk(el.props.children as ReactNode);
}

function text(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) return text((node as El).props.children as ReactNode);
  return "";
}

class Screen {
  tree: ReactNode = null;
  onDone = vi.fn();
  onBack = vi.fn();
  /** one screen at a time: a new one starts with fresh state */
  constructor(public answers: StartAnswers) {
    hooks.slots = [];
  }
  render(): this {
    hooks.i = 0;
    hooks.effects = [];
    hooks.live = true;
    try {
      this.tree = StartAccount({ answers: this.answers, onDone: this.onDone, onBack: this.onBack });
    } finally {
      hooks.live = false;
    }
    for (const effect of hooks.effects) effect();
    return this;
  }
  all(): El[] {
    return [...walk(this.tree)];
  }
  find(pred: (el: El) => boolean, what = "element"): El {
    const el = this.all().find(pred);
    if (!el) throw new Error(`no ${what} on the screen:\n${this.text()}`);
    return el;
  }
  text(): string {
    return text(this.tree);
  }
  view(): string {
    return String(this.find((el) => el.type === "section").props["data-view"]);
  }
  title(): string {
    return text(this.find((el) => el.type === "h1").props.children as ReactNode);
  }
  button(label: string): El {
    return this.find((el) => (el.type === Button || el.type === "button") && text(el.props.children as ReactNode) === label, `button "${label}"`);
  }
  input(id: string): El {
    return this.find((el) => (el.type === Input || el.type === PasswordField) && el.props.id === id, `input #${id}`);
  }
  tap(label: string): unknown {
    const result = (this.button(label).props.onClick as () => unknown)();
    this.render();
    return result;
  }
  type(id: string, value: string): this {
    (this.input(id).props.onChange as (e: { target: { value: string } }) => void)({ target: { value } });
    return this.render();
  }
  agree(): this {
    (this.find((el) => el.type === ConsentField).props.onChange as (v: boolean) => void)(true);
    return this.render();
  }
  async submit(): Promise<this> {
    await (this.find((el) => el.type === "form").props.onSubmit as (e: { preventDefault(): void }) => Promise<void>)({ preventDefault: () => undefined });
    return this.render();
  }
  fill(email = "parent@example.com", password = "correct horse"): this {
    return this.type("start-email", email).type("start-password", password).agree();
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeLocalStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

let storage: ReturnType<typeof fakeLocalStorage>;

beforeEach(() => {
  hooks.slots = [];
  storage = fakeLocalStorage();
  vi.stubGlobal("window", { localStorage: storage, location: { origin: "https://www.agathon.app", pathname: "/start" } });
  fakes.signUp.mockReset().mockResolvedValue({ data: { session: { user: { id: USER } }, user: { id: USER } }, error: null });
  fakes.finish.mockReset().mockResolvedValue({ next: "/welcome/plan", boardId: "board-1", saved: true, name: "named", failed: [] });
  fakes.record.mockReset();
  fakes.link.mockClear();
  fakes.report.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------ the parent

describe("a parent", () => {
  it("sees the form at once: Save Sam's plan, email, password, the consent box, the optional chips, Sign in", () => {
    const s = new Screen(SAM).render();
    expect(s.view()).toBe("form");
    expect(s.title()).toBe("Save Sam’s plan");
    expect(s.input("start-email").props.autoComplete).toBe("username");
    expect(s.input("start-password").props.autoComplete).toBe("new-password");
    expect(s.input("start-password").props.description).toBe(FORM_COPY.newPasswordHint);
    expect(s.find((el) => el.type === ConsentField).props.checked).toBe(false);
    for (const h of HEARD_FROM) expect(s.button(h.label).props["aria-pressed"]).toBe(false);
    expect(s.text()).toContain("How did you hear about Agathon?");
    expect(s.find((el) => el.type === Link).props.href).toBe("/login");
    const submit = s.find((el) => el.type === Button && el.props.type === "submit");
    expect(text(submit.props.children as ReactNode)).toBe("Save Sam’s plan");
    expect(fakes.record).toHaveBeenCalledWith("start_account_shown", { role: "parent" });
    // shown once, however often it renders
    s.render().render();
    expect(fakes.record).toHaveBeenCalledTimes(1);
  });

  it("without a name: Save your plan", () => {
    expect(new Screen({ ...SAM, name: null }).render().title()).toBe("Save your plan");
  });

  it("submit: Supabase's sign-up with the Terms version, then the answers saved (with where they heard of us), then on to the plan screen", async () => {
    const s = new Screen(SAM).render();
    s.tap("TikTok");
    expect(s.button("TikTok").props["aria-pressed"]).toBe(true);
    await s.fill("  parent@example.com ").submit();
    expect(fakes.signUp).toHaveBeenCalledWith(signUpRequest("parent@example.com", "correct horse"));
    expect(fakes.link).toHaveBeenCalledWith(USER);
    expect(fakes.finish).toHaveBeenCalledWith(expect.anything(), USER, { ...SAM, heardFrom: "tiktok" });
    expect(fakes.record).toHaveBeenCalledWith("start_account", { role: "parent", session: true });
    expect(s.onDone).toHaveBeenCalledWith("/welcome/plan");
    // saved: nothing left waiting on the device
    expect(storage.data.has(START_PENDING_KEY)).toBe(false);
  });

  it("a chip tapped twice is cleared", () => {
    const s = new Screen(SAM).render();
    s.tap("School or a teacher");
    s.tap("School or a teacher");
    expect(s.button("School or a teacher").props["aria-pressed"]).toBe(false);
  });

  it("an empty submit: sign-up's sentences under each field, and no request", async () => {
    const s = await new Screen(SAM).render().submit();
    expect(s.input("start-email").props.error).toBe(FORM_COPY.emailRequired);
    expect(s.input("start-password").props.error).toBe(FORM_COPY.passwordRequired);
    expect(s.find((el) => el.type === ConsentField).props.error).toBe(FORM_COPY.consentRequired);
    expect(fakes.signUp).not.toHaveBeenCalled();
    expect(s.onDone).not.toHaveBeenCalled();
  });

  it("an email with an account: LoginForm's sentence under the email; typing clears it", async () => {
    fakes.signUp.mockResolvedValue({ data: { session: null, user: null }, error: Object.assign(new Error("User already registered"), { code: "user_already_exists" }) });
    const s = await new Screen(SAM).render().fill().submit();
    expect(s.input("start-email").props.error).toBe(LOGIN_COPY.alreadyRegistered);
    expect(fakes.finish).not.toHaveBeenCalled();
    s.type("start-email", "other@example.com");
    expect(s.input("start-email").props.error).toBeUndefined();
  });

  it("the network down: LoginForm's sentence on the form, reported as ours", async () => {
    fakes.signUp.mockRejectedValue(new TypeError("Failed to fetch"));
    const s = await new Screen(SAM).render().fill().submit();
    expect(s.find((el) => el.type === Alert).props.title).toBe(LOGIN_COPY.network);
    expect(fakes.report).toHaveBeenCalledWith(expect.objectContaining({ kind: "live.auth", code: "signup_network" }));
    expect(s.onDone).not.toHaveBeenCalled();
  });

  it("no session back (email confirmation on): check your email; the answers wait for that account", async () => {
    fakes.signUp.mockResolvedValue({ data: { session: null, user: { id: USER } }, error: null });
    const s = await new Screen(SAM).render().fill().submit();
    expect(s.view()).toBe("confirm");
    expect(s.title()).toBe("Check your email");
    expect(s.text()).toContain("parent@example.com");
    expect(fakes.finish).not.toHaveBeenCalled();
    const pending = JSON.parse(storage.data.get(START_PENDING_KEY) ?? "null");
    expect(pending).toMatchObject({ answers: SAM, userId: USER });
  });

  it("'Already have an account? Sign in' keeps the answers on the device for the sign-in", () => {
    const s = new Screen(SAM).render();
    s.tap("Instagram");
    const signIn = s.find((el) => el.type === Link && text(el.props.children as ReactNode) === "Sign in");
    expect(signIn.props.href).toBe("/login");
    (signIn.props.onClick as () => void)();
    const pending = JSON.parse(storage.data.get(START_PENDING_KEY) ?? "null");
    expect(pending.answers).toEqual({ ...SAM, heardFrom: "instagram" });
    expect(pending.userId).toBeUndefined();
  });

  it("Back goes back to the plan", () => {
    const s = new Screen(SAM).render();
    s.tap("Back");
    expect(s.onBack).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ a kid on their own

describe("a kid on their own", () => {
  it("is asked to fetch a grown-up, with two choices", () => {
    const s = new Screen(KID).render();
    expect(s.view()).toBe("ask");
    expect(s.title()).toBe("Ask a grown-up to save your plan");
    expect(s.button("My grown-up is here")).toBeTruthy();
    expect(s.button("Send it to my grown-up")).toBeTruthy();
    expect(s.all().some((el) => el.type === "form")).toBe(false);
    expect(fakes.record).toHaveBeenCalledWith("start_account_shown", { role: "kid" });
  });

  it("'My grown-up is here': the same form, worded for the grown-up; Back returns to the two choices", async () => {
    const s = new Screen(KID).render();
    s.tap("My grown-up is here");
    expect(s.view()).toBe("form");
    expect(s.title()).toBe("Save Sam’s plan");
    expect(s.text()).toContain("Grown-up: use your email and a password to save Sam’s plan.");
    expect(s.find((el) => el.type === "section").props["data-grown-up"]).toBe(true);
    await s.fill().submit();
    expect(fakes.record).toHaveBeenCalledWith("start_account", { role: "kid", grownUpHere: true, session: true });
    expect(s.onDone).toHaveBeenCalledWith("/welcome/plan");

    const t = new Screen(KID).render();
    t.tap("My grown-up is here");
    t.tap("Back");
    expect(t.view()).toBe("ask");
    expect(t.onBack).not.toHaveBeenCalled();
  });

  it("'Send it to my grown-up' with a share sheet: the /start link with the answers, and nothing else", async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { share });
    const s = new Screen(KID).render();
    s.tap("Send it to my grown-up");
    await settle();
    s.render();
    expect(share).toHaveBeenCalledTimes(1);
    const { url } = (share.mock.calls[0] as unknown as [{ url: string }])[0];
    const link = new URL(url);
    expect(`${link.origin}${link.pathname}`).toBe("https://www.agathon.app/start");
    expect([...link.searchParams.keys()]).toEqual(["a"]);
    expect(decodeStartAnswers(link.searchParams.get("a"))).toEqual(KID);
    expect(url).not.toContain("%40");
    expect(fakes.record).toHaveBeenCalledWith("start_handoff", { via: "share" });
    expect(s.view()).toBe("sent");
    expect(s.title()).toBe("Sent!");
  });

  it("closing the share sheet stays on the two choices", async () => {
    vi.stubGlobal("navigator", { share: async () => Promise.reject(Object.assign(new Error("closed"), { name: "AbortError" })) });
    const s = new Screen(KID).render();
    s.tap("Send it to my grown-up");
    await settle();
    expect(s.render().view()).toBe("ask");
    expect(fakes.record).not.toHaveBeenCalledWith("start_handoff", expect.anything());
  });

  it("no share sheet: the link to copy, and an email with no address in it", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const s = new Screen(KID).render();
    s.tap("Send it to my grown-up");
    await settle();
    s.render();
    expect(s.view()).toBe("share");
    const link = String(s.input("start-link").props.value);
    expect(decodeStartAnswers(new URL(link).searchParams.get("a"))).toEqual(KID);
    expect(s.input("start-link").props.readOnly).toBe(true);
    s.tap("Copy link");
    await settle();
    s.render();
    expect(writeText).toHaveBeenCalledWith(link);
    expect(s.button("Copied!")).toBeTruthy();
    expect(fakes.record).toHaveBeenCalledWith("start_handoff", { via: "copy" });
    const mailto = s.find((el) => el.type === "a");
    expect(String(mailto.props.href).startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(String(mailto.props.href))).toContain(link);
    (mailto.props.onClick as () => void)();
    expect(fakes.record).toHaveBeenCalledWith("start_handoff", { via: "email" });
  });

  it("a copy the browser refuses says how to copy it by hand", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => Promise.reject(new Error("denied")) } });
    const s = new Screen(KID).render();
    s.tap("Send it to my grown-up");
    await settle();
    s.render().tap("Copy link");
    await settle();
    s.render();
    expect(s.text()).toContain("Couldn’t copy. Press and hold the link to copy it.");
  });
});

describe("the server's HTML", () => {
  it("renders a posting form (never a GET with the password in the URL), as LoginForm does", () => {
    // the real hooks here: the server render
    const html = renderToStaticMarkup(<StartAccount answers={SAM} onDone={() => undefined} onBack={() => undefined} />);
    expect(html).toContain('method="post"');
    expect(html).toContain('data-view="form"');
  });
});
