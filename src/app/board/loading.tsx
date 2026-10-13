/**
 * The board's loading spinner. Only the board route has one (2026-10-12): at the app root it wrapped
 * every page in a Suspense boundary, so the landing page, Privacy and Terms shipped a spinner first with
 * their content hidden until React swapped it in (about 300 ms later, and sometimes a full client
 * re-render). The platform pages render their own skeletons.
 */
import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background"
      role="status"
      aria-label="Loading"
    >
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  );
}
