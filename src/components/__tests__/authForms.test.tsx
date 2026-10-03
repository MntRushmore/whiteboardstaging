import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const auth = vi.hoisted(() => ({ value: { user: null as { email: string } | null, loading: true, authError: null } }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} } }));
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => auth.value,
  AuthErrorBanner: () => null,
}));

import { LoginForm } from "../login/LoginForm";
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
