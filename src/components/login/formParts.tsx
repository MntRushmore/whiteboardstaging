import { AlertCircle } from "lucide-react";

/** Border and ring for an input whose value was refused; pair with aria-invalid. */
export const INVALID_INPUT = "border-destructive focus-visible:ring-destructive/40";

/** One sentence under a field. Linked to the input with aria-describedby. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} data-state="field-error" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** An error about the attempt as a whole (wrong credentials, offline). */
export function FormError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      data-state="error"
      className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}
