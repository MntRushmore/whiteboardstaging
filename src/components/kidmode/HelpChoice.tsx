"use client";

import { Check, ChevronDown, Footprints, Lightbulb, Sparkles, type LucideIcon } from "lucide-react";
import { Content, ItemIndicator, Label, Portal, RadioGroup, RadioItem, Root, Trigger } from "@radix-ui/react-dropdown-menu";
import type { AssistanceMode } from "@/hooks/useAssistanceMode";
import { HELP_CHOICE_COPY, HELP_CHOICES, helpChoiceFor, modeForChoice, type HelpChoiceId } from "./helpChoiceView";

/** The data attribute the board's bar joins Help me to the choice by (its right side squared off). */
export const HELP_CHOICE_ATTR = "data-help-choice";

const ICONS: Record<HelpChoiceId, LucideIcon> = { hint: Lightbulb, step: Footprints, solve: Sparkles };

/**
 * The simple board's choice of how much help Help me gives (`helpChoiceView.ts`): a chevron joined to
 * the right of the big Help me, one blue button of two parts, opening a short menu — Hint, Next step,
 * Solve it, each with a line saying what the tutor does. Picking one turns the help dial, exactly as
 * the classic bar's tabs do (the page's `onModeChange`: remembered per board, and Help me glows).
 * A Radix menu, for its keyboard, focus and screen-reader behaviour. Loaded lazily with the kid dock.
 */
export default function HelpChoice({ mode, onModeChange }: { mode: AssistanceMode; onModeChange: (mode: AssistanceMode) => void }) {
  const current = helpChoiceFor(mode);
  return (
    <Root>
      <Trigger asChild>
        <button
          type="button"
          {...{ [HELP_CHOICE_ATTR]: current?.id ?? "" }}
          aria-label={HELP_CHOICE_COPY.label(current?.word ?? null)}
          title={HELP_CHOICE_COPY.hint}
          className="flex h-12 w-11 shrink-0 cursor-pointer items-center justify-center rounded-r-full border-l border-white/30 bg-blue-600 pr-1 text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 active:bg-blue-800 aria-expanded:bg-blue-800 motion-reduce:transition-none"
        >
          <ChevronDown className="size-5 transition-transform [[aria-expanded=true]>&]:rotate-180 motion-reduce:transition-none" strokeWidth={2.5} aria-hidden />
        </button>
      </Trigger>
      <Portal>
        <Content
          align="start"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
          className="z-[1200] w-[min(320px,calc(100vw-24px))] rounded-2xl border border-slate-200/90 bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.06)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
          data-help-choice-menu=""
        >
          <Label className="px-2.5 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{HELP_CHOICE_COPY.title}</Label>
          <RadioGroup
            value={current?.id ?? ""}
            onValueChange={(id) => {
              const next = modeForChoice(id);
              if (next && next !== mode) onModeChange(next);
            }}
          >
            {HELP_CHOICES.map((c) => {
              const Icon = ICONS[c.id];
              return (
                <RadioItem
                  key={c.id}
                  value={c.id}
                  className="group flex min-h-14 cursor-pointer select-none items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors data-[highlighted]:bg-slate-100 data-[state=checked]:bg-blue-50 motion-reduce:transition-none"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 group-data-[state=checked]:bg-blue-600 group-data-[state=checked]:text-white">
                    <Icon className="size-[18px]" strokeWidth={2.25} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold leading-tight text-slate-900">{c.word}</span>
                    <span className="text-[13px] leading-snug text-slate-500">{c.line}</span>
                  </span>
                  <ItemIndicator className="shrink-0 text-blue-600">
                    <Check className="size-5" strokeWidth={2.5} aria-hidden />
                  </ItemIndicator>
                </RadioItem>
              );
            })}
          </RadioGroup>
        </Content>
      </Portal>
    </Root>
  );
}
