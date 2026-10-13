/**
 * The server's check of what /start sends (zod). Apart from `contracts.ts` so /start's first screen
 * never loads zod: the page only builds requests, and the route checks them here.
 */
import { z } from "zod";
import { START_EVENTS, type StartStepRequest } from "./contracts";

/** POST body of /api/start/step (public, rate limited per visitor). */
export const StartStepRequestSchema = z.object({
  journeyId: z.string().uuid(),
  event: z.enum(START_EVENTS),
  meta: z.record(z.union([z.string().max(40), z.number().finite(), z.boolean(), z.null()])).optional(),
}) satisfies z.ZodType<StartStepRequest>;
