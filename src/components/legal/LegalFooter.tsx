import Link from "next/link";
import { LEGAL, LEGAL_LINKS } from "@/lib/legal";
import { ABOUT_PATH, MATH_PATH } from "@/lib/seo/routes";
import styles from "./legal.module.css";

/**
 * The site's own pages, before the legal ones: the math library and About (SEO build 2026-10-13,
 * docs/SEO.md). Every platform page links them, so a crawler that lands anywhere finds the library.
 */
export const SITE_LINKS = [
  { href: MATH_PATH, label: "Math by grade" },
  { href: ABOUT_PATH, label: "About" },
] as const;

/**
 * The math library, About, Terms, Privacy and Refunds under every platform page (the landing page,
 * sign-in, the boards home, /account and the legal pages themselves), from
 * src/app/(platform)/layout.tsx. Never on the board: the board is outside the platform route group.
 */
export function LegalFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>{LEGAL.productName}</span>
        <nav aria-label="Footer">
          <ul className={styles.footerLinks}>
            {[...SITE_LINKS, ...LEGAL_LINKS].map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
