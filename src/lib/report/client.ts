"use client";

/**
 * The report page's calls, from the browser: the week (GET /api/report), a board to replay (GET
 * /api/report/boards/<id>) and the email toggle (the set_weekly_report_opt_out RPC, the caller's own
 * row only, 20261009120000_weekly_report.sql). Readers throw ApiError (src/lib/api-client.ts) so the
 * page can say what went wrong; nothing is cached, because the numbers move while kids practise.
 */
import { ApiError, apiErrorFromResponse, authedFetch } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { REPORT_API, type ReportAnswer } from "./contracts";
import { parseReportAnswer } from "./view";
import { DEFAULT_REPORT_TZ, isTimeZone } from "./week";

/** The browser's IANA zone, for "this week" in the family's own days. */
export function browserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(tz) ? tz : DEFAULT_REPORT_TZ;
  } catch {
    return DEFAULT_REPORT_TZ;
  }
}

/** One week's report (this week when `weekStart` is null). */
export async function loadReport(weekStart: string | null, timeZone: string, signal?: AbortSignal): Promise<ReportAnswer> {
  const params = new URLSearchParams({ tz: timeZone });
  if (weekStart) params.set("week", weekStart);
  const res = await authedFetch(`${REPORT_API}?${params}`, { cache: "no-store", signal });
  if (!res.ok) throw await apiErrorFromResponse(res);
  const answer = parseReportAnswer(await res.json());
  if (!answer) throw new ApiError("The report came back in a shape this page can't read.", 502, "upstream_error");
  return answer;
}

/** A board to replay: the caller's own or one of their kids'. */
export interface ReplayAnswer {
  id: string;
  ownerId: string;
  ownerName: string;
  /** an AVATARS id, or null */
  ownerAvatar: string | null;
  title: string;
  updatedAt: string;
  snapshot: unknown;
}

export async function loadReplay(boardId: string, signal?: AbortSignal): Promise<ReplayAnswer> {
  const res = await authedFetch(`${REPORT_API}/boards/${encodeURIComponent(boardId)}`, { cache: "no-store", signal });
  if (!res.ok) throw await apiErrorFromResponse(res);
  const body = (await res.json()) as Partial<ReplayAnswer>;
  if (typeof body.id !== "string" || typeof body.ownerId !== "string") throw new ApiError("The board came back in a shape this page can't read.", 502, "upstream_error");
  return { id: body.id, ownerId: body.ownerId, ownerName: String(body.ownerName ?? ""), ownerAvatar: typeof body.ownerAvatar === "string" ? body.ownerAvatar : null, title: String(body.title ?? ""), updatedAt: String(body.updatedAt ?? ""), snapshot: body.snapshot ?? null };
}

/** Turn the weekly email off (`true`) or back on; answers the value now stored. */
export async function setReportEmailOptOut(optedOut: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_weekly_report_opt_out", { p_opt_out: optedOut });
  if (error) throw new ApiError(error.message, 400, "invalid_request");
  return data === true;
}
