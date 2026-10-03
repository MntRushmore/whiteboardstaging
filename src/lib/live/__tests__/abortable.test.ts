import { describe, expect, it } from "vitest";
import { abortable } from "../abortable";

/** A wait the abort cannot reach on its own (authedFetch's session read) still ends with it. */
describe("abortable", () => {
  it("passes the promise's value and error through", async () => {
    const ctrl = new AbortController();
    await expect(abortable(Promise.resolve(3), ctrl.signal)).resolves.toBe(3);
    await expect(abortable(Promise.reject(new Error("no")), ctrl.signal)).rejects.toThrow("no");
  });

  it("rejects when the signal aborts, with the abort's own reason when it is an error", async () => {
    const never = new Promise<never>(() => undefined);
    const plain = new AbortController();
    const p = abortable(never, plain.signal);
    plain.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });

    const timed = new AbortController();
    const q = abortable(never, timed.signal);
    const reason = new Error("took too long");
    timed.abort(reason);
    await expect(q).rejects.toBe(reason);
  });

  it("rejects at once on a signal already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(abortable(new Promise<never>(() => undefined), ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("without a signal it is the promise itself", () => {
    const p = Promise.resolve(1);
    expect(abortable(p, undefined)).toBe(p);
  });
});
