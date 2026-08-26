"use client";

import { PaperBoard } from "./board/[id]/page";

/** Preview root is the paper. Teachers write immediately — no login hop. */
export default function Home() {
  return <PaperBoard boardId="demo" />;
}
