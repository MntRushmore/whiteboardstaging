import { ASK_BOARD_CLOSE, ASK_BOARD_OPEN, ASK_LIMITS } from "./contracts";

/**
 * Splits the model's streamed answer into the reply the panel shows as it comes and the board
 * block (`<board>{"actions":[…]}</board>`) the route checks before anything is written.
 *
 * `push(chunk)` answers the reply text that is now safe to show: text that could still be the
 * start of `<board>` is held back until the next chunk says what it is. Inside a block nothing is
 * shown. Text after a block is reply again (a model that adds a last sentence). Only the first
 * block counts; a second one's text is dropped. `end()` answers what was held back, the whole
 * reply, and the first block's JSON (fences and stray words around the object stripped), or null
 * when there was none.
 */
export class AskStreamSplitter {
  private held = "";
  private reply = "";
  private block = "";
  private inBlock = false;
  private blocks = 0;
  /** the block grew past ASK_LIMITS.boardBlock: the rest of it was ignored */
  overflow = false;

  push(chunk: string): string {
    let text = this.held + chunk;
    this.held = "";
    let shown = "";
    while (text.length > 0) {
      const tag = this.inBlock ? ASK_BOARD_CLOSE : ASK_BOARD_OPEN;
      const at = text.indexOf(tag);
      if (at === -1) {
        // keep a possible start of the tag for the next chunk
        const keep = partialSuffix(text, tag);
        const done = text.slice(0, text.length - keep);
        if (this.inBlock) this.addBlock(done);
        else shown += done;
        this.held = text.slice(text.length - keep);
        break;
      }
      if (this.inBlock) this.addBlock(text.slice(0, at));
      else shown += text.slice(0, at);
      text = text.slice(at + tag.length);
      if (!this.inBlock) this.blocks++;
      this.inBlock = !this.inBlock;
    }
    this.reply += shown;
    return shown;
  }

  /** The stream ended: what was held back, the whole reply, and the first block's JSON. */
  end(): { tail: string; reply: string; board: string | null } {
    let tail = "";
    // an unclosed block (the model ran out of tokens): what it held is still the block
    if (this.inBlock) this.addBlock(this.held);
    else tail = this.held;
    this.held = "";
    this.reply += tail;
    return { tail, reply: this.reply, board: this.blocks > 0 ? jsonObjectIn(this.block) : null };
  }

  private addBlock(text: string): void {
    if (this.blocks > 1 || !text) return;
    const room = ASK_LIMITS.boardBlock - this.block.length;
    if (text.length > room) {
      this.overflow = true;
      this.block += text.slice(0, Math.max(0, room));
      return;
    }
    this.block += text;
  }
}

/** How many characters at the end of `text` could be the start of `tag` (0 when none). */
export function partialSuffix(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (tag.startsWith(text.slice(text.length - n))) return n;
  }
  return 0;
}

/** The first `{…}` object in a block's text: ```json fences and words around it are dropped. Null when there is none. */
export function jsonObjectIn(text: string): string | null {
  const s = text.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}
