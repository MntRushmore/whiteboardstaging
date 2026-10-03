import Link from "next/link";
import { LEGAL, LEGAL_LINKS } from "@/lib/legal";
import styles from "./legal.module.css";

/**
 * Terms, Privacy and Refunds under every platform page (sign-in, the boards home, /account and the
 * legal pages themselves), from src/app/(platform)/layout.tsx. Never on the board: the board is
 * outside the platform route group.
 */
export function LegalFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>{LEGAL.productName}</span>
        <nav aria-label="Legal">
          <ul className={styles.footerLinks}>
            {LEGAL_LINKS.map((link) => (
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
