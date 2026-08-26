import { PaperBoard } from "./board/[id]/page";

/** `/` is the paper on every host, including production. No login wall. */
export default function Home() {
  return (
    <PaperBoard
      boardId="demo"
      licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
    />
  );
}
