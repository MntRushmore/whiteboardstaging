import type { Metadata } from "next";
import { LoginForm } from "@/components/login/LoginForm";
import { PRODUCT_DESCRIPTION, PRODUCT_LINE, ProductLine, ProductPanel } from "@/components/login/ProductPanel";

export const metadata: Metadata = {
  title: "Sign in",
  description: `${PRODUCT_LINE} ${PRODUCT_DESCRIPTION}`,
};

// Server component: the product panel is static and renders with the HTML;
// only the form (auth state, Supabase calls) is a client component.
export default function LoginPage() {
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <ProductPanel className="hidden lg:flex" />
      <main className="flex min-h-dvh flex-col items-center px-4 pt-12 pb-10 sm:justify-center sm:px-6 sm:py-10">
        <div className="w-full max-w-sm">
          <ProductLine className="mb-10 lg:hidden" />
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
