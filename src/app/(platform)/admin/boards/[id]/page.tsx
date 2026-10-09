import NotFound from "@/app/not-found";
import { AdminBoardScreen } from "@/components/adminBoard/AdminBoardScreen";

// The board viewer and replay (ADMIN_PAGES.board): the one admin page that draws a board, so the one
// whose bundle carries tldraw (fetched by AdminBoardScreen once the board is read, never with the
// other admin pages). No title of its own, like /admin: a non-admin sees the app's "Page not found".
export default async function AdminBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminBoardScreen id={id} notFound={<NotFound />} />;
}
