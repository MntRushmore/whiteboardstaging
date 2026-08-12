export type LocalWhiteboard = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  preview?: string;
};

const INDEX_KEY = "agathon.localWhiteboards.v1";
const boardKey = (id: string) => `agathon.localWhiteboard.${id}.v1`;

function readIndex(): LocalWhiteboard[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeIndex(boards: LocalWhiteboard[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(boards));
}

export function listLocalWhiteboards() {
  return readIndex().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function createLocalWhiteboard(): LocalWhiteboard {
  const now = new Date().toISOString();
  const board = {
    id: crypto.randomUUID(),
    title: "Untitled Whiteboard",
    created_at: now,
    updated_at: now,
  };
  writeIndex([board, ...readIndex()]);
  return board;
}

export function renameLocalWhiteboard(id: string, title: string) {
  writeIndex(
    readIndex().map((board) =>
      board.id === id
        ? { ...board, title, updated_at: new Date().toISOString() }
        : board,
    ),
  );
}

export function deleteLocalWhiteboard(id: string) {
  writeIndex(readIndex().filter((board) => board.id !== id));
  localStorage.removeItem(boardKey(id));
}

export function readLocalWhiteboardSnapshot(id: string): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(boardKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLocalWhiteboardSnapshot(
  id: string,
  snapshot: unknown,
  preview?: string | null,
) {
  localStorage.setItem(boardKey(id), JSON.stringify(snapshot));
  const now = new Date().toISOString();
  writeIndex(
    readIndex().map((board) =>
      board.id === id
        ? { ...board, updated_at: now, ...(preview ? { preview } : {}) }
        : board,
    ),
  );
}
