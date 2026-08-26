import { NextRequest, NextResponse } from "next/server";
import { getMathpixCredentials } from "@/lib/aiConfig";
import { tutorLogger } from "@/lib/logger";
import { clampConfidence } from "@/lib/tutor/normalize";
import {
  latexFromMathpix,
  parseStrokeSamples,
  toMathpixStrokePayload,
} from "@/lib/tutor/mathpix";

export const maxDuration = 15;

/**
 * Stroke → LaTeX via Mathpix /v3/strokes only.
 * Missing keys return empty latex — never a setup banner, never Pixtral.
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const body = await req.json().catch(() => ({}));
    const strokes = parseStrokeSamples((body as { strokes?: unknown }).strokes);
    if (strokes.length === 0) {
      return NextResponse.json({ latex: "", confidence: 0 });
    }

    const creds = getMathpixCredentials();
    if (!creds) {
      tutorLogger.info({ requestId }, "Mathpix keys missing; skip recognition");
      return NextResponse.json({ latex: "", confidence: 0 });
    }

    const response = await fetch("https://api.mathpix.com/v3/strokes", {
      method: "POST",
      headers: {
        app_id: creds.appId,
        app_key: creds.appKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...toMathpixStrokePayload(strokes),
        formats: ["latex_styled", "text"],
      }),
    });

    if (!response.ok) {
      tutorLogger.warn(
        { requestId, status: response.status },
        "Mathpix strokes failed",
      );
      return NextResponse.json({ latex: "", confidence: 0 });
    }

    const data = (await response.json()) as Record<string, unknown>;
    const latex = latexFromMathpix(data);
    const confidence = clampConfidence(data.confidence ?? data.confidence_rate ?? 0);

    tutorLogger.info(
      { requestId, latexChars: latex.length, confidence },
      "Mathpix strokes recognized",
    );

    return NextResponse.json({ latex, confidence });
  } catch (error) {
    tutorLogger.error(
      {
        requestId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Mathpix recognize failed",
    );
    return NextResponse.json({ latex: "", confidence: 0 });
  }
}
