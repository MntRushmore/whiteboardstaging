import NotFound from "@/app/not-found";
import { IssuesScreen } from "@/components/admin/IssuesScreen";

// Like /admin: no title of its own, everything read in the browser with the admin's own session
// (GET and PATCH /api/admin/issues); a non-admin sees the app's 404.
export default function AdminIssuesPage() {
  return <IssuesScreen notFound={<NotFound />} />;
}
