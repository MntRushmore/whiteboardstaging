import { z } from "zod";
import type pino from "pino";
import { json } from "@/lib/server/auth";
import { CreditsExhaustedError, UpstreamError } from "@/lib/server/openrouter";

/* ------------------------------------------------------------------------- */
/* Shared field schemas                                                       */
/* ------------------------------------------------------------------------- */

/** Max characters for a base64 image data URL (~9 MB of image bytes). */
export const MAX_IMAGE_CHARS = 12_000_000;

export const imageDataUrlSchema = z
  .string()
  .max(MAX_IMAGE_CHARS, `Image is too large (max ${MAX_IMAGE_CHARS} characters).`)
  .regex(
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/,
    "Image must be a base64 data URL of type image/png, image/jpeg or image/webp.",
  );

export const modeSchema = z.enum(["off", "feedback", "suggest", "answer"]);
export const modelSchema = z.enum(["gemini", "gemini-fast", "gpt"]);

export const promptSchema = z.string().max(2000, "Prompt must be 2000 characters or fewer.");
export const focusSchema = z.string().max(500, "Focus must be 500 characters or fewer.");
export const topicSchema = z
  .string()
  .trim()
  .min(3, "Topic must be at least 3 characters.")
  .max(500, "Topic must be 500 characters or fewer.");
export const textSchema = z.string().max(20_000, "Text must be 20000 characters or fewer.");

/* ------------------------------------------------------------------------- */
/* Body parsing                                                               */
/* ------------------------------------------------------------------------- */

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "body";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Why a body was refused:
 *  - `unreadable` it never arrived in full: the client went away while it was on its way (the
 *                 Live clients abort on their timeout, or when a newer request for the same line
 *                 supersedes it), so nobody reads the answer;
 *  - `malformed`  it arrived, but is not JSON;
 *  - `invalid`    JSON that the route's schema refuses (`issues` says where).
 */
export type BodyFailure = "unreadable" | "malformed" | "invalid";

export type BodyIssue = { path: string; message: string };

/**
 * Parse and validate a JSON request body. Returns `{ data }` on success or a ready-to-return 400
 * `invalid_request` response, with `failure` (and `issues`) for the caller's log.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: Response; failure: BodyFailure; issues?: BodyIssue[] }> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { response: json(400, "invalid_request", "The request body did not arrive in full."), failure: "unreadable" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // A body cut short by the client going away can also end cleanly, just short.
    const failure: BodyFailure = req.signal?.aborted ? "unreadable" : "malformed";
    return { response: json(400, "invalid_request", "Request body must be valid JSON."), failure };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return {
      response: json(400, "invalid_request", `Invalid request: ${describeIssues(result.error)}`, { issues }),
      failure: "invalid",
      issues,
    };
  }

  return { data: result.data };
}

/* ------------------------------------------------------------------------- */
/* Error mapping                                                              */
/* ------------------------------------------------------------------------- */

/** What the student reads when the provider account behind the tutor has run dry. */
export const PROVIDER_UNAVAILABLE_MESSAGE = "The tutor is unavailable right now. Try again in a few minutes.";

/**
 * Map an error thrown inside a route handler to the shared error contract and
 * log it with the route's child logger.
 */
export function errorResponse(
  err: unknown,
  log: pino.Logger,
  context: Record<string, unknown> = {},
): Response {
  if (err instanceof CreditsExhaustedError) {
    // The operator's provider account, not the student's ink: a 503 the student can only wait out
    // (a 402 would tell them to buy ink that could not help). Logged as an error so it gets seen.
    log.error({ ...context }, "OpenRouter credits exhausted: top up the provider account");
    return json(503, "upstream_error", PROVIDER_UNAVAILABLE_MESSAGE);
  }

  if (err instanceof UpstreamError) {
    log.error({ ...context, upstreamStatus: err.status, error: err.message }, "Upstream API error");
    return json(502, "upstream_error", "The AI service returned an error. Please try again.", {
      details: err.message,
    });
  }

  if (err instanceof Error && err.name === "AbortError") {
    log.info({ ...context }, "Request aborted by client");
    return json(500, "internal_error", "Request was cancelled.");
  }

  log.error(
    {
      ...context,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    },
    "Unhandled route error",
  );
  return json(500, "internal_error", "Something went wrong on our side. Please try again.");
}
