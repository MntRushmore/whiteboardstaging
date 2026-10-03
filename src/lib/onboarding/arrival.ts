/**
 * The boards home, back from starting the free week (the plan's Payment Link returns to
 * `/?unlimited=started`, `isUnlimitedReturn`): what it says, and the URL without the parameter.
 * Pure, and apart from the plan screen's words (`plan.ts`): the home loads only these.
 */
import { UNLIMITED_RETURN_PARAM } from "@/lib/billing/unlimited";

export const ARRIVAL_COPY = {
  started: "Your free week has started!",
  startedHint: "Help me, Solve and Ask are unlimited now. Have fun!",
} as const;

/**
 * The query string without `?unlimited=…` (and with everything else kept), for replacing the URL
 * once the home has said welcome back: a reload must not cheer again. "" when nothing is left.
 */
export function withoutUnlimitedReturn(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(UNLIMITED_RETURN_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
