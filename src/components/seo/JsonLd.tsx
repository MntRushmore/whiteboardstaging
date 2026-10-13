/**
 * Structured data for search engines and AI answer engines (schema.org JSON-LD, docs/SEO.md).
 * Server-rendered into the page's HTML, so a crawler that runs no JavaScript still reads it.
 * `<` is escaped so no string in the data can close the script element.
 */
export type JsonLdThing = Record<string, unknown>;

export function jsonLdText(data: JsonLdThing | JsonLdThing[]): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

export function JsonLd({ data }: { data: JsonLdThing | JsonLdThing[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(data) }} />;
}
