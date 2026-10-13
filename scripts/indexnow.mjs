/**
 * Tells the IndexNow engines (Bing, Yandex, Seznam, Naver and the rest; Bing feeds ChatGPT search
 * and Copilot) that Agathon's public pages are new or changed, so they crawl them now rather than
 * whenever they next come by. The payload is src/lib/seo/indexNow.ts's: every page in
 * `publicPages()`, on the canonical host, with the key file in public/.
 *
 * Run it AFTER a deploy, once the pages and the key file are live (the engines fetch the key file
 * and refuse the list when it is missing):
 *
 *   node scripts/indexnow.mjs --dry-run              # print the payload, send nothing
 *   node scripts/indexnow.mjs                        # submit every public page
 *   node scripts/indexnow.mjs /math /math/fractions  # submit only these paths
 *   node scripts/indexnow.mjs --origin https://www.agathon.app
 *
 * The origin defaults to the canonical host, https://www.agathon.app (the apex redirects there, and
 * the engines want the addresses the pages give as canonical). Before sending, the script checks the
 * key file answers with the key. Submit when pages change, not on a timer: the engines slow down a
 * site that resubmits unchanged pages.
 *
 * Answers: 200 or 202 are accepted (202: the key is still being checked), 403 the key file was not
 * found or did not match, 422 an address is not on the host, 429 too many submissions.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CANONICAL_ORIGIN = "https://www.agathon.app";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const originAt = args.indexOf("--origin");
const origin = originAt >= 0 ? args[originAt + 1] : CANONICAL_ORIGIN;
const paths = args.filter((a, i) => a.startsWith("/") && !(originAt >= 0 && i === originAt + 1));

if (!origin || !/^https?:\/\//.test(origin)) {
  console.error("--origin needs an http(s) address, e.g. https://www.agathon.app");
  process.exit(2);
}

// The payload builder is TypeScript with the app's "@/" imports: load it the way the app sees it.
const jiti = createJiti(import.meta.url, { alias: { "@/": `${path.join(ROOT, "src")}/` } });
const { INDEXNOW_ENDPOINT, indexNowPayload } = await jiti.import(path.join(ROOT, "src/lib/seo/indexNow.ts"));
const { publicPages } = await jiti.import(path.join(ROOT, "src/lib/seo/routes.ts"));

const payload = indexNowPayload(paths.length ? paths : publicPages().map((p) => p.path), origin.replace(/\/+$/, ""));

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\n${payload.urlList.length} addresses on ${payload.host}. Dry run: nothing sent to ${INDEXNOW_ENDPOINT}.`);
  process.exit(0);
}

// The engines fetch the key file first; check it ourselves so a missing file is a clear message.
const keyFile = await fetch(payload.keyLocation, { redirect: "manual" }).catch((error) => ({ ok: false, status: String(error) }));
const keyText = keyFile.ok ? (await keyFile.text()).trim() : "";
if (keyText !== payload.key) {
  console.error(`The key file ${payload.keyLocation} does not answer with the key (status ${keyFile.status}). Deploy public/${payload.key}.txt first.`);
  process.exit(1);
}

const res = await fetch(INDEXNOW_ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(payload),
});
const body = await res.text();
console.log(`${INDEXNOW_ENDPOINT}: ${res.status} ${res.statusText}${body ? `\n${body}` : ""}`);
console.log(`${payload.urlList.length} addresses on ${payload.host}.`);
process.exit(res.status === 200 || res.status === 202 ? 0 : 1);
