import { Fragment } from "react";

/**
 * A heading written as two short lines ("One plan.\nEvery kid in the family."): the copy marks where
 * the line breaks, so a two-sentence headline never splits mid-sentence the way balancing alone
 * would split it.
 */
export function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}
