import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background"
      role="status"
      aria-label="Loading"
    >
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  );
}
