import NotFound from "@/app/not-found";
import { UsersScreen } from "@/components/admin/UsersScreen";

// Like /admin: no title of its own (a non-admin sees the app's 404 and a tab that says so), and
// everything is read in the browser with the admin's own session (GET /api/admin/users).
export default function AdminUsersPage() {
  return <UsersScreen notFound={<NotFound />} />;
}
