/**
 * The landing page's structured data (schema.org JSON-LD, SEO build 2026-10-13, docs/SEO.md): who
 * makes Agathon, the site, the app and its one plan, and the questions the page answers. One
 * `@graph`, its nodes linked by `@id`, so a search engine or an answer engine reads them as one
 * thing: Agathon the organization publishes agathon.app and offers Agathon the app.
 *
 * Only what the page shows: the words come from the landing copy (copy.ts), the price, the trial and
 * the plan's name from the plan (`planWords`, UNLIMITED_PLAN), the contact email from the legal pages
 * (src/lib/legal.ts). Never a rating, a review or a user count.
 *
 * Pure: no React, no network. Unit-tested in `__tests__/core.test.ts`.
 */
import { LANDING_COPY, type LandingCopy } from "@/components/landing/copy";
import { PRICING_ID } from "@/components/landing/bands";
import type { JsonLdThing } from "@/components/seo/JsonLd";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { LANDING_PATH } from "@/lib/landing/links";
import { planWords, type LandingPlan } from "@/lib/landing/plan";
import { isPlaceholder, LEGAL } from "@/lib/legal";
import { LOGO_PATH, SITE_DESCRIPTION, SITE_LANGUAGE, SITE_NAME, SITE_ORIGIN, absoluteUrl } from "./site";

/** The nodes' ids: the site's address with a fragment, the same on every page that names them. */
export function schemaIds(origin: string = SITE_ORIGIN) {
  const home = absoluteUrl(LANDING_PATH, origin);
  return {
    organization: `${home}#organization`,
    website: `${home}#website`,
    app: `${home}#app`,
    faq: `${home}#faq`,
  };
}

/** A price as schema.org wants it: a number as text, no currency sign ("25", "24.50"). */
export function schemaPrice(usd: number): string {
  return Number.isInteger(usd) ? String(usd) : usd.toFixed(2);
}

/** Who makes Agathon: its name, its address, its logo, and the email the legal pages give. */
export function organizationNode(origin: string = SITE_ORIGIN): JsonLdThing {
  const ids = schemaIds(origin);
  const email = isPlaceholder(LEGAL.contactEmail) ? null : LEGAL.contactEmail;
  return {
    "@type": "Organization",
    "@id": ids.organization,
    name: SITE_NAME,
    url: absoluteUrl(LANDING_PATH, origin),
    logo: { "@type": "ImageObject", url: absoluteUrl(LOGO_PATH, origin), width: 512, height: 512 },
    ...(email ? { email, contactPoint: { "@type": "ContactPoint", contactType: "customer support", email, availableLanguage: "English" } } : {}),
  };
}

/** The landing page's `@graph`: Organization, WebSite, the app with its offer, and the FAQ. */
export function landingJsonLd(copy: LandingCopy = LANDING_COPY, plan: LandingPlan = UNLIMITED_PLAN, origin: string = SITE_ORIGIN): JsonLdThing {
  const ids = schemaIds(origin);
  const home = absoluteUrl(LANDING_PATH, origin);
  const words = planWords(plan);
  const price = schemaPrice(plan.monthlyUsd);

  const website: JsonLdThing = {
    "@type": "WebSite",
    "@id": ids.website,
    name: SITE_NAME,
    url: home,
    inLanguage: SITE_LANGUAGE,
    publisher: { "@id": ids.organization },
  };

  const app: JsonLdThing = {
    "@type": "WebApplication",
    "@id": ids.app,
    name: SITE_NAME,
    url: home,
    // what it is (the trial is the offer's)
    description: SITE_DESCRIPTION,
    applicationCategory: "EducationalApplication",
    // it runs in the browser on an iPad, a laptop or a phone (Devices, and "What do we need?")
    operatingSystem: "Web",
    browserRequirements: copy.devices.lede,
    inLanguage: SITE_LANGUAGE,
    audience: {
      "@type": "EducationalAudience",
      educationalRole: "student",
      educationalLevel: ["K–8", "High school"],
      audienceType: `${copy.hero.eyebrow}, high school courses, and their parents`,
    },
    featureList: [...copy.pricing.includes],
    publisher: { "@id": ids.organization },
    offers: {
      "@type": "Offer",
      name: words.name,
      url: `${home}#${PRICING_ID}`,
      price,
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: "USD",
        unitCode: "MON",
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
      },
      description: words.terms,
    },
  };

  // The Questions band's own words, in its order (the answer to the card question is the usual
  // trial's: the server's HTML shows that one).
  const faq: JsonLdThing = {
    "@type": "FAQPage",
    "@id": ids.faq,
    url: home,
    inLanguage: SITE_LANGUAGE,
    isPartOf: { "@id": ids.website },
    about: { "@id": ids.app },
    mainEntity: copy.faq.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return { "@context": "https://schema.org", "@graph": [organizationNode(origin), website, app, faq] };
}
