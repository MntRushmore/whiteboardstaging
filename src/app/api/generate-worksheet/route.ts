import { NextRequest, NextResponse } from 'next/server';
import { solutionLogger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  solutionLogger.info({ requestId }, 'Worksheet generation request started');

  try {
    const { topic, model: modelParam = 'gemini' } = await req.json();

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return NextResponse.json(
        { error: 'Topic is required' },
        { status: 400 },
      );
    }

    if (!process.env.OPENROUTER_API_KEY) {
      solutionLogger.error({ requestId }, 'OPENROUTER_API_KEY not configured');
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY not configured' },
        { status: 500 },
      );
    }

    const MODEL_IDS: Record<string, string> = {
      gemini: 'google/gemini-3-pro-image-preview',
      'gemini-fast': 'google/gemini-2.5-flash-image',
      gpt: 'openai/gpt-image-1',
    };
    const selectedModel = MODEL_IDS[modelParam] ?? MODEL_IDS['gemini'];

    const prompt = [
      'Generate a clean, printable worksheet image for a student.',
      `Topic: ${topic.trim()}`,
      '',
      'Requirements:',
      '- Pure white background.',
      '- Clear printed-text title at the top of the page.',
      '- A name/date row underneath the title.',
      '- Numbered problems or activities laid out neatly with generous spacing.',
      '- Leave blank space under each problem so the student can write the answer by hand.',
      '- Use only black ink for problems and instructions; do not pre-fill any answers.',
      '- No decorative cartoons, mascots, or watermarks.',
      '- Image dimensions roughly 8.5 x 11 (portrait), legible at typical screen sizes.',
      '- Do not include the words "AI generated" anywhere.',
    ].join('\n');

    solutionLogger.info(
      { requestId, selectedModel, topicLength: topic.length },
      'Calling OpenRouter for worksheet generation',
    );

    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer':
            process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
          'X-Title': 'Agathon Classroom Staging - Worksheet Generator',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: prompt }],
            },
          ],
          modalities: ['image', 'text'],
          reasoning_effort: 'minimal',
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      solutionLogger.error(
        { requestId, status: response.status, error: errorData },
        'OpenRouter API error during worksheet generation',
      );

      const errMsg = (errorData?.error?.message || '').toString().toLowerCase();
      const isOutOfCredits =
        response.status === 402 ||
        errorData?.error?.code === 402 ||
        /insufficient (credit|balance|fund)|out of credit|exceeded.*credit|payment required/i.test(
          errMsg,
        );

      if (isOutOfCredits) {
        return NextResponse.json(
          {
            error: 'credits_exhausted',
            message:
              'Account credits depleted — please talk to Rushil to refill your account!',
          },
          { status: 402 },
        );
      }

      throw new Error(errorData?.error?.message || 'OpenRouter API error');
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    let imageUrl: string | null = null;

    const legacyImages = (message as any)?.images;
    if (Array.isArray(legacyImages) && legacyImages.length > 0) {
      const first = legacyImages[0];
      imageUrl = first?.image_url?.url ?? first?.url ?? null;
    }

    if (!imageUrl) {
      const content = (message as any)?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'image_url' && part.image_url?.url) {
            imageUrl = part.image_url.url;
            break;
          }
          if (part?.type === 'output_image' && (part.url || part.image_url?.url)) {
            imageUrl = part.url || part.image_url?.url;
            break;
          }
        }
      } else if (typeof content === 'string') {
        const dataUrlMatch = content.match(/data:image\/[a-zA-Z+]+;base64,[^\s")'}]+/);
        if (dataUrlMatch) imageUrl = dataUrlMatch[0];
      }
    }

    const duration = Date.now() - startTime;

    if (!imageUrl) {
      solutionLogger.warn(
        { requestId, duration, raw: JSON.stringify(data).slice(0, 1200) },
        'Worksheet generation produced no image',
      );
      return NextResponse.json(
        {
          success: false,
          error: 'no_image',
          message:
            'The model did not return a worksheet. Try rephrasing your topic.',
        },
        { status: 502 },
      );
    }

    solutionLogger.info(
      { requestId, duration, tokensUsed: data.usage?.total_tokens },
      'Worksheet generated successfully',
    );

    return NextResponse.json({ success: true, imageUrl });
  } catch (error) {
    const duration = Date.now() - startTime;
    solutionLogger.error(
      {
        requestId,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'Error generating worksheet',
    );

    return NextResponse.json(
      {
        error: 'Failed to generate worksheet',
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
