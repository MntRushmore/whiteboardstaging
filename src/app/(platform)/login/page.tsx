import type { Metadata } from "next";
import { LoginForm } from "@/components/login/LoginForm";
import { PRODUCT_DESCRIPTION, PRODUCT_LINE, ProductLine, ProductPanel } from "@/components/login/ProductPanel";
import { ReferralInvite } from "@/components/referral/ReferralInvite";
import styles from "@/components/login/auth.module.css";

export const metadata: Metadata = {
  title: "Sign in",
  description: `${PRODUCT_LINE} ${PRODUCT_DESCRIPTION}`,
};

// Server component: the product panel is static and renders with the HTML;
// only the form (auth state, Supabase calls) is a client component.
export default function LoginPage() {
  return (
    <div className={styles.split}>
      <ProductPanel />
      <main className={styles.formColumn}>
        <div className={styles.formInner}>
          <ProductLine />
          <ReferralInvite />
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
