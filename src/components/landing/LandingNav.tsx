import Link from "next/link";
import { BetaBadge } from "@/components/app/BetaBadge";
import { LANDING_PATH, SIGN_IN_HREF, SIGN_UP_HREF } from "@/lib/landing/links";
import { TRY_PATH } from "@/lib/try/contracts";
import { LANDING_COPY } from "./copy";
import { NavTone } from "./NavTone";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

const NAV_ID = "lp-nav";

/**
 * The landing page's top bar: the name, the page's parts (wide screens only), Sign in, and the one
 * pill. Sticky and translucent, so the way in is always one tap away however far down a parent has
 * read; it turns dark while it sits over the dark band (`NavTone`), so nothing reads through it. The
 * part links are plain anchors: the page glides to each (landing.module.css), landing just under
 * the bar.
 */
export function LandingNav() {
  const copy = LANDING_COPY.nav;
  return (
    <header className={styles.nav} id={NAV_ID}>
      <NavTone navId={NAV_ID} />
      <nav aria-label="Agathon" className={`${styles.inner} ${styles.navInner}`}>
        <Link href={LANDING_PATH} className={styles.brand}>
          Agathon
          <BetaBadge className={styles.beta} />
        </Link>
        <ul className={styles.navParts}>
          {copy.links.map((link) => (
            <li key={link.id}>
              <a href={`#${link.id}`} className={styles.navPart}>
                {link.label}
              </a>
            </li>
          ))}
          <li>
            <Link href={TRY_PATH} className={styles.navPart}>
              {copy.tryIt}
            </Link>
          </li>
        </ul>
        <div className={styles.navLinks}>
          <Link href={SIGN_IN_HREF} className={styles.navSignIn}>
            {copy.signIn}
          </Link>
          <Link href={SIGN_UP_HREF} className={`${styles.pill} ${styles.navCta}`}>
            <TrialWords usual={copy.cta} invited={LANDING_COPY.invited.start} />
          </Link>
        </div>
      </nav>
    </header>
  );
}
