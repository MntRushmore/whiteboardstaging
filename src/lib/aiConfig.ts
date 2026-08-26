/**
 * Bring-your-own-key (BYOK) configuration.
 *
 * This app ships with NO AI credentials. Whoever deploys or runs it must
 * supply their own keys via environment variables (see `.env.example`).
 * All keys are read server-side only and are never sent to the browser.
 */

import { NextResponse } from 'next/server';

export type ProviderId = 'openrouter' | 'openai' | 'mistral' | 'mathpix';

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  envVar: string;
  /** Where the operator gets a key. */
  signupUrl: string;
  /** Which product features stop working without this key. */
  features: string[];
  /** If false, the app still runs; the listed features are just disabled. */
  required: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    signupUrl: 'https://openrouter.ai/keys',
    features: [
      'Realtime math tutor (OpenRouter Flash on recognized LaTeX)',
      'Legacy image overlay fallback',
      'Worksheet generation',
      'Automatic "needs help" detection',
      'Voice workspace analysis',
      'Credit balance display',
    ],
    required: false,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    signupUrl: 'https://platform.openai.com/api-keys',
    features: ['Realtime voice tutor'],
    required: false,
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    envVar: 'MISTRAL_API_KEY',
    signupUrl: 'https://console.mistral.ai/api-keys',
    features: ['Handwriting / PDF OCR (not used on the live board loop)'],
    required: false,
  },
  mathpix: {
    id: 'mathpix',
    label: 'Mathpix',
    envVar: 'MATHPIX_APP_KEY',
    signupUrl: 'https://mathpix.com/ocr',
    features: ['Stroke-to-LaTeX for the live tutor (Mathpix /v3/strokes)'],
    required: false,
  },
};

/** Mathpix needs both app id and key. */
export function getMathpixCredentials(): { appId: string; appKey: string } | null {
  const appId = process.env.MATHPIX_APP_ID?.trim() ?? '';
  const appKey = getKey('mathpix');
  if (!appId || !appKey) return null;
  if (/^(your|replace|changeme|xxx)/i.test(appId)) return null;
  return { appId, appKey };
}

/** Public site URL used for provider referer headers. */
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

/** Returns the operator's key for a provider, or null if unset. */
export function getKey(provider: ProviderId): string | null {
  const raw = process.env[PROVIDERS[provider].envVar];
  if (!raw) return null;
  const trimmed = raw.trim();
  // Guard against placeholder values copied straight out of .env.example.
  if (!trimmed || /^(your|replace|changeme|xxx)/i.test(trimmed)) return null;
  return trimmed;
}

export function hasKey(provider: ProviderId): boolean {
  return getKey(provider) !== null;
}

/**
 * Consistent 503 for an unconfigured provider. Returns a machine-readable
 * code plus setup instructions, and deliberately leaks nothing about the
 * host environment.
 */
export function missingKeyResponse(provider: ProviderId) {
  const spec = PROVIDERS[provider];
  return NextResponse.json(
    {
      error: `${spec.label} is not configured on this deployment.`,
      code: 'MISSING_API_KEY',
      provider: spec.id,
      envVar: spec.envVar,
      signupUrl: spec.signupUrl,
      hint: `Set ${spec.envVar} in your environment (see .env.example) and restart the server.`,
    },
    { status: 503 },
  );
}

/**
 * Resolve a key or short-circuit the request.
 *
 *   const resolved = requireKey('openrouter');
 *   if (!resolved.ok) return resolved.response;
 *   // resolved.key is a string here
 */
export function requireKey(
  provider: ProviderId,
):
  | { ok: true; key: string }
  | { ok: false; response: ReturnType<typeof missingKeyResponse> } {
  const key = getKey(provider);
  if (!key) return { ok: false, response: missingKeyResponse(provider) };
  return { ok: true, key };
}

export interface ConfigStatus {
  configured: boolean;
  providers: Array<{
    id: ProviderId;
    label: string;
    envVar: string;
    signupUrl: string;
    features: string[];
    required: boolean;
    present: boolean;
  }>;
}

/** Boolean-only summary safe to expose to the client. */
export function getConfigStatus(): ConfigStatus {
  const providers = Object.values(PROVIDERS).map((spec) => ({
    ...spec,
    present: hasKey(spec.id),
  }));
  return {
    configured: providers.every((p) => !p.required || p.present),
    providers,
  };
}
