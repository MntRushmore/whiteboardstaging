"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Plus, RefreshCw, Search } from 'lucide-react';
import { toast } from "sonner";
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
import { AppHeader, APP_CONTENT_CLASS } from '@/components/app/AppHeader';
import { BoardGroups, BoardSkeletons, type BoardActions, type BoardView } from '@/components/boards/BoardList';
import { asDeleteBoardClient, deleteBoardWithAssets } from '@/lib/assets/deleteBoard';
import { DEFAULT_BOARD_TITLE, isDefaultBoardTitle } from '@/lib/boards/boardTitle';
import { settleExitWrites } from '@/lib/boards/exitWrites';
import { EmptyBoards } from '@/components/boards/EmptyBoards';
import { useWelcome } from '@/components/onboarding/useWelcome';
import { homeView } from '@/lib/onboarding/state';
import { Alert } from '@/registry/components/alert/alert';
import { Button } from '@/registry/components/button/button';
import { Dialog, DialogContent } from '@/registry/components/dialog/dialog';
import { EmptyState } from '@/registry/components/empty-state/empty-state';
import { Input } from '@/registry/components/input/input';
import { SearchField } from '@/registry/components/search-field/search-field';
import SegmentedControl from '@/registry/components/segmented-control/segmented-control';
import { Select } from '@/registry/components/select/select';
import styles from '@/components/boards/boards.module.css';

/** How long the first list read waits for a board that is still saving as it closes. */
const EXIT_WRITE_WAIT_MS = 3000;

// First-run welcome: loaded only for a new student with no boards (see useWelcome).
const Welcome = lazy(() => import('@/components/onboarding/Welcome'));

const SORT_OPTIONS = BOARD_SORTS.map((s) => ({ value: s.value, label: s.label }));
const VIEW_OPTIONS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

/**
 * An error about one action, next to the thing you clicked (not only as a toast), with Retry
 * when the action can simply run again.
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
    <Alert tone="danger" title={title} data-state="error" className={className}>
      {message}
      {onRetry && (
        <span className={styles.alertAction}>
          <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
            <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
            {DASHBOARD_COPY.retry}
          </Button>
        </span>
      )}
    </Alert>
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

  // Delete confirmation state. The name is kept apart from the target so the dialog's copy
  // stays put while it animates out.
  const [deleteTarget, setDeleteTarget] = useState<BoardListItem | null>(null);
  const [deleteName, setDeleteName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Where each dialog puts focus when it opens (Arc's dialog would otherwise focus its close
  // button, which comes first): the name to retype, and Cancel before a permanent delete.
  const renameInputRef = useRef<HTMLInputElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

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
      // Dialog stays open with the message; Save becomes "Try again".
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
      setDeleteName(displayTitle(board.title));
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

  if (!user && authError) {
    return (
      <div className={`${styles.page} ${styles.authError}`}>
        <div className={styles.authErrorInner}>
          <AuthErrorBanner />
        </div>
      </div>
    );
  }

  if (dashboardState === 'welcome' && user) {
    return (
      <div className={styles.page}>
        <AppHeader />
        <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
          <div className={styles.banners}>
            <AuthErrorBanner />
          </div>
          <Suspense fallback={<div aria-hidden className={`${styles.welcomeFallback} ${styles.pulse}`} />}>
            <Welcome userId={user.id} onSkip={welcome.skip} />
          </Suspense>
        </main>
      </div>
    );
  }

  const newBoardButton = (
    <Button onClick={createWhiteboard} loading={creating} disabled={!user}>
      <Plus size={16} strokeWidth={2} aria-hidden />
      New Board
    </Button>
  );

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
        <div className={styles.banners}>
          <AuthErrorBanner />
        </div>

        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.title}>My whiteboards</h1>
            {dashboardState === 'list' && <p className={styles.count}>{boardCountLabel(whiteboards.length)}</p>}
            {dashboardState === 'loading' && <div aria-hidden className={`${styles.countPlaceholder} ${styles.pulse}`} />}
          </div>
          {/* The empty state carries its own New Board: one call to action, not two. */}
          {dashboardState !== 'empty' && newBoardButton}
        </div>

        {createError && (
          <InlineError
            className={styles.inlineError}
            title={DASHBOARD_COPY.createFailedTitle}
            message={createError}
            onRetry={createWhiteboard}
            retrying={creating}
          />
        )}

        {/* Shown while loading too, so the grid does not jump down when the list arrives. */}
        {(dashboardState === 'list' || dashboardState === 'loading') && (
          <div className={styles.toolbar}>
            <div className={styles.search}>
              <SearchField
                label="Search boards"
                placeholder="Search boards"
                value={searchQuery}
                onValueChange={setSearchQuery}
                onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
              />
            </div>
            <div className={styles.controls}>
              <div className={styles.sort}>
                <Select
                  label="Sort by"
                  options={SORT_OPTIONS}
                  value={sort}
                  onValueChange={(v) => setSort(v as BoardSort)}
                />
              </div>
              <SegmentedControl
                label="Layout"
                options={VIEW_OPTIONS}
                value={viewMode}
                onValueChange={(v) => setViewMode(v as BoardView)}
              />
            </div>
          </div>
        )}

        <div className={styles.results}>
          {dashboardState === 'loading' ? (
            <BoardSkeletons />
          ) : dashboardState === 'error' ? (
            <div role="alert" data-state="error" className={styles.panel}>
              <EmptyState
                icon={<AlertTriangle size={22} strokeWidth={1.5} />}
                title={DASHBOARD_COPY.loadFailedTitle}
                description={fetchError ?? DASHBOARD_COPY.loadFallback}
                action={
                  <Button variant="secondary" onClick={fetchWhiteboards}>
                    <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
                    {DASHBOARD_COPY.retry}
                  </Button>
                }
              />
            </div>
          ) : dashboardState === 'empty' ? (
            <EmptyBoards action={newBoardButton} />
          ) : groups.length === 0 ? (
            <div className={styles.panel}>
              <EmptyState
                icon={<Search size={22} strokeWidth={1.5} />}
                title={DASHBOARD_COPY.noMatchesTitle}
                description={DASHBOARD_COPY.noMatchesHint}
                action={
                  <Button variant="secondary" onClick={() => setSearchQuery('')}>
                    Clear search
                  </Button>
                }
              />
            </div>
          ) : (
            <BoardGroups groups={groups} view={viewMode} now={now} actions={actions} />
          )}
        </div>
      </main>

      <Dialog open={!!renameId} onOpenChange={(open) => !open && closeRename()}>
        <DialogContent
          title="Rename board"
          description="Give this board a name you will recognise later."
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            renameInputRef.current?.focus();
          }}
        >
          <form
            className={styles.dialogForm}
            onSubmit={(e) => {
              e.preventDefault();
              void handleRename();
            }}
          >
            <Input
              ref={renameInputRef}
              id="board-name"
              label="Name"
              value={renameTitle}
              placeholder="Untitled board"
              maxLength={200}
              onChange={(e) => setRenameTitle(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              readOnly={renaming}
              aria-invalid={renameError ? true : undefined}
            />
            {renameError && (
              <InlineError title={DASHBOARD_COPY.renameFailedTitle} message={renameError} />
            )}
            <div className={styles.dialogActions}>
              <Button type="button" variant="secondary" onClick={closeRename} disabled={renaming}>
                Cancel
              </Button>
              <Button type="submit" loading={renaming} disabled={!renameTitle.trim()}>
                {renameError ? 'Try again' : 'Save'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && closeDelete()}>
        <DialogContent
          title="Delete board?"
          description={`"${deleteName}" and everything on it will be permanently deleted. This can't be undone.`}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            deleteCancelRef.current?.focus();
          }}
        >
          <div className={styles.dialogForm}>
            {deleteError && (
              <InlineError title={DASHBOARD_COPY.deleteFailedTitle} message={deleteError} />
            )}
            <div className={styles.dialogActions}>
              <Button ref={deleteCancelRef} variant="secondary" onClick={closeDelete} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleting}
                onClick={() => deleteTarget && deleteWhiteboard(deleteTarget.id)}
              >
                {deleteError ? 'Retry delete' : 'Delete'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
