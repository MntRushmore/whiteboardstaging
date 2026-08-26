import { NextRequest, NextResponse } from 'next/server';
import { voiceLogger } from '@/lib/logger';
import { requireKey, getSiteUrl } from '@/lib/aiConfig';

/**
 * Analyze the current board from recognized LaTeX / nearby text.
 * The live tutor no longer sends a full-board PNG here.
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const { image, latex, text, focus } = await req.json();

    const latexText = typeof latex === 'string' ? latex.trim() : '';
    const nearby = typeof text === 'string' ? text.trim() : '';

    if (!latexText && !nearby && !image) {
      voiceLogger.warn('No latex, text, or image provided to analyze-workspace');
      return NextResponse.json(
        { error: 'No workspace text provided' },
        { status: 400 },
      );
    }

    const openrouterKey = requireKey('openrouter');
    if (!openrouterKey.ok) {
      voiceLogger.error('OPENROUTER_API_KEY is not configured');
      return openrouterKey.response;
    }

    const systemPrompt =
      'You are analyzing a student whiteboard from recognized math and typed text. ' +
      'Describe what the user is working on, how far along they are, any apparent mistakes or gaps, ' +
      'and where they might need help. Be concrete and concise. You are only returning analysis ' +
      'for a voice assistant; do not invent actions or drawings.';

    const parts: string[] = [];
    if (latexText) parts.push(`Recognized LaTeX:\n${latexText}`);
    if (nearby) parts.push(`Nearby typed / extracted text:\n${nearby}`);
    parts.push(
      focus
        ? `Focus on: ${focus}`
        : 'Describe what they are working on and how you could help.',
    );

    const userContent: Array<Record<string, unknown>> = [
      { type: 'text', text: parts.join('\n\n') },
    ];

    // Image is optional leftover; prefer latex/text.
    if (!latexText && !nearby && typeof image === 'string') {
      userContent.unshift({
        type: 'image_url',
        image_url: { url: image },
      });
    }

    voiceLogger.info(
      { hasLatex: Boolean(latexText), hasText: Boolean(nearby), hasImage: Boolean(image) },
      'Calling OpenRouter Gemini 2.5 Flash for workspace analysis',
    );

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openrouterKey.key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': getSiteUrl(),
        'X-Title': 'Agathon Classroom Staging - Voice Workspace Analysis',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      voiceLogger.error(
        {
          status: response.status,
          error: errorData,
        },
        'OpenRouter Gemini 2.5 Flash API error',
      );
      return NextResponse.json(
        { error: 'Workspace analysis failed' },
        { status: 500 },
      );
    }

    const data = await response.json();
    const analysis =
      data.choices?.[0]?.message?.content ??
      data.choices?.[0]?.message?.text ??
      '';

    const duration = Date.now() - startTime;
    voiceLogger.info(
      {
        duration,
        textLength: typeof analysis === 'string' ? analysis.length : 0,
        tokensUsed: data.usage?.total_tokens,
      },
      'Workspace analysis completed successfully',
    );

    return NextResponse.json({
      success: true,
      analysis,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    voiceLogger.error(
      {
        duration,
        error:
          error instanceof Error
            ? { message: error.message, name: error.name, stack: error.stack }
            : error,
      },
      'Error analyzing workspace',
    );

    return NextResponse.json(
      { error: 'Error analyzing workspace' },
      { status: 500 },
    );
  }
}
