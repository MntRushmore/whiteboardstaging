import { describe, expect, it } from "vitest";
import { BOARD_LOAD_COPY, loadStateFor } from "@/components/BoardLoadError";

/**
 * The board route mounts <Tldraw> only for `ready`; every other outcome renders the
 * error screen so an empty editor can never autosave over a board we failed to read.
 */
describe("loadStateFor", () => {
  it("is ready when the select returned a row", () => {
    expect(loadStateFor({ error: null, row: { data: {}, version: 3 } })).toEqual({ kind: "ready", message: "" });
  });

  it("treats PostgREST's zero-rows error as not-found (deleted or hidden by RLS)", () => {
    const state = loadStateFor({
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: "The result contains 0 rows" },
      row: null,
    });
    expect(state).toEqual({ kind: "not-found", message: BOARD_LOAD_COPY.notFoundTitle });
  });

  it("also reads '0 rows' from details when the code is missing", () => {
    expect(loadStateFor({ error: { details: "The result contains 0 rows" } }).kind).toBe("not-found");
  });

  it("is not-found when there is no error and no row", () => {
    expect(loadStateFor({ error: null, row: null }).kind).toBe("not-found");
    expect(loadStateFor({}).kind).toBe("not-found");
  });

  it("is an error (with the underlying detail) for any other failure", () => {
    const state = loadStateFor({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
    expect(state).toEqual({
      kind: "error",
      message: BOARD_LOAD_COPY.errorTitle,
      detail: "canceling statement due to statement timeout",
    });
  });

  it("maps a transport failure (thrown Error mapped to { message }) to error", () => {
    expect(loadStateFor({ error: { message: "TypeError: Failed to fetch" } })).toMatchObject({
      kind: "error",
      message: BOARD_LOAD_COPY.errorTitle,
    });
  });

  it("refuses a row whose snapshot did not restore, even though the row exists", () => {
    const state = loadStateFor({ row: { data: { store: {} } }, restoreError: new Error("unknown record type") });
    expect(state).toEqual({ kind: "error", message: BOARD_LOAD_COPY.restoreTitle, detail: "unknown record type" });
  });

  it("a restore failure wins over a found row and over a select error", () => {
    expect(loadStateFor({ error: { code: "PGRST116" }, restoreError: "bad" })).toMatchObject({
      kind: "error",
      message: BOARD_LOAD_COPY.restoreTitle,
      detail: "bad",
    });
  });

  it("keeps the copy calm: second person, no exclamation marks, never 'wrong'", () => {
    for (const text of Object.values(BOARD_LOAD_COPY)) {
      expect(text).not.toMatch(/!/);
      expect(text).not.toMatch(/\bwrong\b/i);
    }
  });
});
