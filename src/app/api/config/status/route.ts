import { NextResponse } from 'next/server';
import { getConfigStatus } from '@/lib/aiConfig';

/**
 * Reports which AI providers this deployment has keys for.
 *
 * Returns booleans and setup metadata only — never key values, key prefixes,
 * or key lengths. Safe to call from the browser.
 */
export async function GET() {
  return NextResponse.json(getConfigStatus(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
