import { NextRequest, NextResponse } from "next/server";
import { tutorLogger } from "@/lib/logger";
import { getSiteUrl, requireKey } from "@/lib/aiConfig";
import { pinMathNotesResult, pinSocraticNote } from "@/lib/tutor/layout";
import { evaluateMathNotes } from "@/lib/tutor/mathNotes";
import {
  clampConfidence,
  constrainMarks,
  isUsableLatex,
  mapNormalizedMarkToPage,
  noteTextFitsLatex,
  parseJsonObject,
  parseNormalizedMark,
  parseTutorMode,
} from "@/lib/tutor/normalize";
import {
  isProblemId,
  TUTOR_BACKUP_MODEL,
  TUTOR_FLASH_MODEL,
  type ClusterBounds,
  type NormalizedMark,
  type TutorMode,
  type TutorResponse,
} from "@/lib/tutor/types";

export const maxDuration = 15;

function modeInstructions(mode: TutorMode): string {
  switch (mode) {
    case "socratic":
      return "Mode: socratic. Return exactly ONE short margin question as a note. Do not give the answer. No circles, carets, or steps.";
    case "solve":
      return "Mode: solve. Return 1–4 stepped notes (compact math/LaTeX). They will be pinned to the right of the work. No circles or carets.";
    case "feedback":
      return "Mode: feedback. Return one circle on the error and one caret at the insert/fix point. No notes, no underlines.";
  }
}

function buildPrompt(opts: {
  mode: TutorMode;
  problemId: number;
  latex: string;
  bbox: ClusterBounds;
}): string {
  return [
    "You are a cheap realtime math tutor. You receive only the student's recognized LaTeX and its bounding box.",
    "Never request or describe an image. Never replace student ink.",
    "Return JSON only:",
    '{ "confidence": number, "marks": [{ "kind": "circle"|"caret"|"note", "nx": number, "ny": number, "nw": number, "nh": number, "text"?: string }] }',
    "- marks use last-cluster coordinates: (0,0) top-left of that stroke bbox, (1,1) bottom-right of that bbox. Never the page.",
    "- The Socratic note is pinned just outside that cluster (a few px to the right). Do not place it in a page margin. Do not use nx ~ 0.95 of the page.",
    "- If the LaTeX is empty or unreadable, confidence < 0.5 and marks [].",
    "",
    modeInstructions(opts.mode),
    "",
    `problemId: ${opts.problemId}`,
    `latex: ${opts.latex}`,
    `bbox: ${JSON.stringify(opts.bbox)}`,
  ].join("\n");
}

async function callOpenRouter(
  key: string,
  model: string,
  prompt: string,
): Promise<Record<string, unknown>> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getSiteUrl(),
      "X-Title": "Agathon Classroom Staging - Tutor",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
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

async function callTextModel(key: string, prompt: string): Promise<Record<string, unknown>> {
  try {
    return await callOpenRouter(key, TUTOR_FLASH_MODEL, prompt);
  } catch (error) {
    if ((error as { credits?: boolean })?.credits) throw error;
    return await callOpenRouter(key, TUTOR_BACKUP_MODEL, prompt);
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  tutorLogger.info({ requestId }, "Tutor request started");

  try {
    const body = await req.json();
    const problemId = Number(body.problemId);
    const latex = typeof body.latex === "string" ? body.latex.trim() : "";
    const bbox = body.bbox as ClusterBounds | undefined;
    const mode = parseTutorMode(
      body.mode ?? req.nextUrl.searchParams.get("mode"),
      "socratic",
    );

    if (!isProblemId(problemId)) {
      return NextResponse.json({ error: "problemId must be 1–12" }, { status: 400 });
    }
    if (
      !bbox ||
      ![bbox.x, bbox.y, bbox.w, bbox.h].every((n) => Number.isFinite(n))
    ) {
      return NextResponse.json({ error: "bbox is required" }, { status: 400 });
    }

    if (!isUsableLatex(latex)) {
      const empty: TutorResponse = {
        problemId,
        latex: "",
        bbox,
        confidence: 0,
        mode,
        marks: [],
        miss: "mathpix",
      };
      tutorLogger.info({ requestId, problemId }, "Mathpix miss; stay quiet");
      return NextResponse.json(empty);
    }

    if (mode === "solve") {
      const resultText = evaluateMathNotes(latex);
      const mark = resultText
        ? pinMathNotesResult(
            {
              kind: "note",
              pageId: "",
              x: bbox.x,
              y: bbox.y,
              w: bbox.w,
              h: bbox.h,
              text: resultText,
              problemId,
              latex,
              bbox,
            },
            bbox,
          )
        : null;
      const result: TutorResponse = {
        problemId,
        latex,
        bbox,
        confidence: mark ? 1 : 0,
        mode,
        marks: mark ? [mark] : [],
        miss: mark ? undefined : "flash",
      };
      tutorLogger.info(
        { requestId, problemId, latex, resultText, markCount: result.marks.length },
        mark ? "Math Notes result" : "Math Notes miss; stay quiet",
      );
      return NextResponse.json(result);
    }

    const openrouterKey = requireKey("openrouter");
    if (!openrouterKey.ok) {
      tutorLogger.info({ requestId }, "Flash miss; stay quiet");
      return NextResponse.json({
        problemId,
        latex,
        bbox,
        confidence: 0,
        mode,
        marks: [],
        miss: "flash",
      });
    }

    const raw = await callTextModel(
      openrouterKey.key,
      buildPrompt({ mode, problemId, latex, bbox }),
    );

    const confidence = clampConfidence(raw.confidence ?? 0.7);
    const rawMarks = Array.isArray(raw.marks) ? raw.marks : [];
    const marks = constrainMarks(
      mode,
      rawMarks
        .map(parseNormalizedMark)
        .filter((m): m is NormalizedMark => Boolean(m))
        .map((m) => mapNormalizedMarkToPage(m, "", bbox, problemId, latex)),
    )
      .slice(0, 1)
      .map((mark) => pinSocraticNote(mark, bbox))
      .filter((mark) => Boolean(mark.text?.trim()) && noteTextFitsLatex(mark.text!, latex));

    const usableNote = marks[0]?.kind === "note" && Boolean(marks[0]?.text?.trim());
    const result: TutorResponse = {
      problemId,
      latex,
      bbox,
      confidence,
      mode,
      marks: usableNote ? marks.slice(0, 1) : [],
      miss: usableNote ? undefined : "flash",
    };

    tutorLogger.info(
      {
        requestId,
        duration: Date.now() - startTime,
        problemId,
        mode,
        confidence,
        markCount: result.marks.length,
        latexChars: latex.length,
        miss: result.miss,
      },
      result.miss ? "Flash miss; stay quiet" : "Tutor request completed",
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
