import { NextRequest, NextResponse } from "next/server";
import { tutorLogger } from "@/lib/logger";
import { getMathpixCredentials, getSiteUrl, requireKey } from "@/lib/aiConfig";
import {
  constrainMarks,
  mapNormalizedMarkToPage,
  parseJsonObject,
  parseNormalizedMark,
  parseTutorMode,
  clampConfidence,
} from "@/lib/tutor/normalize";
import type {
  ClusterBounds,
  NormalizedMark,
  TutorMark,
  TutorMode,
  TutorResponse,
} from "@/lib/tutor/types";

export const maxDuration = 30;

const FLASH_MODEL = "google/gemini-2.5-flash";

function modeInstructions(mode: TutorMode): string {
  switch (mode) {
    case "socratic":
      return [
        "Mode: socratic.",
        "At most ONE short guiding question as a note (do not give the answer).",
        "Optional ONE circle around the term the student should look at.",
        "No underlines, no arrows, no solution steps.",
      ].join(" ");
    case "solve":
      return [
        "Mode: solve.",
        "Return 1–4 notes with solution steps (LaTeX or compact math).",
        "No circles, underlines, arrows, or images.",
        "Place notes in the right margin (nx >= 0.78).",
      ].join(" ");
    case "feedback":
      return [
        "Mode: feedback.",
        "Circle or underline mistakes (1–3 marks).",
        "At most ONE short margin note. Do not give the full answer.",
      ].join(" ");
  }
}

function buildPrompt(opts: {
  mode: TutorMode;
  nearbyText: string;
  strokes: unknown;
  instructions?: string;
  knownLatex?: string;
  knownConfidence?: number;
}): string {
  const parts = [
    "You are a realtime math tutor for a handwritten whiteboard.",
    "You receive a TIGHT crop of recent strokes (not the whole board) plus optional typed text.",
    "Return JSON only. Never generate or describe an image. Never ask to replace student ink.",
    "",
    "JSON schema:",
    '{ "latex": string, "confidence": number, "mode": "socratic"|"solve"|"feedback", "marks": [{ "kind": "circle"|"underline"|"arrow"|"note", "nx": number, "ny": number, "nw": number, "nh": number, "text"?: string }] }',
    "",
    "- latex: recognized expression, no $ wrappers. Empty if unreadable.",
    "- confidence: 0-1 recognition confidence.",
    "- marks use crop-normalized boxes: (0,0) top-left, (1,1) bottom-right.",
    "- Circle a term, not the whole crop. Notes go in the right margin (nx >= 0.78) and stay short.",
    "- If you cannot read the math confidently, set confidence < 0.5 and marks [].",
    "",
    modeInstructions(opts.mode),
  ];

  if (opts.knownLatex) {
    parts.push(
      "",
      `A recognizer already read this LaTeX (confidence ${opts.knownConfidence ?? "?"}): ${opts.knownLatex}`,
      "Use that latex unless the crop clearly disagrees. Still produce marks for the requested mode.",
    );
  }

  if (opts.nearbyText.trim()) {
    parts.push("", `Typed text near the strokes:\n${opts.nearbyText.trim()}`);
  }

  if (opts.instructions?.trim()) {
    parts.push("", `Extra tutor instructions:\n${opts.instructions.trim()}`);
  }

  const strokeCount = Array.isArray(opts.strokes) ? opts.strokes.length : 0;
  if (strokeCount > 0) {
    parts.push(
      "",
      `Stroke polylines (normalized 0-1, ${strokeCount} stroke(s)):`,
      JSON.stringify(opts.strokes).slice(0, 4000),
    );
  }

  return parts.join("\n");
}

async function callFlash(opts: {
  key: string;
  prompt: string;
  crop?: string;
}): Promise<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  if (opts.crop) {
    content.push({
      type: "image_url",
      image_url: { url: opts.crop },
    });
  }
  content.push({ type: "text", text: opts.prompt });

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getSiteUrl(),
      "X-Title": "Agathon Classroom Staging - Tutor",
    },
    body: JSON.stringify({
      model: FLASH_MODEL,
      messages: [
        {
          role: "user",
          content,
        },
      ],
      response_format: { type: "json_object" },
      reasoning_effort: "minimal",
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errMsg = (errorData?.error?.message || "").toString();
    const isOutOfCredits =
      response.status === 402 ||
      errorData?.error?.code === 402 ||
      /insufficient (credit|balance|fund)|out of credit|exceeded.*credit|payment required/i.test(
        errMsg.toLowerCase(),
      );
    const error = new Error(errMsg || "OpenRouter API error") as Error & {
      status?: number;
      credits?: boolean;
    };
    error.status = response.status;
    error.credits = isOutOfCredits;
    throw error;
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  return parseJsonObject(typeof text === "string" ? text : JSON.stringify(text));
}

async function recognizeWithMathpix(
  crop: string,
): Promise<{ latex: string; confidence: number } | null> {
  const creds = getMathpixCredentials();
  if (!creds) return null;

  const response = await fetch("https://api.mathpix.com/v3/text", {
    method: "POST",
    headers: {
      app_id: creds.appId,
      app_key: creds.appKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      src: crop,
      formats: ["latex_styled", "text"],
    }),
  });

  if (!response.ok) {
    tutorLogger.warn({ status: response.status }, "Mathpix recognition failed; falling back");
    return null;
  }

  const data = await response.json();
  const latex =
    (typeof data.latex_styled === "string" && data.latex_styled) ||
    (typeof data.text === "string" && data.text) ||
    "";
  const confidence = clampConfidence(data.confidence ?? data.confidence_rate ?? 0);
  if (!latex.trim()) return null;
  return { latex: latex.trim(), confidence };
}

function buildResponse(
  raw: Record<string, unknown>,
  mode: TutorMode,
  pageId: string,
  bounds: ClusterBounds,
  latexOverride?: string,
  confidenceOverride?: number,
): TutorResponse {
  const latex =
    (latexOverride && latexOverride.trim()) ||
    (typeof raw.latex === "string" ? raw.latex.trim() : "");
  const confidence = clampConfidence(
    confidenceOverride ?? raw.confidence ?? (latex ? 0.55 : 0),
  );
  const parsedMode = parseTutorMode(raw.mode, mode);
  const rawMarks = Array.isArray(raw.marks) ? raw.marks : [];
  const mapped: TutorMark[] = rawMarks
    .map(parseNormalizedMark)
    .filter((m): m is NormalizedMark => Boolean(m))
    .map((m) => mapNormalizedMarkToPage(m, pageId, bounds));

  return {
    latex,
    confidence,
    mode: parsedMode,
    marks: constrainMarks(parsedMode, mapped),
  };
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  tutorLogger.info({ requestId }, "Tutor request started");

  try {
    const body = await req.json();
    const crop = typeof body.crop === "string" ? body.crop : "";
    const nearbyText = typeof body.nearbyText === "string" ? body.nearbyText : "";
    const strokes = Array.isArray(body.strokes) ? body.strokes : [];
    const pageId = typeof body.pageId === "string" ? body.pageId : "";
    const instructions =
      typeof body.instructions === "string" ? body.instructions : undefined;
    const mode = parseTutorMode(body.mode, "socratic");
    const clusterBounds = body.clusterBounds as ClusterBounds | undefined;

    if (!crop.startsWith("data:image/")) {
      return NextResponse.json({ error: "Tight stroke crop is required" }, { status: 400 });
    }
    if (
      !clusterBounds ||
      ![clusterBounds.x, clusterBounds.y, clusterBounds.w, clusterBounds.h].every(
        Number.isFinite,
      )
    ) {
      return NextResponse.json({ error: "clusterBounds is required" }, { status: 400 });
    }
    if (!pageId) {
      return NextResponse.json({ error: "pageId is required" }, { status: 400 });
    }

    const openrouterKey = requireKey("openrouter");
    if (!openrouterKey.ok) {
      tutorLogger.error({ requestId }, "OPENROUTER_API_KEY is not configured");
      return openrouterKey.response;
    }

    const mathpix = await recognizeWithMathpix(crop).catch((error) => {
      tutorLogger.warn({ requestId, error }, "Mathpix threw; using Flash vision");
      return null;
    });

    const useMathpixLatex = Boolean(mathpix && mathpix.confidence >= 0.5 && mathpix.latex);
    const prompt = buildPrompt({
      mode,
      nearbyText,
      strokes,
      instructions,
      knownLatex: useMathpixLatex ? mathpix!.latex : undefined,
      knownConfidence: useMathpixLatex ? mathpix!.confidence : undefined,
    });

    const raw = await callFlash({
      key: openrouterKey.key,
      prompt,
      crop: useMathpixLatex ? undefined : crop,
    });

    const result = buildResponse(
      raw,
      mode,
      pageId,
      clusterBounds,
      useMathpixLatex ? mathpix!.latex : undefined,
      useMathpixLatex ? mathpix!.confidence : undefined,
    );

    tutorLogger.info(
      {
        requestId,
        duration: Date.now() - startTime,
        mode: result.mode,
        confidence: result.confidence,
        markCount: result.marks.length,
        usedMathpix: useMathpixLatex,
        cropChars: crop.length,
      },
      "Tutor request completed",
    );

    return NextResponse.json(result);
  } catch (error) {
    const credits = Boolean((error as { credits?: boolean })?.credits);
    if (credits) {
      return NextResponse.json(
        {
          error: "credits_exhausted",
          message:
            "Account credits depleted — please talk to Rushil to refill your account!",
        },
        { status: 402 },
      );
    }

    tutorLogger.error(
      {
        requestId,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Tutor request failed",
    );

    return NextResponse.json(
      {
        error: "Failed to run tutor",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
