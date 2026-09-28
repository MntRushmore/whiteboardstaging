"use client";

import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** Owned by the form so it can hide the password again on submit (password managers save type=password fields). */
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
};

/** Password field with a show/hide toggle inside its right edge. */
export function PasswordInput({ visible, onVisibleChange, className, id, ...props }: PasswordInputProps) {
  return (
    <div className="relative">
      <Input id={id} type={visible ? "text" : "password"} className={cn("pr-11", className)} {...props} />
      <button
        type="button"
        onClick={() => onVisibleChange(!visible)}
        aria-label="Show password"
        aria-pressed={visible}
        aria-controls={id}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
