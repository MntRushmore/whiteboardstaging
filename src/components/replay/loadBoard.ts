import { createTLStore, defaultBindingUtils, defaultShapeUtils, loadSnapshot, type SerializedSchema, type TLRecord, type TLStore } from "tldraw";
import { liveShapeUtils } from "@/shapes";
import { DOCUMENT_TYPE_NAMES } from "@/lib/replay/diff";

/** The shape utils every replay registers: the board's own (a snapshot with `math` or `graph` shapes throws without them). */
export const REPLAY_SHAPE_UTILS = [...defaultShapeUtils, ...liveShapeUtils];

/** The meta key "Hide AI shapes" keeps a hidden tutor shape's opacity under (LiveStatusPill's HIDDEN_OPACITY_KEY). */
const HIDDEN_OPACITY_KEY = "liveHiddenOpacity";

export interface LoadedBoard {
  /** the board's document records (document, pages, shapes, assets, bindings), migrated to today's schema */
  records: TLRecord[];
  schema: SerializedSchema;
  /** the screen the student was on when it was saved, when the snapshot says */
  currentPageId: string | null;
  /** why it could not be read (records is then empty) */
  error: string | null;
}

/** A stored board in whichever form it was saved (`{document:{store,schema},session}` or a bare store snapshot), with today's schema when it has none. */
function withSchema(snapshot: unknown, store: TLStore): Parameters<typeof loadSnapshot>[1] | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as { document?: { store?: unknown; schema?: unknown }; session?: unknown; store?: unknown; schema?: unknown };
  const schema = store.schema.serialize();
  if (s.document && typeof s.document === "object" && s.document.store && typeof s.document.store === "object") {
    return { document: { store: s.document.store, schema: s.document.schema ?? schema } } as Parameters<typeof loadSnapshot>[1];
  }
  if (s.store && typeof s.store === "object") return { store: s.store, schema: s.schema ?? schema } as Parameters<typeof loadSnapshot>[1];
  return null;
}

function currentPageOf(snapshot: unknown): string | null {
  const session = (snapshot as { session?: { currentPageId?: unknown } } | null)?.session;
  return typeof session?.currentPageId === "string" ? session.currentPageId : null;
}

/** A tutor shape the student hid with "Hide AI shapes", shown again (the admin sees everything). */
function unhide(r: TLRecord): TLRecord {
  if (r.typeName !== "shape") return r;
  const remembered = (r.meta as Record<string, unknown>)[HIDDEN_OPACITY_KEY];
  if (r.opacity !== 0 || typeof remembered !== "number") return r;
  return { ...r, opacity: remembered > 0 && remembered <= 1 ? remembered : 1 };
}

/**
 * A stored board's records, migrated: restored on a throwaway store with the board's shape utils
 * (the same proof the board page runs before mounting), then read back. Never throws.
 */
export function loadBoard(snapshot: unknown, { revealHidden = false }: { revealHidden?: boolean } = {}): LoadedBoard {
  const probe = createTLStore({ shapeUtils: REPLAY_SHAPE_UTILS, bindingUtils: defaultBindingUtils });
  try {
    const snap = withSchema(snapshot, probe);
    if (!snap) return { records: [], schema: probe.schema.serialize(), currentPageId: null, error: "This board has nothing saved yet." };
    loadSnapshot(probe, snap);
    let records = probe.allRecords().filter((r) => DOCUMENT_TYPE_NAMES.has(r.typeName));
    if (revealHidden) records = records.map(unhide);
    return { records, schema: probe.schema.serialize(), currentPageId: currentPageOf(snapshot), error: null };
  } catch (e) {
    return { records: [], schema: probe.schema.serialize(), currentPageId: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    probe.dispose();
  }
}

/** The board open in an editor right now (the student's own replay): its records as they are, no copy, no network. */
export function boardFromStore(store: TLStore, currentPageId: string | null): LoadedBoard {
  return {
    records: store.allRecords().filter((r) => DOCUMENT_TYPE_NAMES.has(r.typeName)),
    schema: store.schema.serialize(),
    currentPageId,
    error: null,
  };
}
