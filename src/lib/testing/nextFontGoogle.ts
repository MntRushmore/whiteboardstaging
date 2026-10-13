/**
 * `next/font/google` for the tests (vitest.config.ts aliases it here). The real module is empty at
 * run time: Next's compiler replaces each font call with the face's class names while it builds, so
 * a component that loads a Google font (the landing page's serif, src/components/landing/fonts.ts)
 * could not be rendered in a test without this. Each face returns stable class names and its family.
 */
interface FontOptions {
  variable?: string;
}

function face(family: string) {
  const slug = family.toLowerCase().replace(/\W+/g, "-");
  return (options: FontOptions = {}) => ({
    className: `font-${slug}`,
    variable: options.variable ? `font-${slug}-variable` : "",
    style: { fontFamily: `'${family}'` },
  });
}

export const Fraunces = face("Fraunces");
export const Geist = face("Geist");
export const Geist_Mono = face("Geist Mono");
export const Inter = face("Inter");
