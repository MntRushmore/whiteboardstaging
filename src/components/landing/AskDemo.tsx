import type { CSSProperties, ReactNode } from "react";
import katex from "katex";
import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Ellipsis,
  Eraser,
  History,
  Keyboard,
  LayoutGrid,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  Mic,
  MousePointer2,
  Pencil,
  PencilLine,
  PencilRuler,
  Smile,
  Square,
  Star,
  Undo2,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { askMathSource } from "@/components/chat/askMath";
import { ASK_VOICE_COPY } from "@/components/chat/voice/copy";
import { DOCK_COPY } from "@/components/kidmode/dockView";
import { LIVE_COPY } from "@/components/live/copy";
import { askSheets, askTimeline, boardPen, PROBLEM_SIZE, type AskSheet, type AskStream, type AskTimeline } from "@/lib/landing/askDemo";
import { AskReplay } from "./AskReplay";
import { ASK_ID } from "./bands";
import { LANDING_COPY } from "./copy";
import { HandMath } from "./HandMath";
import { InkUnderline } from "./InkMark";
import { INK_DRAW_ATTR } from "./inkStart";
import styles from "./landing.module.css";
import ask from "./ask.module.css";

/**
 * "Stuck on why? Just ask." (v3): the Ask panel docked beside a board, playing one exchange the way
 * the real panel plays it (src/components/chat): a hello from what the tutor remembers; the kid holds
 * the mic and says the question; the reply streams in word by word with its maths typeset (the
 * panel's own parse and KaTeX), read out loud; then the tutor draws fraction bars on the board with
 * the board's own `draw_model` planner. Under it, the five things Ask does.
 *
 * Every state shown is one the panel has: the held mic is AskMic's own (filled, a stop square, the
 * flat ring that grows with the voice, "Listening… Let go when you're done."), the send button is a
 * Stop while the tutor answers, "Writing on your board…" while the board draws. No invented UI.
 *
 * Server-rendered and static, like the rest of the page: the exchange is CSS animations, held until
 * the demo is in view by INK_START_SCRIPT (`data-lp-draw` on the demo, `data-lp-ink` on everything
 * that moves that is not a path). With reduced motion it is simply the finished exchange. Only Watch
 * again is a client island. The demo is one picture for a screen reader (`role="img"`, described by
 * copy.ask.demoLabel); its insides are hidden from it.
 */

/** The demo's key for INK_START_SCRIPT, and the element Watch again restarts. */
export const ASK_DEMO_ID = "lp-ask-demo";

const SHEETS = askSheets();
const TIME: AskTimeline = askTimeline(LANDING_COPY.ask.answer, Math.max(SHEETS.wide.drawing.durationMs, SHEETS.narrow.drawing.durationMs));

/** A phone's board shows the narrow screen down to just under the drawing (`.sheet`). */
const SHEET_CROP = (SHEETS.narrow.width / (SHEETS.narrow.drawingBottom + 32)).toFixed(4);

/** Marks an element that animates (not a path) so INK_START_SCRIPT holds it with the drawing. */
const INK = { "data-lp-ink": "" } as const;

const ms = (n: number) => `${Math.round(n)}ms`;
const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`;

/** CSS custom properties, typed loosely (React's CSSProperties has no `--` keys). */
function vars(v: Record<string, string | number>): CSSProperties {
  return v as CSSProperties;
}

/** A formula as the panel sets it (`renderAskMath`): an inline fraction as big as a display one. HTML only: the demo is one picture. */
function mathHtml(src: string): string {
  return katex.renderToString(askMathSource(src, false), {
    displayMode: false,
    throwOnError: true,
    strict: "ignore",
    trust: false,
    output: "html",
    maxSize: 10,
    maxExpand: 200,
  });
}

// ------------------------------------------------------------------ the board

/** The board's white screen: the tutor's problems in its hand, and the bars it draws (`askSheets`). */
function SheetInk({ sheet, kind }: { sheet: AskSheet; kind: "wide" | "narrow" }) {
  const pen = boardPen(1);
  const d = sheet.drawing;
  return (
    <div
      className={`${ask.ink} ${kind === "wide" ? ask.wideInk : ask.narrowInk}`}
      style={vars({ "--ar": (sheet.width / sheet.height).toFixed(4) })}
    >
      {sheet.problems.map((p) => (
        <HandMath
          key={p.latex}
          latex={p.latex}
          size={PROBLEM_SIZE}
          ink="tutor"
          pen={pen}
          seed={p.seed}
          className={ask.problem}
          style={{ left: pct(p.x - pen, sheet.width), top: pct(p.y - pen, sheet.height), width: pct(p.width + 2 * pen, sheet.width) }}
        />
      ))}
      <svg
        className={ask.model}
        viewBox={`0 0 ${d.width} ${d.height}`}
        style={{ left: pct(sheet.at.x, sheet.width), top: pct(sheet.at.y, sheet.height), width: pct(d.width, sheet.width) }}
      >
        {d.paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            pathLength={1}
            className={p.fill ? ask.filled : undefined}
            fill={p.fill ?? "none"}
            stroke={p.stroke}
            strokeWidth={p.width}
            style={vars({ "--at": ms(TIME.drawMs + p.atMs), "--for": ms(p.forMs), "--fill-at": ms(TIME.drawMs + p.atMs + p.forMs) })}
          />
        ))}
      </svg>
    </div>
  );
}

function DockTool({ icon: Icon, label, pressed, className }: { icon: LucideIcon; label: string; pressed?: boolean; className?: string }) {
  return (
    <span className={`${ask.tool} ${pressed ? ask.pressed : ""} ${className ?? ""}`}>
      <Icon strokeWidth={2} aria-hidden />
      {label}
    </span>
  );
}

/** The simple board round the screen: its top bar (Back, Help me, More) and its dock, Ask open. */
function Board() {
  return (
    <div className={ask.board}>
      <div className={ask.bar}>
        <span className={ask.back}>
          <ChevronLeft strokeWidth={2.25} aria-hidden />
        </span>
        <span className={ask.help}>
          <span className={ask.helpMain}>
            <Lightbulb strokeWidth={2.25} aria-hidden />
            {LIVE_COPY.ask.help}
          </span>
          <span className={ask.helpMenu}>
            <ChevronDown strokeWidth={2.5} aria-hidden />
          </span>
        </span>
        <span className={ask.more}>
          <Ellipsis strokeWidth={2.25} aria-hidden />
          {DOCK_COPY.more}
        </span>
      </div>
      <div className={ask.sheet} style={vars({ "--sheet-crop": SHEET_CROP })}>
        <SheetInk sheet={SHEETS.wide} kind="wide" />
        <SheetInk sheet={SHEETS.narrow} kind="narrow" />
      </div>
      <div className={ask.dockRow}>
        <div className={ask.dock}>
          <DockTool icon={MousePointer2} label={DOCK_COPY.select} className={ask.roomy} />
          <DockTool icon={Pencil} label={DOCK_COPY.pen} pressed />
          <DockTool icon={Eraser} label={DOCK_COPY.eraser} />
          <DockTool icon={Keyboard} label={DOCK_COPY.type} className={ask.roomy} />
          <span className={`${ask.divider} ${ask.roomy}`} />
          <DockTool icon={Undo2} label={DOCK_COPY.undo} />
          <DockTool icon={LayoutGrid} label={DOCK_COPY.more} className={ask.roomy} />
          <span className={ask.divider} />
          <span className={ask.tool}>
            <span className={ask.swatch} />
            {DOCK_COPY.colour}
          </span>
          <span className={`${ask.divider} ${ask.roomy}`} />
          <span className={`${ask.pages} ${ask.roomy}`}>
            <ChevronLeft strokeWidth={2} aria-hidden />
            1 / 1
            <ChevronRight strokeWidth={2} aria-hidden />
          </span>
          <span className={ask.askButton}>
            <MessageCircle strokeWidth={2.25} aria-hidden />
            {DOCK_COPY.ask}
          </span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the panel

/** The reply, word by word as it streams (each word held at nothing until it arrives), with its caret. */
function Reply({ stream }: { stream: AskStream }) {
  return (
    <>
      {stream.paragraphs.map((row, p) => (
        <p key={p} className={ask.reply}>
          {row.map((t, i) =>
            t.kind === "text" ? (
              t.text === "\n" ? (
                <br key={i} />
              ) : (
                <span key={i} className={ask.word} style={vars({ "--at": ms(t.atMs) })} {...INK}>
                  {t.bold ? <strong>{t.text}</strong> : t.text}
                </span>
              )
            ) : (
              <span key={i} className={`${ask.word} ${ask.formula}`} style={vars({ "--at": ms(t.atMs) })} {...INK}>
                {/* an inline fraction is set tall (`askMathSource`): its line grows to hold it, as in the panel */}
                <span className={ask.tall} dangerouslySetInnerHTML={{ __html: mathHtml(t.src) }} />
                {t.tail}
              </span>
            ),
          )}
          {p === stream.paragraphs.length - 1 && <span className={ask.caret} style={vars({ "--out": ms(TIME.streamEndMs) })} {...INK} />}
        </p>
      ))}
    </>
  );
}

/** The exchange as the panel shows it: the kid's words, then the tutor's (thinking, streaming, writing, done). */
function Thread({ className }: { className: string }) {
  const copy = LANDING_COPY.ask;
  return (
    <div className={className}>
      <div className={ask.kidRow}>
        <p className={ask.kid} style={vars({ "--at": ms(TIME.sentMs) })} {...INK}>
          {copy.question}
        </p>
      </div>
      <div className={ask.tutorMsg}>
        <div className={ask.stack}>
          <p className={`${ask.bubble} ${ask.thinking}`} style={vars({ "--in": ms(TIME.thinkingMs), "--out": ms(TIME.streamMs) })} {...INK}>
            <span className={ask.dots}>
              {[0, 160, 320].map((d) => (
                <span key={d} style={vars({ "--d": ms(d) })} {...INK} />
              ))}
            </span>
            {copy.thinking}
          </p>
          <div className={`${ask.bubble} ${ask.answer}`} style={vars({ "--at": ms(TIME.streamMs) })} {...INK}>
            <Reply stream={TIME.stream} />
          </div>
        </div>
        <div className={ask.stack}>
          <p className={ask.writing} style={vars({ "--in": ms(TIME.drawMs), "--out": ms(TIME.doneMs) })} {...INK}>
            <span className={ask.pen} {...INK}>
              <PencilLine strokeWidth={2} aria-hidden />
            </span>
            {copy.writing}
          </p>
          <span className={ask.again} style={vars({ "--at": ms(TIME.doneMs) })} {...INK}>
            <Volume2 strokeWidth={2} aria-hidden />
          </span>
        </div>
      </div>
    </div>
  );
}

function HeaderButton({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`${ask.headButton} ${className ?? ""}`}>{children}</span>;
}

function Panel() {
  const copy = LANDING_COPY.ask;
  const [moreLikeThese, weakSpots] = copy.chips;
  const listening = TIME.micUpMs - TIME.micDownMs;
  return (
    <div className={ask.panel}>
      <div className={ask.header}>
        <span className={ask.avatar}>
          <Smile strokeWidth={2.25} aria-hidden />
        </span>
        <p className={ask.panelTitle}>{copy.panelTitle}</p>
        {/* on, and reading the reply out loud while it streams */}
        <HeaderButton className={ask.speaker}>
          <span className={ask.speaking} style={vars({ "--from": ms(TIME.speakFromMs), "--to": ms(TIME.speakToMs) })}>
            <Volume2 strokeWidth={2} aria-hidden />
          </span>
        </HeaderButton>
        {/* a bottom sheet's grow button (the panel docked beside the board has none) */}
        <HeaderButton className={ask.sheetOnly}>
          <ChevronUp strokeWidth={2} aria-hidden />
        </HeaderButton>
        <HeaderButton>
          <X strokeWidth={2} aria-hidden />
        </HeaderButton>
      </div>

      <div className={ask.list}>
        <div className={ask.column}>
          {/* the finished exchange, unseen: the list keeps its final height, so nothing below moves as it plays */}
          <Thread className={ask.ghost} />
          <div className={ask.hello} style={vars({ "--out": ms(TIME.sentMs - 60) })} {...INK}>
            <p className={ask.bubble}>{copy.hello}</p>
            <div className={ask.chips}>
              {/* the panel puts the weak-spots chip first, starred */}
              <span className={`${ask.chip} ${ask.weak}`}>
                <Star aria-hidden />
                {weakSpots}
              </span>
              <span className={ask.chip}>{moreLikeThese}</span>
            </div>
          </div>
          <Thread className={ask.thread} />
        </div>
      </div>

      <div className={ask.composer}>
        <div className={ask.field}>
          <span className={ask.placeholder}>{copy.placeholder}</span>
          <span className={ask.mic}>
            <span className={`${ask.pop} ${ask.popListen}`} style={vars({ "--in": ms(TIME.micDownMs + 180), "--out": ms(TIME.micUpMs) })} {...INK}>
              {ASK_VOICE_COPY.listeningHold}
            </span>
            <span className={`${ask.pop} ${ask.popSend}`} style={vars({ "--in": ms(TIME.micUpMs + 40), "--out": ms(TIME.sentMs) })} {...INK}>
              {ASK_VOICE_COPY.sending}
            </span>
            {/* the flat ring that grows with the kid's voice (AskMic) */}
            <span className={ask.level} style={vars({ "--in": ms(TIME.micDownMs), "--dur": ms(listening) })} {...INK} />
            <span className={ask.micIdle} style={vars({ "--in": ms(TIME.sentMs), "--out": ms(TIME.doneMs) })} {...INK}>
              <Mic strokeWidth={2} aria-hidden />
            </span>
            <span className={ask.micHeld} style={vars({ "--in": ms(TIME.micDownMs), "--out": ms(TIME.micUpMs) })} {...INK}>
              <Square aria-hidden />
            </span>
            <span className={ask.micBusy} style={vars({ "--in": ms(TIME.micUpMs), "--out": ms(TIME.sentMs) })} {...INK}>
              <span className={ask.spin} {...INK}>
                <LoaderCircle strokeWidth={2} aria-hidden />
              </span>
            </span>
          </span>
          <span className={ask.send}>
            <ArrowUp strokeWidth={2.5} aria-hidden />
            {/* Stop, while the tutor thinks and streams */}
            <span className={ask.stop} style={vars({ "--in": ms(TIME.sentMs), "--out": ms(TIME.streamEndMs) })} {...INK}>
              <Square aria-hidden />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the section

const FEATURE_ICONS: readonly LucideIcon[] = [MessageCircle, PencilRuler, Mic, History, BookOpen];
/** A flat tint per idea: the panel's blue, the drawing's green, the voice's purple, memory's cream, the table's grey. */
const FEATURE_TINTS = [ask.tintBlue, ask.tintGreen, ask.tintPurple, ask.tintYellow, ask.tintTable] as const;

export function AskDemo() {
  const copy = LANDING_COPY.ask;
  const [first, second] = copy.title.split("\n");
  return (
    <section id={ASK_ID} className={`${styles.band} ${ask.band}`} aria-labelledby="lp-ask-title">
      <div className={`${styles.inner} ${styles.head}`}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h2 id="lp-ask-title" className={styles.h2}>
          <span className={styles.line}>{first}</span>
          {second && (
            <span className={styles.line}>
              <InkUnderline draw="ask-title" atMs={300} forMs={420}>
                {second}
              </InkUnderline>
            </span>
          )}
        </h2>
        <p className={styles.lede}>{copy.lede}</p>
      </div>

      <div className={ask.stage}>
        <div className={ask.demo} id={ASK_DEMO_ID} role="img" aria-label={copy.demoLabel} {...{ [INK_DRAW_ATTR]: "ask-demo" }}>
          <div className={ask.frame} aria-hidden>
            <Board />
            <Panel />
          </div>
        </div>
        <div className={ask.caption}>
          <AskReplay targetId={ASK_DEMO_ID} label={LANDING_COPY.replay.again} className={ask.replay} />
        </div>

        <ul className={ask.features}>
          {copy.features.map((f, i) => {
            const Icon = FEATURE_ICONS[i] ?? MessageCircle;
            return (
              <li key={f.title} className={`${ask.feature} ${FEATURE_TINTS[i] ?? ask.tintBlue}`}>
                <span className={ask.featureIcon}>
                  <Icon size={22} strokeWidth={2} aria-hidden />
                </span>
                <h3 className={ask.featureTitle}>{f.title}</h3>
                <p className={ask.featureBody}>{f.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
