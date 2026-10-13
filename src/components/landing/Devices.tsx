import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import {
  ChevronDown,
  ChevronLeft,
  Ellipsis,
  Eraser,
  FilePlus2,
  LayoutGrid,
  Lightbulb,
  MessageCircle,
  MousePointer2,
  Pencil,
  Star,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { DOCK_COPY } from "@/components/kidmode/dockView";
import { DAILY_GOAL } from "@/lib/daily/contracts";
import { DAILY_BOARD_COPY } from "@/lib/daily/copy";
import { handInk } from "@/lib/landing/handInk";
import { inkTimeline, MOUSE_PACE, mouseDemo } from "@/lib/landing/devices";
import { PHONE_SCENE, TABLET_SCENE, type InkPictureScene } from "@/lib/landing/devicesInk";
import { LANDING_COPY } from "./copy";
import { HandMath, handMathMs } from "./HandMath";
import { InkCheck } from "./InkMark";
import { INK_DRAW_ATTR } from "./inkStart";
import { Lines } from "./Lines";
import landing from "./landing.module.css";
import styles from "./devices.module.css";

/**
 * "Pencil, finger or mouse.": three ways in, each a real moment of the product on its device.
 *
 *  - Tablet: a 6th grader's Today board on an iPad, her lines written back over the real screenshot
 *    with the pen, and the tutor's check mark on each (`devicesInk.ts`, captured from the app).
 *  - Laptop: the mouse. The board (drawn here, faithful to the simple board at 800 × 520) has three
 *    problems in the tutor's blue; `3x=15` is written under the first in the kid's pen, the pointer
 *    travelling with it, and the tutor checks it. (It showed Type it, the typing bar, until that was
 *    removed on 2026-10-13.)
 *  - Phone: a 4th grader's Today board on a phone, two answers written back over it, each checked.
 *
 * Server-rendered and static; the moments are CSS animations, each held until its picture is in
 * view (INK_START_SCRIPT: one `data-lp-draw` key per picture, on the picture and every drawing in it,
 * and `data-lp-ink` on everything else that moves). With reduced motion each is simply finished.
 * Every picture is one labelled image to a screen reader; nothing inside it is read.
 */

const KEYS = { tablet: "devices-tablet", laptop: "devices-laptop", phone: "devices-phone" } as const;

const drawKey = (key: string) => ({ [INK_DRAW_ATTR]: key });
/** marks a moving element (not a path) for INK_START_SCRIPT to hold */
const MOVES = { "data-lp-ink": "" } as const;

const ms = (n: number) => `${Math.round(n)}ms`;
const u = (n: number) => `calc(var(--u) * ${Math.round(n * 100) / 100})`;

type Copy = typeof LANDING_COPY.devices;
type Item = Copy["items"][number];

// ---- The tablet and the phone: a real board, its ink drawn back over it -------------------------

/** The kids' strokes and the tutor's checks over a screenshot, in its own px, drawn in order. */
function InkOver({ scene, startMs }: { scene: InkPictureScene; startMs: number }) {
  const { lines } = inkTimeline(scene, undefined, startMs);
  return (
    <svg className={styles.ink} viewBox={`0 0 ${scene.width} ${scene.height}`} aria-hidden>
      {lines.map((line, i) => (
        <g key={i}>
          {line.kid.map((s, k) => (
            <path key={k} className={styles.kid} d={s.d} pathLength={1} strokeWidth={line.pen} style={{ "--at": ms(s.atMs), "--for": ms(s.forMs) } as CSSProperties} />
          ))}
          <path className={styles.tutor} d={line.check.d} pathLength={1} strokeWidth={scene.tutorPen} style={{ "--at": ms(line.check.atMs), "--for": ms(line.check.forMs) } as CSSProperties} />
        </g>
      ))}
    </svg>
  );
}

function TabletPicture({ alt }: { alt: string }) {
  return (
    <div className={styles.tabletPicture} role="img" aria-label={alt} {...drawKey(KEYS.tablet)}>
      <div className={styles.tablet} aria-hidden>
        <span className={styles.tabletCamera} />
        <div className={styles.tabletScreen}>
          <Image src={TABLET_SCENE.image} alt={alt} fill sizes="(max-width: 639px) 70vw, (max-width: 1099px) 40vw, 300px" className={styles.shot} />
          <InkOver scene={TABLET_SCENE} startMs={350} />
        </div>
        {/* Apple Pencil, held by its magnet on the long side */}
        <span className={styles.pencil} />
      </div>
    </div>
  );
}

function PhonePicture({ alt }: { alt: string }) {
  return (
    <div className={styles.phonePicture} role="img" aria-label={alt} {...drawKey(KEYS.phone)}>
      <div className={styles.phone} aria-hidden>
        <div className={styles.phoneScreen}>
          <span className={styles.statusBar}>
            <span className={styles.island} />
          </span>
          <div className={styles.phoneBoard}>
            <Image src={PHONE_SCENE.image} alt={alt} fill sizes="(max-width: 639px) 52vw, (max-width: 1099px) 30vw, 220px" className={styles.shot} />
            <InkOver scene={PHONE_SCENE} startMs={700} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- The laptop: the mouse --------------------------------------------------------------------

/**
 * The simple board on a laptop at 800 × 520 CSS px (a window that size: the dock folds Shapes,
 * Picture and Redo behind More), measured off the real board. Board px are `u`.
 */
const PROBLEM = { x: 44, top: 84, gap: 240.5, size: 29.3, pen: 2 } as const;
/** the line written with the mouse: a kid's size on a laptop, its pitch under the problem */
const LINE = { x: 44, top: 132, size: 40, seed: 11, pen: 2.2 } as const;
/** after the line, the pointer moves down and away from it (the check lands where it was) */
const POINTER_REST_MS = 420;

/** One line of ink on the board, its digits' top-left at (x, top) in board px. */
function BoardInk({ x, top, children, width, className }: { x: number; top: number; width: number; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `${styles.boardInk} ${className}` : styles.boardInk} style={{ left: u(x), top: u(top), width: u(width) }}>
      {children}
    </div>
  );
}

/** The system's arrow pointer, its tip at its box's top-left. */
function Pointer({ style }: { style: CSSProperties }) {
  return (
    <span className={styles.pointer} style={style} {...MOVES}>
      <svg viewBox="0 0 16 24" className={styles.pointerShape}>
        <path d="M1 1v19.2l4.6-4.4 3.1 7 3-1.3-3-6.9H15z" fill="#fff" stroke="#1d1d1d" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function TopBar() {
  return (
    <>
      <span className={`${styles.round} ${styles.back}`}>
        <ChevronLeft className={styles.i24} strokeWidth={2.25} />
      </span>
      <span className={styles.helpMe}>
        <span className={styles.helpMain}>
          <Lightbulb className={styles.i20} strokeWidth={2.25} />
          {LANDING_COPY.how.steps[2].helpButton}
        </span>
        <span className={styles.helpMore}>
          <ChevronDown className={styles.i20} strokeWidth={2.5} />
        </span>
      </span>
      <span className={styles.today}>
        <span className={styles.todayWord}>{DAILY_BOARD_COPY.pillTitle}</span>
        <span className={styles.stars}>
          {Array.from({ length: DAILY_GOAL }, (_, i) => (
            <Star key={i} className={styles.star} strokeWidth={2.2} />
          ))}
        </span>
        <span>{DAILY_BOARD_COPY.pill(0, DAILY_GOAL)}</span>
      </span>
      <span className={styles.more}>
        <Ellipsis className={styles.i20} />
        More
      </span>
    </>
  );
}

function DockTool({ icon: Icon, label, state }: { icon: LucideIcon; label: string; state?: "pen" }) {
  return (
    <span className={styles.tool} data-state={state}>
      <Icon className={styles.i22} strokeWidth={2} />
      {label}
    </span>
  );
}

function Dock({ undoUntilMs }: { undoUntilMs: number }) {
  return (
    <span className={styles.dock}>
      <DockTool icon={MousePointer2} label={DOCK_COPY.select} />
      <DockTool icon={Pencil} label={DOCK_COPY.pen} state="pen" />
      <DockTool icon={Eraser} label={DOCK_COPY.eraser} />
      <span className={styles.divider} />
      {/* Undo wakes up once the line is written */}
      <span className={styles.undo} style={{ "--until": ms(undoUntilMs) } as CSSProperties} {...MOVES}>
        <DockTool icon={Undo2} label={DOCK_COPY.undo} />
      </span>
      <DockTool icon={LayoutGrid} label={DOCK_COPY.more} />
      <span className={styles.divider} />
      {(["#1d1d1d", "#e03131", "#099268", "#ae3ec9"] as const).map((c, i) => (
        <span key={c} className={styles.swatchSlot}>
          <span className={styles.swatch} data-on={i === 0 ? "" : undefined} style={{ "--dot": c } as CSSProperties} />
        </span>
      ))}
      <span className={styles.divider} />
      <span className={`${styles.tool} ${styles.newPage}`}>
        <FilePlus2 className={styles.i22} strokeWidth={2} />
        {DOCK_COPY.newPage}
      </span>
      <span className={styles.ask}>
        <MessageCircle className={styles.i22} strokeWidth={2.25} />
        {DOCK_COPY.ask}
      </span>
    </span>
  );
}

function LaptopPicture({ item }: { item: Copy["items"][1] }) {
  const hand = handInk(item.line, { size: LINE.size, seed: LINE.seed, speed: MOUSE_PACE.writeSpeed });
  const demo = mouseDemo(handMathMs(item.line, { size: LINE.size, seed: LINE.seed, speed: MOUSE_PACE.writeSpeed }));
  // the pointer rides the pen across the line, its tip on the ink's middle
  const pointer = {
    left: u(LINE.x),
    top: u(LINE.top + hand.height * 0.45),
    "--write": ms(demo.writeMs),
    // the glide, then a short move off the line so the check lands in the clear
    "--len": ms(demo.doneMs - demo.writeMs + POINTER_REST_MS),
    "--dx": u(hand.width),
    "--rest-x": u(hand.width + 34),
    "--rest-y": u(hand.height * 0.6),
  } as CSSProperties;

  return (
    <div className={styles.laptopPicture} role="img" aria-label={item.alt} {...drawKey(KEYS.laptop)}>
      <div className={styles.laptop} aria-hidden>
        <div className={styles.lid}>
          <span className={styles.lidCamera} />
          <div className={styles.screen}>
            <div className={styles.board}>
              <span className={styles.page} />

              {/* the problems, as the board wrote them: numbered, in the tutor's blue */}
              {item.problems.map((p, i) => {
                const latex = `${i + 1}.\\ ${p}`;
                const problem = handInk(latex, { size: PROBLEM.size, seed: 2 + i });
                return (
                  <BoardInk key={p} x={PROBLEM.x + i * PROBLEM.gap - PROBLEM.pen} top={PROBLEM.top - PROBLEM.pen} width={problem.width + 2 * PROBLEM.pen}>
                    <HandMath latex={latex} ink="tutor" size={PROBLEM.size} seed={2 + i} pen={PROBLEM.pen} />
                  </BoardInk>
                );
              })}

              {/* the line written with the mouse, in the kid's pen, and the tutor's check */}
              <BoardInk x={LINE.x - LINE.pen} top={LINE.top - LINE.pen} width={hand.width + 2 * LINE.pen} className={styles.typedInk}>
                <HandMath latex={item.line} ink="kid" size={LINE.size} seed={LINE.seed} pen={LINE.pen} speed={MOUSE_PACE.writeSpeed} draw={KEYS.laptop} startMs={demo.writeMs} />
              </BoardInk>
              <span className={styles.boardCheck} style={{ left: u(LINE.x + hand.width + 12), top: u(LINE.top - 6) }}>
                <InkCheck draw={KEYS.laptop} atMs={demo.checkAtMs} forMs={demo.checkMs} />
              </span>
              <Pointer style={pointer} />

              <TopBar />
              <Dock undoUntilMs={demo.doneMs} />
            </div>
          </div>
        </div>
        <div className={styles.base}>
          <span className={styles.notch} />
        </div>
      </div>
    </div>
  );
}

// ---- The section --------------------------------------------------------------------------------

function Card({ item, kind, children }: { item: Item; kind: keyof typeof KEYS; children: ReactNode }) {
  return (
    <li className={`${styles.card} ${landing.reveal}`} data-device={kind}>
      <div className={styles.stage}>{children}</div>
      <div className={styles.text}>
        <p className={styles.name}>{item.name}</p>
        <h3 className={styles.title}>{item.title}</h3>
        <p className={styles.body}>{item.body}</p>
      </div>
    </li>
  );
}

export function Devices() {
  const copy = LANDING_COPY.devices;
  const [tablet, laptop, phone] = copy.items;
  return (
    <section className={`${landing.band} ${styles.band}`} aria-labelledby="lp-devices-title">
      <div className={`${landing.inner} ${landing.head} ${landing.reveal}`}>
        <p className={landing.eyebrow}>{copy.eyebrow}</p>
        <h2 id="lp-devices-title" className={landing.h2}>
          <Lines text={copy.title} />
        </h2>
        <p className={landing.lede}>{copy.lede}</p>
      </div>
      <ul className={styles.cards}>
        <Card item={tablet} kind="tablet">
          <TabletPicture alt={tablet.alt} />
        </Card>
        <Card item={laptop} kind="laptop">
          <LaptopPicture item={laptop} />
        </Card>
        <Card item={phone} kind="phone">
          <PhonePicture alt={phone.alt} />
        </Card>
      </ul>
    </section>
  );
}
