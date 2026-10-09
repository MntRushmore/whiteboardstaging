"use client";

import { useEffect, useState } from "react";
import { isReadAloudOn, onReadAloudChange } from "./readAloud";

/**
 * Whether read aloud is on for this student on this device, kept current as it changes (here, or in
 * another tab). null until known: the grade's default may need the profile read first.
 */
export function useReadAloud(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      void isReadAloudOn().then((value) => {
        if (live) setOn(value);
      });
    };
    read();
    const off = onReadAloudChange(read);
    return () => {
      live = false;
      off();
    };
  }, []);
  return on;
}
