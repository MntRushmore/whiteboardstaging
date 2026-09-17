"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthErrorBanner, useAuth } from '@/components/AuthProvider';
import { DASHBOARD_COPY, dashboardStateFor } from '@/app/dashboardState';
import { describeError } from '@/lib/errorMessage';
import { CreditsBanner } from '@/components/CreditsBanner';
import { PlanBadge } from '@/components/account/PlanBadge';
import { FeatureLabsPanel } from '@/components/FeatureLabsPanel';
import { asDeleteBoardClient, deleteBoardWithAssets } from '@/lib/assets/deleteBoard';
import {
  Plus,
  Trash2,
  Clock,
  FileIcon,
  Search,
  LayoutGrid,
  List as ListIcon,
  Edit2,
  MoreHorizontal,
  LogOut,
  Loader2,
  Sparkles,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from "sonner";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
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

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Whiteboard = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  preview?: string;
};

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
        "flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800",
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
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", retrying && "animate-spin")} />
          {DASHBOARD_COPY.retry}
        </Button>
      )}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const [whiteboards, setWhiteboards] = useState<Whiteboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  // Rename state
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Whiteboard | null>(null);
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

  useEffect(() => {
    if (user) {
      fetchWhiteboards();
    }
  }, [user]);

  async function fetchWhiteboards() {
    setLoading(true);
    setFetchError(null);
    try {
      const { data, error } = await supabase
        .from('whiteboards')
        .select('id, title, created_at, updated_at, preview')
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
  }

  async function createWhiteboard() {
    if (creating || !user) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { data, error } = await supabase
        .from('whiteboards')
        .insert([
          { title: 'Untitled Whiteboard', data: {}, user_id: user.id }
        ])
        .select()
        .single();

      if (error) throw error;
      toast.success('Whiteboard created successfully');
      router.push(`/board/${data.id}`);
    } catch (error) {
      console.error('Error creating whiteboard:', error);
      // Button stays enabled; the error sits right under it with Retry.
      setCreateError(describeError(error, DASHBOARD_COPY.createFallback));
      setCreating(false);
    }
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Couldn't sign you out. Try again in a moment.");
      return;
    }
    router.replace('/login');
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
        toast.warning('Whiteboard deleted, but some images could not be removed');
      } else {
        toast.success('Whiteboard deleted');
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
    if (!renameId || renaming) return;
    setRenaming(true);
    setRenameError(null);
    try {
      const { error } = await supabase
        .from('whiteboards')
        .update({ title: renameTitle })
        .eq('id', renameId);

      if (error) throw error;

      setWhiteboards(whiteboards.map(w => 
        w.id === renameId ? { ...w, title: renameTitle } : w
      ));
      toast.success('Whiteboard renamed');
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

  const dashboardState = dashboardStateFor({
    loading,
    error: fetchError,
    boards: whiteboards,
  });

  const filteredWhiteboards = whiteboards.filter(board =>
    board.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!user && authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md">
          <AuthErrorBanner />
        </div>
      </div>
    );
  }

  if (authLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="absolute top-0 right-0 p-4 flex items-center gap-3 z-10">
        <Link href="/account" className="text-sm text-muted-foreground hidden sm:inline hover:text-foreground hover:underline">
          {user.email}
        </Link>
        <PlanBadge />
        <FeatureLabsPanel />
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          <LogOut className="w-4 h-4 mr-1.5" />
          Sign out
        </Button>
      </header>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-6">
        <AuthErrorBanner className="mb-4" />
        <CreditsBanner className="mb-4" />
        {/* Header Section */}
        <div className="space-y-4 mb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Agathon Classroom
            </p>
            <h1 className="text-4xl font-bold tracking-tight">My Whiteboards</h1>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-2 w-full">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                type="text"
                placeholder="Search boards..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button 
              onClick={createWhiteboard}
              disabled={creating}
              className="h-10 w-full sm:w-auto"
            >
              {creating ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              New Board
            </Button>
            
            <div className="flex items-center gap-2 bg-card p-1 rounded-lg border shadow-sm">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="icon-lg"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="icon-lg"
                onClick={() => setViewMode('list')}
              >
                <ListIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {createError && (
            <InlineError
              title={DASHBOARD_COPY.createFailedTitle}
              message={createError}
              onRetry={createWhiteboard}
              retrying={creating}
            />
          )}
        </div>

        {dashboardState === 'loading' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-64 bg-card rounded-xl border shadow-sm animate-pulse">
                <div className="h-40 bg-muted rounded-t-xl" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : dashboardState === 'error' ? (
          <div
            role="alert"
            data-state="error"
            className="flex flex-col items-center justify-center text-center bg-card border border-red-200 rounded-xl shadow-sm px-6 py-14"
          >
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold">{DASHBOARD_COPY.loadFailedTitle}</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{fetchError}</p>
            <Button onClick={fetchWhiteboards} className="mt-6" variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              {DASHBOARD_COPY.retry}
            </Button>
          </div>
        ) : dashboardState === 'empty' ? (
          <div className="flex flex-col items-center justify-center text-center bg-card border rounded-xl shadow-sm px-6 py-14">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">Welcome to Agathon Classroom</h3>
            <p className="text-muted-foreground mt-2 max-w-md">
              Create a board, write a math problem, and the tutor helps in real time.
            </p>
            <Button
              onClick={createWhiteboard}
              disabled={creating}
              className="mt-6"
            >
              {creating ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Create your first board
            </Button>
          </div>
        ) : (
          <div className={cn(
            viewMode === 'grid'
              ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4"
              : "flex flex-col gap-3"
          )}>
            {/* Create New Card (Grid Only) */}
            {viewMode === 'grid' && (
              <div 
                onClick={createWhiteboard}
                className="flex flex-col items-center justify-center h-64 bg-card border-2 border-dashed rounded-xl cursor-pointer hover:bg-accent transition-colors"
              >
                <div className="p-4 rounded-full bg-muted">
                  <Plus className="w-8 h-8 text-muted-foreground" />
                </div>
                <span className="mt-4 font-medium text-muted-foreground">
                  Create New Board
                </span>
              </div>
            )}

            {filteredWhiteboards.map((board) => (
              <div 
                key={board.id}
                className={cn(
                  "group relative bg-card border hover:border-ring/50 transition-all overflow-hidden",
                  viewMode === 'grid' 
                    ? "flex flex-col h-64 rounded-xl shadow-sm hover:shadow-md" 
                    : "flex items-center p-4 rounded-lg hover:bg-accent/50"
                )}
              >
                <div 
                    className={cn("flex-1 cursor-pointer", viewMode === 'list' && "flex items-center gap-4")}
                    onClick={() => router.push(`/board/${board.id}`)}
                >
                    {viewMode === 'grid' ? (
                    <div className="flex-1 h-40 bg-muted flex items-center justify-center relative overflow-hidden border-b">
                        {board.preview ? (
                            <img 
                                src={board.preview} 
                                alt={board.title}
                                className="w-full h-full object-cover" 
                            />
                        ) : (
                            <>
                                <div className="absolute inset-0 bg-grid-black/[0.02] dark:bg-grid-white/[0.02]" />
                                <FileIcon className="w-12 h-12 text-muted-foreground/50 group-hover:scale-110 transition-transform duration-300" />
                            </>
                        )}
                    </div>
                    ) : (
                    <div className="p-2 bg-muted rounded-lg">
                        <FileIcon className="w-6 h-6 text-muted-foreground" />
                    </div>
                    )}

                    <div className={cn("min-w-0", viewMode === 'grid' && "p-4")}>
                        <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                            {board.title}
                        </h3>
                        <div className="flex items-center mt-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3 mr-1" />
                            {new Date(board.updated_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                            })}
                        </div>
                    </div>
                </div>

                <div className={cn(
                    "absolute", 
                    viewMode === 'grid' ? "top-2 right-2" : "right-4"
                )}>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 focus:opacity-100 bg-card/80 backdrop-blur-sm"
                            >
                                <MoreHorizontal className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => {
                                setRenameId(board.id);
                                setRenameTitle(board.title);
                            }}>
                                <Edit2 className="w-4 h-4 mr-2" />
                                Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteTarget(board)}
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
              </div>
            ))}

            {filteredWhiteboards.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                  <Search className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium">No boards found</h3>
                <p className="text-muted-foreground mt-1">Try searching for something else or create a new board.</p>
              </div>
            )}
          </div>
        )}
      </main>

      <Dialog open={!!renameId} onOpenChange={(open) => !open && closeRename()}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Rename Board</DialogTitle>
                <DialogDescription>
                    Enter a new name for your whiteboard.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4">
                <Label htmlFor="name" className="mb-2 block">Name</Label>
                <Input 
                    id="name"
                    value={renameTitle}
                    onChange={(e) => setRenameTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                    autoFocus
                    disabled={renaming}
                    aria-invalid={renameError ? true : undefined}
                />
                {renameError && (
                  <InlineError
                    className="mt-3"
                    title={DASHBOARD_COPY.renameFailedTitle}
                    message={renameError}
                    onRetry={handleRename}
                    retrying={renaming}
                  />
                )}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={closeRename} disabled={renaming}>Cancel</Button>
                <Button onClick={handleRename} disabled={renaming}>
                  {renaming && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {renameError ? 'Try again' : 'Save Changes'}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && closeDelete()}
      >
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Delete board?</DialogTitle>
                <DialogDescription>
                    {deleteTarget
                      ? `"${deleteTarget.title}" and everything on it will be permanently deleted. This can't be undone.`
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
                  {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {deleteError ? 'Retry delete' : 'Delete'}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
