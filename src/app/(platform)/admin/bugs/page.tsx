import NotFound from "@/app/not-found";
import { BugsScreen } from "@/components/admin/BugsScreen";

// Like /admin: no title of its own, everything read in the browser with the admin's own session
// (GET /api/admin/bugs, PATCH /api/admin/bugs/[id]); a non-admin sees the app's 404.
export default function AdminBugsPage() {
  return <BugsScreen notFound={<NotFound />} />;
}
