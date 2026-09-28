"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthErrorBanner, useAuth } from '@/components/AuthProvider';
import {
  BOARD_SORTS,
  DASHBOARD_COPY,
  boardCountLabel,
  dashboardStateFor,
  displayTitle,
  filterBoards,
  groupBoards,
  sortBoards,
  type BoardListItem,
  type BoardSort,
} from '@/app/dashboardState';
import { describeError } from '@/lib/errorMessage';
import { CreditsBanner } from '@/components/CreditsBanner';
import { AppHeader, APP_CONTENT_CLASS } from '@/components/app/AppHeader';
import { BoardGroups, BoardSkeletons, type BoardActions, type BoardView } from '@/components/boards/BoardList';
import { asDeleteBoardClient, deleteBoardWithAssets } from '@/lib/assets/deleteBoard';
import { DEFAULT_BOARD_TITLE, isDefaultBoardTitle } from '@/lib/boards/boardTitle';
import { settleExitWrites } from '@/lib/boards/exitWrites';
import { EmptyBoards } from '@/components/boards/EmptyBoards';
import { useWelcome } from '@/components/onboarding/useWelcome';
import { homeView } from '@/lib/onboarding/state';
import {
  Plus,
  Search,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  X,
} from 'lucide-react';
import { toast } from "sonner";
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/** How long the first list read waits for a board that is still saving as it closes. */
const EXIT_WRITE_WAIT_MS = 3000;

// First-run welcome: loaded only for a new student with no boards (see useWelcome).
const Welcome = lazy(() => import('@/components/onboarding/Welcome'));

/**
 * Inline error row with a Retry button. Used for every dashboard mutation so
 * a failure is visible next to the thing you clicked, not only as a toast.
 */
function InlineError({
  title,
  message,
  onRetry,
  retrying = false,
  className,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-state="error"
      className={cn(
        "flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800",
        className,
      )}
    >
      <AlertTriangle className="w-4 h-4 shrink-0 hidden sm:block" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">{title}.</span> <span>{message}</span>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="bg-white"
          onClick={onRetry}
          disabled={retrying}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", retrying && "animate-spin")} />
          {DASHBOARD_COPY.retry}
        </Button>
      )}
    </div>
  );
}

/** A centred message in the content area: the empty dashboard, no search results, a failed load. */
function Notice({
  icon,
  title,
  children,
  action,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      data-state={tone === "error" ? "error" : undefined}
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-16 text-center shadow-xs",
        tone === "error" && "border-red-200",
      )}
    >
      <div
        className={cn(
          "mb-4 grid size-12 place-items-center rounded-full",
          tone === "error" ? "bg-red-50 text-red-600" : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-1.5 max-w-lg text-sm text-balance text-muted-foreground">{children}</div>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Re-renders every `ms` so "Edited 2 min ago" keeps up while the page is open. */
function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const [whiteboards, setWhiteboards] = useState<BoardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<BoardView>('grid');
  const [sort, setSort] = useState<BoardSort>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const now = useNow(60_000);

  // Rename state
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<BoardListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Auth gate: redirect to login if not authenticated. When the sign-in
  // service could not be reached we show a banner with Retry instead, so a
  // flaky connection does not bounce a signed-in student to /login.
  useEffect(() => {
    if (!authLoading && !user && !authError) {
      router.replace('/login');
    }
  }, [user, authLoading, authError, router]);

  // A toast still on screen when the dashboard opens belongs to the page before it (the
  // sign-in page's "Signed in"): it would only sit over the cards. Toasts raised here stay.
  useEffect(() => {
    toast.dismiss();
  }, []);

  const fetchWhiteboards = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      // A board closed a moment ago may still be writing its thumbnail and name.
      await settleExitWrites(EXIT_WRITE_WAIT_MS);
      const { data, error } = await supabase
        .from('whiteboards')
        .select('id, title, created_at, updated_at, preview, version')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setWhiteboards(data || []);
    } catch (error) {
      console.error('Error fetching whiteboards:', error);
      // Rendered as an inline panel with Retry (see dashboardStateFor). A
      // "JWT issued at future" rejection is local clock skew; describeError
      // names that instead of echoing the raw token error.
      setFetchError(describeError(error, DASHBOARD_COPY.loadFallback));
    } finally {
      setLoading(false);
    }
  }, []);

  const userId = user?.id;
  useEffect(() => {
    if (userId) void fetchWhiteboards();
  }, [userId, fetchWhiteboards]);

  async function createWhiteboard() {
    if (creating || !user) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { data, error } = await supabase
        .from('whiteboards')
        .insert([
          { title: DEFAULT_BOARD_TITLE, data: {}, user_id: user.id }
        ])
        .select()
        .single();

      if (error) throw error;
      router.push(`/board/${data.id}`);
    } catch (error) {
      console.error('Error creating whiteboard:', error);
      // Button stays enabled; the error sits right under it with Retry.
      setCreateError(describeError(error, DASHBOARD_COPY.createFallback));
      setCreating(false);
    }
  }

  async function deleteWhiteboard(id: string) {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Removes the board's Storage objects too (registered in board_assets); a
      // failure there is reported, not fatal - the nightly GC reclaims what is left.
      const result = await deleteBoardWithAssets(asDeleteBoardClient(supabase), id);
      setWhiteboards((prev) => prev.filter(w => w.id !== id));
      if (result.assetErrors.length > 0) {
        console.warn('Some board images could not be removed:', result.assetErrors);
        toast.warning('Board deleted, but some images could not be removed');
      } else {
        toast.success('Board deleted');
      }
      setDeleteTarget(null);
    } catch (error) {
      console.error('Error deleting whiteboard:', error);
      // Dialog stays open with the message and a Retry.
      setDeleteError(describeError(error, DASHBOARD_COPY.deleteFallback));
    } finally {
      setDeleting(false);
    }
  }

  async function handleRename() {
    const title = renameTitle.trim();
    if (!renameId || renaming || !title) return;
    setRenaming(true);
    setRenameError(null);
    try {
      const { error } = await supabase
        .from('whiteboards')
        .update({ title })
        .eq('id', renameId);

      if (error) throw error;

      // The list shows the new name; no toast needed on top of it.
      setWhiteboards((prev) => prev.map(w =>
        w.id === renameId ? { ...w, title, updated_at: new Date().toISOString() } : w
      ));
      setRenameId(null);
    } catch (error) {
      console.error('Error renaming whiteboard:', error);
      // Dialog stays open with the message and a Retry.
      setRenameError(describeError(error, DASHBOARD_COPY.renameFallback));
    } finally {
      setRenaming(false);
    }
  }

  function closeRename() {
    if (renaming) return;
    setRenameId(null);
    setRenameError(null);
  }

  function closeDelete() {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }

  const actions: BoardActions = {
    onRename: (board) => {
      setRenameId(board.id);
      // An unnamed board starts empty rather than with "Untitled Whiteboard" to delete.
      setRenameTitle(isDefaultBoardTitle(board.title) ? '' : board.title);
      setRenameError(null);
    },
    onDelete: (board) => {
      setDeleteTarget(board);
      setDeleteError(null);
    },
  };

  const listState = dashboardStateFor({
    loading: loading || authLoading || !user,
    error: fetchError,
    boards: whiteboards,
  });
  // A new student with no boards gets the welcome instead of the empty state.
  const welcome = useWelcome(
    user?.id,
    listState === 'loading' ? 'loading' : listState === 'error' ? 'error' : whiteboards.length,
  );
  const dashboardState = homeView(listState, welcome.decision);

  const groups = useMemo(
    () => groupBoards(sortBoards(filterBoards(whiteboards, searchQuery), sort), sort, now),
    [whiteboards, searchQuery, sort, now],
  );
  const sortLabel = BOARD_SORTS.find((s) => s.value === sort)?.label ?? '';

  if (!user && authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <div className="w-full max-w-md">
          <AuthErrorBanner />
        </div>
      </div>
    );
  }

  if (dashboardState === 'welcome' && user) {
    return (
      <div className="min-h-screen bg-muted/40">
        <AppHeader />
        <main className={cn(APP_CONTENT_CLASS, "pt-8 pb-16 sm:pt-10")}>
          <AuthErrorBanner className="mb-6" />
          <Suspense fallback={<div aria-hidden className="mx-auto h-120 w-full max-w-5xl animate-pulse rounded-xl border bg-card" />}>
            <Welcome userId={user.id} onSkip={welcome.skip} />
          </Suspense>
        </main>
      </div>
    );
  }

  const newBoardButton = (
    <Button onClick={createWhiteboard} disabled={creating || !user}>
      {creating ? <Loader2 className="animate-spin" /> : <Plus />}
      New Board
    </Button>
  );

  return (
    <div className="min-h-screen bg-muted/40">
      <AppHeader />
      <main className={cn(APP_CONTENT_CLASS, "pt-8 pb-16 sm:pt-10")}>
        <AuthErrorBanner className="mb-6" />
        <CreditsBanner className="mb-6" />

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">My whiteboards</h1>
            {dashboardState === 'list' && (
              <p className="mt-0.5 text-sm text-muted-foreground">{boardCountLabel(whiteboards.length)}</p>
            )}
            {dashboardState === 'loading' && <div aria-hidden className="mt-1.5 h-4 w-20 animate-pulse rounded bg-muted" />}
          </div>
          {/* The empty state carries its own New Board: one call to action, not two. */}
          {dashboardState !== 'empty' && newBoardButton}
        </div>

        {createError && (
          <InlineError
            className="mt-4"
            title={DASHBOARD_COPY.createFailedTitle}
            message={createError}
            onRetry={createWhiteboard}
            retrying={creating}
          />
        )}

        {/* Shown while loading too, so the grid does not jump down when the list arrives. */}
        {(dashboardState === 'list' || dashboardState === 'loading') && (
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                aria-label="Search boards"
                placeholder="Search boards"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
                className="h-9 bg-background pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery('')}
                  className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" aria-label={`Sort boards: ${sortLabel}`} className="flex-1 justify-between sm:flex-none">
                    <span className="flex items-center gap-2">
                      <ArrowDownUp className="text-muted-foreground" />
                      {sortLabel}
                    </span>
                    <ChevronDown className="text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Sort by</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as BoardSort)}>
                    {BOARD_SORTS.map((s) => (
                      <DropdownMenuRadioItem key={s.value} value={s.value}>
                        {s.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <div role="group" aria-label="Layout" className="inline-flex h-9 items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-xs">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                  onClick={() => setViewMode('grid')}
                  className={cn("size-7 text-muted-foreground", viewMode === 'grid' && "bg-accent text-foreground")}
                >
                  <LayoutGrid />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                  onClick={() => setViewMode('list')}
                  className={cn("size-7 text-muted-foreground", viewMode === 'list' && "bg-accent text-foreground")}
                >
                  <ListIcon />
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8">
          {dashboardState === 'loading' ? (
            <BoardSkeletons />
          ) : dashboardState === 'error' ? (
            <Notice
              tone="error"
              icon={<AlertTriangle className="size-5" />}
              title={DASHBOARD_COPY.loadFailedTitle}
              action={
                <Button onClick={fetchWhiteboards} variant="outline">
                  <RefreshCw />
                  {DASHBOARD_COPY.retry}
                </Button>
              }
            >
              {fetchError}
            </Notice>
          ) : dashboardState === 'empty' ? (
            <EmptyBoards action={newBoardButton} />
          ) : groups.length === 0 ? (
            <Notice
              icon={<Search className="size-5" />}
              title={DASHBOARD_COPY.noMatchesTitle}
              action={
                <Button variant="outline" onClick={() => setSearchQuery('')}>
                  Clear search
                </Button>
              }
            >
              {DASHBOARD_COPY.noMatchesHint}
            </Notice>
          ) : (
            <BoardGroups groups={groups} view={viewMode} now={now} actions={actions} />
          )}
        </div>
      </main>

      <Dialog open={!!renameId} onOpenChange={(open) => !open && closeRename()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
            <DialogDescription>Give this board a name you will recognise later.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleRename();
            }}
          >
            <Label htmlFor="board-name">Name</Label>
            <Input
              id="board-name"
              value={renameTitle}
              placeholder="Untitled board"
              maxLength={200}
              onChange={(e) => setRenameTitle(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
              disabled={renaming}
              aria-invalid={renameError ? true : undefined}
            />
            {renameError && (
              <InlineError
                className="mt-1"
                title={DASHBOARD_COPY.renameFailedTitle}
                message={renameError}
                onRetry={handleRename}
                retrying={renaming}
              />
            )}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={closeRename} disabled={renaming}>Cancel</Button>
              <Button type="submit" disabled={renaming || !renameTitle.trim()}>
                {renaming && <Loader2 className="animate-spin" />}
                {renameError ? 'Try again' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && closeDelete()}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete board?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `"${displayTitle(deleteTarget.title)}" and everything on it will be permanently deleted. This can't be undone.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <InlineError
              title={DASHBOARD_COPY.deleteFailedTitle}
              message={deleteError}
            />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDelete}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteWhiteboard(deleteTarget.id)}
              disabled={deleting}
            >
              {deleting && <Loader2 className="animate-spin" />}
              {deleteError ? 'Retry delete' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
