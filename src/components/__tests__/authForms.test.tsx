import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const auth = vi.hoisted(() => ({ value: { user: null as { email: string } | null, loading: true, authError: null } }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} } }));
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => auth.value,
  AuthErrorBanner: () => null,
}));

import { ConsentField, LoginForm } from "../login/LoginForm";
import { ResetPasswordForm } from "../login/ResetPasswordForm";

/** the opening tag of every <form> in the markup */
const formTags = (html: string) => html.match(/<form\b[^>]*>/g) ?? [];

/**
 * A form without `method` is a GET: submitted before React attaches onSubmit, the browser put
 * `?email=…&password=…` in the URL (seen on /login). Every form that takes a password posts.
 */
describe("password forms never submit credentials in a URL", () => {
  it("the sign-in / sign-up form posts, and its submit is disabled until hydration", () => {
    auth.value = { user: null, loading: true, authError: null };
    // renderToStaticMarkup is the server render: what the browser has before hydration
    const html = renderToStaticMarkup(<LoginForm />);
    const forms = formTags(html);
    expect(forms).toHaveLength(1);
    expect(forms[0]).toContain('method="post"');
    expect(forms[0]).toContain('action="#"');
    expect(html).toMatch(/type="password"/);
    const submit = (html.match(/<button\b[^>]*>/g) ?? []).filter((tag) => tag.includes('type="submit"'));
    expect(submit).toHaveLength(1);
    expect(submit[0]).toContain('disabled=""');
  });

  it("the choose-a-new-password form posts", () => {
    auth.value = { user: { email: "student@example.com" }, loading: false, authError: null };
    const html = renderToStaticMarkup(<ResetPasswordForm />);
    const forms = formTags(html);
    expect(forms).toHaveLength(1);
    expect(forms[0]).toContain('method="post"');
    expect(html).toMatch(/type="password"/);
  });
});

describe("sign-up consent", () => {
  it("sign-in (the opening tab) never shows the consent box", () => {
    auth.value = { user: null, loading: true, authError: null };
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).not.toContain('type="checkbox"');
  });

  it("the box links the Terms and the Privacy Policy in a new tab and states the age rule", () => {
    const html = renderToStaticMarkup(<ConsentField checked={false} onChange={() => {}} />);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*required/);
    const links = html.match(/<a\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(2);
    expect(links.find((tag) => tag.includes('href="/terms"'))).toContain('target="_blank"');
    expect(links.find((tag) => tag.includes('href="/privacy"'))).toContain('target="_blank"');
    expect(html).toContain("I\u2019m 13 or older, or I\u2019m a parent or guardian setting this up for my child.");
    expect(html).not.toContain("login-consent-error");
  });

  it("an unticked submit says why, tied to the box", () => {
    const html = renderToStaticMarkup(<ConsentField checked={false} onChange={() => {}} error="Tick the box." />);
    const box = html.match(/<input\b[^>]*>/)?.[0] ?? "";
    expect(box).toContain('aria-invalid="true"');
    expect(box).toContain('aria-describedby="login-consent-error"');
    expect(html).toContain('id="login-consent-error"');
  });
});
