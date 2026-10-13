"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LANDING_PATH, SIGN_IN_HREF } from "@/lib/landing/links";
import type { PathSkillId } from "@/lib/learning/grades";
import type { WelcomeChoice } from "@/lib/onboarding/choice";
import { START_STEPS, type StartAnswers, type StartRole, type StartStep } from "@/lib/start/contracts";
import {
  chooseLevel,
  chooseName,
  chooseRole,
  chooseTried,
  flowCopy,
  flowProgress,
  flowSteps,
  forgetFlow,
  INITIAL_FLOW,
  keepFlow,
  nextStep,
  notSure,
  previousStep,
  readKeptFlow,
  resumeStep,
  SKIPPABLE,
  toggleFocus,
  type FlowState,
} from "@/lib/start/flow";
import { answersFromHash } from "@/lib/start/link";
import { buildPlan, focusOptions, planSkills, skillWords } from "@/lib/start/plan";
import { recordStartStep } from "@/lib/start/record";
import { KeepWords, useStartInk } from "./parts";
import { StartBuilding } from "./screens/StartBuilding";
import { StartFocus } from "./screens/StartFocus";
import { StartGrade } from "./screens/StartGrade";
import { StartName } from "./screens/StartName";
import { StartPlan } from "./screens/StartPlan";
import { StartProof } from "./screens/StartProof";
import { StartWho } from "./screens/StartWho";
import styles from "./start.module.css";

// the two heavy screens load when they are near: the try board, and the account form (with Supabase)
const loadTry = () => import("./screens/StartTry");
const loadAccount = () => import("./StartAccount");
const StartTry = dynamic(loadTry, { ssr: false, loading: () => <div className={styles.tryLoading} aria-busy="true" /> });
const StartAccount = dynamic(() => loadAccount().then((m) => m.StartAccount), { ssr: false });

/** How long a tapped answer shows the tutor's check before the next screen (ms). */
const PICK_MS = 460;

type Direction = "forward" | "back" | "none";

/** What /start keeps in each history entry it makes, so the browser's Back is the flow's Back. */
interface StartHistory {
  startStep: StartStep;
  /** how many entries the flow has pushed before this one */
  startDepth: number;
}

function historyStep(state: unknown): StartHistory | null {
  const s = state as Partial<StartHistory> | null;
  return s && typeof s.startStep === "string" && (START_STEPS as readonly string[]).includes(s.startStep) && typeof s.startDepth === "number" ? (s as StartHistory) : null;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface StartFlowProps {
  /** the who screen's card ink, server-rendered */
  motifs: { parent: ReactNode; kid: ReactNode };
  /** the page's font class (the titles' serif) */
  className?: string;
}

/**
 * /start (docs/START-FLOW.md): the new onboarding, before the account. One question per screen; the
 * flow itself (order, resume, the answers, the words) is `src/lib/start/flow.ts`, the plan
 * `plan.ts`, and the account and what it saves `StartAccount` / `finish.ts`.
 *
 * - Each screen is a browser history entry, so a phone's back swipe goes back a question, not off
 *   the page. The beat (`building`) is replaced by the plan, never kept.
 * - The flow is kept on the device as it goes (`keepFlow`), and a tab opened later picks up there; a
 *   grown-up's link (`#a=`) opens on the plan, worded for them, and the link leaves the address bar.
 * - Each step is counted anonymously (`recordStartStep`, START_EVENTS), never with the name.
 */
export function StartFlow({ motifs, className }: StartFlowProps) {
  const router = useRouter();
  const [flow, setFlow] = useState<FlowState>(INITIAL_FLOW);
  const [dir, setDir] = useState<Direction>("none");
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const restored = useRef(false);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const depth = useRef(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const { step, answers, fromLink } = flow;
  const copy = flowCopy(answers, fromLink);
  const ink = useStartInk(answers.role !== null || step !== "who");

  // ---------------------------------------------------------------- arriving
  useEffect(() => {
    const store = storage();
    const link = answersFromHash(window.location.hash);
    let start: FlowState = INITIAL_FLOW;
    if (link) {
      // a kid's link to their grown-up: the plan, worded for the grown-up; the answers leave the address bar
      start = { step: resumeStep(link, "plan"), answers: link, fromLink: true };
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      recordStartStep("start_handoff_opened");
    } else {
      const kept = readKeptFlow(store, Date.now());
      if (kept) start = { ...kept, fromLink: false };
    }
    recordStartStep("start_shown");
    window.history.replaceState({ ...(window.history.state ?? {}), startStep: start.step, startDepth: 0 } satisfies StartHistory, "");
    restored.current = true;
    if (start !== INITIAL_FLOW) setFlow(start);

    // a family already signed in has an account: their home, not a new one (a grown-up's link stays)
    if (!link) {
      void import("@/lib/supabase")
        .then(({ supabase }) => supabase.auth.getSession())
        .then(({ data }) => {
          if (data.session && !moved.current) router.replace("/");
        })
        .catch(() => undefined);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the flow as it goes
  useEffect(() => {
    if (restored.current) keepFlow(storage(), flow, Date.now());
  }, [flow]);

  // the browser's Back and Forward move between the flow's screens
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const entry = historyStep(event.state);
      if (!entry) return;
      if (timer.current) clearTimeout(timer.current);
      busy.current = false;
      depth.current = entry.startDepth;
      const current = flowRef.current;
      const target = resumeStep(current.answers, entry.startStep);
      const steps = flowSteps(current.answers);
      setDir(steps.indexOf(target) < steps.indexOf(current.step) ? "back" : "forward");
      moved.current = true;
      setFlow({ ...current, step: target });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // a new screen: to its top, its title for a screen reader, and its counts
  useLayoutEffect(() => {
    if (!moved.current) return;
    window.scrollTo({ top: 0 });
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    if (step === "try") recordStartStep("start_try_shown");
    if (step === "plan") recordStartStep("start_plan");
    // the heavy screens' code, before they are needed
    const at = START_STEPS.indexOf(step);
    if (at >= START_STEPS.indexOf("grade")) void loadTry();
    if (at >= START_STEPS.indexOf("try")) void loadAccount();
  }, [step]);

  // ---------------------------------------------------------------- moving
  const forward = useCallback((next: StartAnswers) => {
    const current = flowRef.current;
    const to = nextStep({ step: current.step, answers: next });
    if (!to) return;
    // the beat is not a place to come back to: the plan takes its entry
    if (current.step === "building") {
      window.history.replaceState({ ...(window.history.state ?? {}), startStep: to, startDepth: depth.current } satisfies StartHistory, "");
    } else {
      depth.current += 1;
      window.history.pushState({ startStep: to, startDepth: depth.current } satisfies StartHistory, "");
    }
    moved.current = true;
    setDir("forward");
    setFlow({ ...current, answers: next, step: to });
  }, []);

  const back = useCallback(() => {
    const current = flowRef.current;
    const to = previousStep(current);
    if (!to || busy.current) return;
    if (depth.current > 0) {
      // the browser's own Back, so the history stays in step (popstate shows the screen)
      window.history.back();
      return;
    }
    window.history.replaceState({ ...(window.history.state ?? {}), startStep: to, startDepth: 0 } satisfies StartHistory, "");
    moved.current = true;
    setDir("back");
    setFlow({ ...current, step: to });
  }, []);

  /** A tapped answer: the tutor checks it, then the next screen. */
  const pick = useCallback(
    (next: StartAnswers) => {
      if (busy.current) return;
      busy.current = true;
      setFlow((f) => ({ ...f, answers: next }));
      timer.current = setTimeout(() => {
        busy.current = false;
        forward(next);
      }, PICK_MS);
    },
    [forward],
  );

  // ---------------------------------------------------------------- the answers
  const onRole = (role: StartRole) => {
    recordStartStep("start_who", { role });
    pick(chooseRole(answers, role));
  };
  const onName = (name: string | null) => {
    recordStartStep("start_name", { given: name !== null });
    forward(chooseName(answers, name));
  };
  const onLevel = (choice: WelcomeChoice) => {
    recordStartStep("start_grade", choice.kind === "grade" ? { grade: choice.grade } : { course: choice.course });
    pick(chooseLevel(answers, choice));
  };
  const onFocusNext = (next: StartAnswers) => {
    recordStartStep("start_focus", { count: next.focus.length });
    forward(next);
  };
  const onTried = useCallback((progress: { checked: boolean; solved: boolean }) => {
    const was = flowRef.current.answers.tried;
    if ((progress.checked && !was?.checked) || (progress.solved && !was?.solved)) recordStartStep("start_try_checked", { solved: progress.solved });
    setFlow((f) => ({ ...f, answers: chooseTried(f.answers, progress) }));
  }, []);
  const onProofNext = () => {
    recordStartStep("start_proof");
    forward(answers);
  };

  const skip = () => {
    if (busy.current) return;
    if (step === "name") return onName(null);
    if (step === "focus") return onFocusNext(notSure(answers));
    if (step === "proof") return onProofNext();
    forward(answers);
  };

  const onAccountDone = (next: string) => {
    forgetFlow(storage());
    moved.current = true;
    router.replace(next);
  };

  // ---------------------------------------------------------------- the page
  const canBack = previousStep(flow) !== null && step !== "building";
  const canSkip = SKIPPABLE.has(step);
  const progress = flowProgress(flow);
  const firstSkill = planSkills(answers)[0] ?? null;

  let screen: ReactNode;
  switch (step) {
    case "who":
      screen = <StartWho copy={copy.who} role={answers.role} onPick={onRole} motifs={motifs} titleRef={titleRef} />;
      break;
    case "name":
      screen = <StartName copy={copy.name} name={answers.name} kid={answers.role === "kid"} onDone={onName} titleRef={titleRef} />;
      break;
    case "grade":
      screen = <StartGrade copy={copy.grade} choice={answers.choice} onPick={onLevel} titleRef={titleRef} />;
      break;
    case "focus":
      screen = (
        <StartFocus
          copy={copy.focus}
          options={focusOptions(answers.choice)}
          focus={answers.focus}
          ink={ink}
          onToggle={(skill: PathSkillId) => setFlow((f) => ({ ...f, answers: toggleFocus(f.answers, skill) }))}
          onNotSure={() => {
            if (busy.current) return;
            recordStartStep("start_focus", { count: 0 });
            pick(notSure(answers));
          }}
          onNext={() => onFocusNext(answers)}
          titleRef={titleRef}
        />
      );
      break;
    case "proof":
      screen = <StartProof copy={copy.proof} onNext={onProofNext} titleRef={titleRef} />;
      break;
    case "try":
      screen = <StartTry copy={copy.try} choice={answers.choice} firstSkill={firstSkill} ink={ink} tried={answers.tried} onProgress={onTried} onNext={() => forward(flowRef.current.answers)} titleRef={titleRef} />;
      break;
    case "building":
      screen = <StartBuilding copy={copy.building} firstSkill={firstSkill ? skillWords(firstSkill).name : null} onDone={() => forward(flowRef.current.answers)} titleRef={titleRef} />;
      break;
    case "plan":
      screen = <StartPlan copy={copy.plan} plan={buildPlan(answers)} ink={ink} tried={answers.tried} onSave={() => forward(answers)} titleRef={titleRef} />;
      break;
    case "account": {
      const plan = buildPlan(answers);
      // "3rd grade · Starts with Times tables": what is being saved, in one line
      const line = [plan.level, plan.skills[0] ? copy.plan.startsWith(plan.skills[0].name) : null].filter(Boolean).join(" · ");
      const summary = line ? <KeepWords text={line} /> : null;
      screen = (
        <div className={styles.account}>
          <StartAccount answers={answers} onDone={onAccountDone} onBack={back} startIn={fromLink ? "form" : undefined} inFlow summary={summary} />
        </div>
      );
      break;
    }
  }

  const centered = step === "building" || step === "who";
  const wide = step === "proof" || step === "try";
  return (
    <div className={[styles.page, className].filter(Boolean).join(" ")}>
      <header className={styles.bar} data-first={step === "who" || undefined} data-brand={(!canBack && fromLink) || undefined}>
        {step === "who" ? (
          <>
            <Link href={LANDING_PATH} className={styles.brand}>
              Agathon
            </Link>
            <Link href={SIGN_IN_HREF} className={styles.signIn}>
              {copy.bar.signIn}
            </Link>
          </>
        ) : (
          <>
            {canBack ? (
              <button type="button" className={styles.iconButton} onClick={back} aria-label={copy.bar.back}>
                <ArrowLeft size={22} strokeWidth={2} aria-hidden />
              </button>
            ) : fromLink ? (
              // a grown-up who opened a kid's link: whose page this is
              <Link href={LANDING_PATH} className={styles.brand}>
                Agathon
              </Link>
            ) : (
              <span className={styles.barSpace} aria-hidden />
            )}
            <div className={styles.track} role="progressbar" aria-label={copy.bar.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span className={styles.fill} style={{ "--p": progress } as CSSProperties} />
            </div>
            {canSkip ? (
              <button type="button" className={styles.skip} onClick={skip}>
                {copy.bar.skip}
              </button>
            ) : (
              <span aria-hidden />
            )}
          </>
        )}
      </header>
      <main className={styles.main} data-wide={wide || undefined}>
        <section key={step} className={styles.screen} data-dir={dir} data-step={step} data-center={centered || undefined}>
          {screen}
        </section>
      </main>
    </div>
  );
}

export default StartFlow;
