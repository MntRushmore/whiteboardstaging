"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { cleanName, type FlowCopy } from "@/lib/start/flow";
import styles from "../start.module.css";

export interface StartNameProps {
  copy: FlowCopy["name"];
  /** the name already given (Back to this screen) */
  name: string | null;
  /** the kid is typing their own name: the browser may offer theirs */
  kid: boolean;
  onDone: (name: string | null) => void;
  titleRef: Ref<HTMLHeadingElement>;
}

/** The kid's first name: one big field, Continue (Enter), or Skip in the bar. */
export function StartName({ copy, name, kid, onDone, titleRef }: StartNameProps) {
  const [value, setValue] = useState(name ?? "");
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // the field is the whole screen: ready to type (a phone opens its keyboard on the first tap)
    input.current?.focus({ preventScroll: true });
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = cleanName(value);
    if (clean === null) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    onDone(clean || null);
  }

  return (
    <>
      <div className={styles.head}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {copy.title}
        </h1>
        <p className={styles.lede}>{copy.lede}</p>
      </div>
      <form className={styles.nameForm} onSubmit={submit} noValidate>
        <label htmlFor="start-name" className={styles.srOnly}>
          {copy.label}
        </label>
        <div className={styles.nameField}>
          <input
            ref={input}
            id="start-name"
            className={styles.nameInput}
            name={kid ? "given-name" : "kid-name"}
            type="text"
            inputMode="text"
            autoComplete={kid ? "given-name" : "off"}
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            maxLength={24}
            placeholder={copy.placeholder}
            value={value}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "start-name-error" : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              if (invalid) setInvalid(false);
            }}
          />
        </div>
        <p id="start-name-error" className={styles.fieldError} role="alert">
          {invalid ? copy.invalid : ""}
        </p>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={!value.trim()}>
            {copy.next}
          </button>
        </div>
      </form>
    </>
  );
}
