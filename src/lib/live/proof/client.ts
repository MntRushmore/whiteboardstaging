"use client";

import { apiJson } from "@/lib/api-client";
import type { FetchJson } from "../recognizeClient";
import type { CallOptions } from "../modelCalls";
import { ProofResponseSchema, type ProofRequest, type ProofResponse } from "./contracts";

/** POST /api/live/proof: a proof's figure read, or one next row (see `./contracts.ts`). */
export const PROOF_PATH = "/api/live/proof";

export async function requestProof(req: ProofRequest, opts: CallOptions = {}, fetchJson: FetchJson = apiJson as FetchJson): Promise<ProofResponse> {
  const parsed = ProofResponseSchema.safeParse(await fetchJson(PROOF_PATH, req, { signal: opts.signal }));
  if (!parsed.success) throw new Error("Proof returned an unexpected response");
  return parsed.data;
}
