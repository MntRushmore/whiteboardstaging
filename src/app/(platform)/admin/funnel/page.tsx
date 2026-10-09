import NotFound from "@/app/not-found";
import { FunnelScreen } from "@/components/funnel/FunnelScreen";

// Like /admin: no title of its own (a non-admin sees the app's 404 and a tab that says so), and
// everything is read in the browser with the admin's own session (GET /api/admin/funnel).
export default function AdminFunnelPage() {
  return <FunnelScreen notFound={<NotFound />} />;
}
