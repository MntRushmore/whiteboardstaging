import type { ReactNode } from "react";
import Link from "next/link";
import { BetaBadge } from "@/components/app/BetaBadge";
import { isDraft, isPlaceholder, LEGAL } from "@/lib/legal";
import styles from "./legal.module.css";

/**
 * The date of this version of the three pages; change it with the text, and with TERMS_VERSION
 * (src/lib/legal.ts) when the change is one sign-up should record.
 */
export const LEGAL_LAST_UPDATED = "October 8, 2026";

/**
 * The frame of /terms, /privacy and /refunds: a plain top bar back to Agathon, the title, the dates,
 * the "Draft" notice while `isDraft()` (src/lib/legal.ts), an optional "In short" summary, then the
 * text. Server-rendered and static: no client code beyond the links.
 */
export function LegalPage({ title, summary, children }: { title: string; summary?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.topInner}>
          <Link href="/" className={styles.brand}>
            {LEGAL.productName}
          </Link>
          <BetaBadge />
        </div>
      </header>
      <main className={styles.column}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.meta}>
          Effective {LEGAL.effectiveDate} · Last updated {LEGAL_LAST_UPDATED}
        </p>
        {isDraft() && (
          <p className={styles.draft} role="note">
            <strong>Draft.</strong> This page is a draft that is still being reviewed. Text in [square brackets] has not
            been filled in yet.
          </p>
        )}
        {summary && (
          <div className={styles.summary}>
            <h2>In short</h2>
            <div className={styles.prose}>{summary}</div>
          </div>
        )}
        <div className={styles.prose}>{children}</div>
      </main>
    </div>
  );
}

/** One section with an anchor id, so it can be linked (/privacy#children). */
export function LegalSection({ id, title, className, children }: { id: string; title: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={className}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}

/** The contact email: a mailto link once it is filled in, the placeholder text until then. */
export function ContactEmail() {
  if (isPlaceholder(LEGAL.contactEmail)) return <>{LEGAL.contactEmail}</>;
  return <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;
}

/** Who runs Agathon and how to reach them, as one block (terms, privacy, refunds all end with it). */
export function ContactBlock() {
  return (
    <p>
      {LEGAL.operatorName}
      <br />
      {LEGAL.postalAddress}
      <br />
      Email: <ContactEmail />
      {LEGAL.contactPhone && (
        <>
          <br />
          Phone: {LEGAL.contactPhone}
        </>
      )}
    </p>
  );
}
