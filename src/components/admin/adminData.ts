"use client";

import type { ZodType, ZodTypeDef } from "zod";
import { apiErrorFromResponse, authedFetch, isApiError } from "@/lib/api-client";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import { describeError } from "@/lib/errorMessage";
import { fixtureFetch, fixtureMode } from "./devFixtures";

/**
 * Every read and write the admin console makes, with the admin's own session (a bearer token): the
 * routes answer 401 signed out and 404 to anyone who is not an admin. In development `?fixtures=1`
 * answers from made-up data instead (devFixtures.ts); that branch is compiled out of production.
 */
export function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (process.env.NODE_ENV !== "production" && fixtureMode()) return fixtureFetch(url, init);
  return authedFetch(url, init);
}

/** One read, as a page sees it. */
export type AdminRead<T> = { kind: "data"; data: T } | { kind: "notFound" } | { kind: "signedOut" } | { kind: "error"; error: string };

/** GET `url` and check the answer against the contract's schema. */
export async function readAdmin<T>(url: string, schema: ZodType<T, ZodTypeDef, unknown>, copy: { badShape?: string; fallback?: string } = {}): Promise<AdminRead<T>> {
  try {
    const res = await adminFetch(url, { cache: "no-store" });
    if (res.status === 404) return { kind: "notFound" };
    if (res.status === 401) return { kind: "signedOut" };
    if (!res.ok) throw await apiErrorFromResponse(res);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) return { kind: "error", error: copy.badShape ?? CONSOLE_COPY.badShape };
    return { kind: "data", data: parsed.data };
  } catch (err) {
    if (isApiError(err, "unauthorized")) return { kind: "signedOut" };
    return { kind: "error", error: describeError(err, copy.fallback ?? CONSOLE_COPY.loadFallback) };
  }
}

/** A PATCH with a JSON body; the answer's JSON (or null) when it went through. */
export async function patchAdmin(url: string, body: unknown): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  return sendAdmin("PATCH", url, body);
}

/** A POST with a JSON body (a reply to a bug report); the answer's JSON (or null) when it went through. */
export async function postAdmin(url: string, body: unknown): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  return sendAdmin("POST", url, body);
}

async function sendAdmin(method: "PATCH" | "POST", url: string, body: unknown): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  try {
    const res = await adminFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw await apiErrorFromResponse(res);
    return { ok: true, body: await res.json().catch(() => null) };
  } catch (err) {
    return { ok: false, error: describeError(err, "the server didn't take it") };
  }
}

/** An image the routes serve behind the admin's token (a bug's screenshot), as a Blob. */
export async function readAdminBlob(url: string): Promise<Blob> {
  const res = await adminFetch(url, { cache: "no-store" });
  if (!res.ok) throw await apiErrorFromResponse(res);
  return res.blob();
}
