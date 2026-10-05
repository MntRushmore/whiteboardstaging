import NotFound from "@/app/not-found";
import { AdminScreen } from "@/components/admin/AdminScreen";

// No title of its own: a student who opens /admin sees the app's "Page not found" and a tab that
// says so (set in the browser once the server has answered), never "Admin".
//
// The page reads everything in the browser with the admin's own session (GET /api/admin/overview),
// like /progress and /account. The 404 below is the app's own, rendered here so a non-admin sees
// exactly what any unknown path shows.
export default function AdminPage() {
  return <AdminScreen notFound={<NotFound />} />;
}
