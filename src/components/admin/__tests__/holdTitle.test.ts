import { describe, expect, it } from "vitest";
import { holdTitle, type TitleObserver } from "../consoleHooks";

/** A head whose title anyone can write, and observers it tells when that happens. */
function fakeDocument(initial: string) {
  const observers = new Set<{ callback: () => void; on: boolean }>();
  const head = {} as Node;
  const doc = {
    head,
    _title: initial,
    get title() {
      return this._title;
    },
    set title(v: string) {
      this._title = v;
      for (const o of [...observers]) if (o.on) o.callback();
    },
  };
  const Observer: TitleObserver = class {
    private entry: { callback: () => void; on: boolean };
    constructor(callback: () => void) {
      this.entry = { callback, on: false };
    }
    observe(target: Node) {
      expect(target).toBe(head);
      this.entry.on = true;
      observers.add(this.entry);
    }
    disconnect() {
      this.entry.on = false;
      observers.delete(this.entry);
    }
  };
  return { doc, Observer, observers };
}

describe("holdTitle", () => {
  it("sets the title, and sets it again when the route's metadata writes over it", () => {
    const { doc, Observer } = fakeDocument("");
    const stop = holdTitle(doc, "Not found · Agathon", Observer);
    expect(doc.title).toBe("Not found · Agathon");
    doc.title = "Agathon"; // Next's metadata, landing after the page's effect
    expect(doc.title).toBe("Not found · Agathon");
    stop();
  });

  it("lets go once stopped: the next page's title stays", () => {
    const { doc, Observer, observers } = fakeDocument("Agathon");
    const stop = holdTitle(doc, "Users · Admin · Agathon", Observer);
    stop();
    expect(observers.size).toBe(0);
    doc.title = "Agathon";
    expect(doc.title).toBe("Agathon");
  });
});
