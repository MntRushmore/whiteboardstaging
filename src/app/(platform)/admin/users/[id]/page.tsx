import NotFound from "@/app/not-found";
import { UserScreen } from "@/components/admin/UserScreen";

// Like /admin: no title of its own, everything read in the browser with the admin's own session
// (GET /api/admin/users/[id]); a non-admin sees the app's 404.
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserScreen id={id} notFound={<NotFound />} />;
}
