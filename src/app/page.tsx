import { PaperBoard } from "./board/[id]/page";

/** Preview root is the paper. License comes from the server env, not a stale client bundle. */
export default function Home() {
  return (
    <PaperBoard
      boardId="demo"
      licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
    />
  );
}
