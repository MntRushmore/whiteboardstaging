/**
 * Is this a kid profile's address? (`contracts.ts` has the families' rules.) On its own so the board's
 * first load, where the ink meter asks, carries this and not the rest of the contract.
 */

/** Kid accounts' addresses: `kid-<uuid>@kids.agathon.app`. No mailbox; never sent to. */
export const KID_EMAIL_DOMAIN = "kids.agathon.app";

export function isKidEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(`@${KID_EMAIL_DOMAIN}`);
}
