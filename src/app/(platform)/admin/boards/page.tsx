import NotFound from "@/app/not-found";
import { BoardsScreen } from "@/components/admin/BoardsScreen";

// Like /admin: no title of its own, everything read in the browser with the admin's own session
// (GET /api/admin/boards); a non-admin sees the app's 404. Each board opens the read-only viewer
// at /admin/boards/[id] (its own page and bundle: it loads tldraw, this one never does).
export default function AdminBoardsPage() {
  return <BoardsScreen notFound={<NotFound />} />;
}
