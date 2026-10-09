"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { clientMetric } from "@/lib/logger";
import { readLearnerProfile } from "@/lib/learning/profile";
import { loadPathData, type PathData, type PathProfile } from "@/lib/path/pathData";
import { PATH_COPY, type PathNode } from "@/lib/path/pathView";
import { useTopicActions } from "@/components/topics/useTopicStart";

/**
 * The skill path's data hooks: what the home reads, the grade the Progress page reads, and what a
 * tap on a stop does. Thin: the words and the trail are made in src/lib/path.
 */

export type PathDataState = { status: "loading" } | PathData;

/** The home's path: the profile and the record, read once the card mounts. Never fails: see `loadPathData`. */
export function usePathData(userId: string | undefined): PathDataState {
  const [state, setState] = useState<PathDataState>({ status: "loading" });
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void loadPathData(userId).then(
      (data) => live && setState(data),
      () => live && setState({ status: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [userId]);
  return state;
}

export type PathProfileState = { status: "loading" } | ({ status: "ready" } & PathProfile);

/**
 * The grade and course for the Progress page's path. That page reads the record itself; the grade
 * is read here so its own reads stay as they are. Never fails (`readLearnerProfile`).
 */
export function usePathProfile(userId: string | undefined): PathProfileState {
  const [state, setState] = useState<PathProfileState>({ status: "loading" });
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readLearnerProfile(userId).then(
      (p) => live && setState({ status: "ready", grade: p.grade, course: p.course }),
      () => live && setState({ status: "ready", grade: null, course: null }),
    );
    return () => {
      live = false;
    };
  }, [userId]);
  return state;
}

export interface PathOpen {
  /** the topic whose board is being made, or null */
  busy: string | null;
  open: (node: PathNode) => void;
}

/**
 * A tap on a stop opens that skill's topic board (`useTopicActions().startTopic`, as the home's Up
 * next does). A skill with no problems yet says "Coming soon" in a gentle toast instead.
 */
export function usePathOpen(userId: string | undefined, from: "home" | "progress"): PathOpen {
  const { busy, startTopic } = useTopicActions(userId);
  const open = useCallback(
    (node: PathNode) => {
      clientMetric("path.open", { skill: node.id, state: node.state, level: node.level, from, ready: node.topic !== null });
      if (!node.topic) {
        toast(PATH_COPY.comingSoonTitle, { description: PATH_COPY.comingSoon(node.name) });
        return;
      }
      startTopic(node.topic);
    },
    [from, startTopic],
  );
  return { busy: busy && busy !== "ask" ? busy : null, open };
}
