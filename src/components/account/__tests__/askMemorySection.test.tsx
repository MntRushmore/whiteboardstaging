import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ASK_MEMORY_COPY, memoryUpdatedLabel } from "@/lib/askMemory/copy";
import type { AskMemoryState } from "@/lib/askMemory/useAskMemory";

/**
 * "What Ask remembers" on /account (AskMemorySection) and its button on each kid of the Family page
 * (KidCard): the notes as a list with Clear, a friendly empty state, a failed read with Try again.
 */

const state = vi.hoisted(() => ({ value: null as unknown as AskMemoryState }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {}, from: () => ({}) } }));
vi.mock("@/lib/askMemory/useAskMemory", () => ({ useAskMemory: () => state.value }));

const { AskMemorySection } = await import("../AskMemorySection");
const { KidCard } = await import("@/components/family/KidCard");

const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const base: AskMemoryState = { memory: null, loading: false, error: null, clearing: false, reload: () => undefined, clear: async () => true, clearError: null };

describe("AskMemorySection", () => {
  it("lists the notes, when they were last updated, and offers Clear", () => {
    state.value = { ...base, memory: { notes: ["Likes shorter hints", "Gets stuck on borrowing across a zero"], updatedAt: "2026-10-09T15:00:00Z" } };
    const out = html(<AskMemorySection />);
    expect(out).toContain(ASK_MEMORY_COPY.title);
    expect(out).toContain(ASK_MEMORY_COPY.hint);
    expect(out).toContain("Likes shorter hints");
    expect(out).toContain("Gets stuck on borrowing across a zero");
    expect(out).toContain(memoryUpdatedLabel("2026-10-09T15:00:00Z")!);
    expect(out).toContain(`aria-label="${ASK_MEMORY_COPY.clearLabel}"`);
  });

  it("nothing yet: says so, and offers nothing to clear", () => {
    state.value = { ...base, memory: { notes: [], updatedAt: null } };
    const out = html(<AskMemorySection />);
    expect(out).toContain(ASK_MEMORY_COPY.empty);
    expect(out).not.toContain(ASK_MEMORY_COPY.clearLabel);
  });

  it("a failed read: the error with Try again", () => {
    state.value = { ...base, error: "The server is down." };
    const out = html(<AskMemorySection />);
    expect(out).toContain(ASK_MEMORY_COPY.loadFailedTitle);
    expect(out).toContain("The server is down.");
    expect(out).toContain('role="alert"');
  });
});

describe("KidCard", () => {
  it("has a button for what Ask remembers about the kid", () => {
    const kid = { userId: "k1", displayName: "Maya", avatar: null, grade: 3, isParent: false, stats: null };
    const noop = () => undefined;
    const out = html(<KidCard kid={kid as never} busy={false} locked={false} onSwitch={noop} onWeek={noop} onMemory={noop} onEdit={noop} onRemove={noop} />);
    expect(out).toContain('data-testid="kid-ask-memory"');
    expect(out).toContain(`aria-label="${ASK_MEMORY_COPY.kidButton("Maya")}"`);
  });
});
