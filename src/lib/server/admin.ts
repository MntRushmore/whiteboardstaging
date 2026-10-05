/**
 * STUB (owner: agent "data"). Admin routes' guard: the caller must be signed in and in
 * `public.admins` (`is_admin()`). Exports are frozen by the contract.
 */
import type { AuthedUser } from "@/lib/server/auth";

/** The signed-in admin, or the response to send (401 signed out, 404 not an admin: the route does not exist for them). */
export async function requireAdmin(req: Request): Promise<{ user: AuthedUser } | { response: Response }> {
  void req;
  return { response: new Response(null, { status: 404 }) };
}
