import { NextResponse } from 'next/server';

// Cache credit results for 30s so we don't hammer OpenRouter on every dashboard load.
let cache: { data: CreditPayload; expiresAt: number } | null = null;
const TTL_MS = 30_000;

type CreditPayload = {
  total: number;
  used: number;
  remaining: number;
};

export async function GET() {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY not configured' },
      { status: 500 },
    );
  }

  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(cache.data);
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch credits' },
        { status: 502 },
      );
    }

    const json = await res.json();
    const total = Number(json?.data?.total_credits ?? 0);
    const used = Number(json?.data?.total_usage ?? 0);
    const payload: CreditPayload = {
      total,
      used,
      remaining: Math.max(0, total - used),
    };

    cache = { data: payload, expiresAt: Date.now() + TTL_MS };
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch credits',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
