"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConfirmSubmitButtonProps extends ButtonProps {
  confirmMessage: string;
  pendingText?: string;
}

/**
 * Like SubmitButton, but pops a native browser confirm() before letting
 * the form actually submit — for destructive bulk actions (e.g. "Clear
 * drafts") where a stray click shouldn't silently wipe a bunch of rows.
 * Must be rendered inside the <form> it submits (useFormStatus reads the
 * nearest parent form's pending state).
 */
export function ConfirmSubmitButton({
  confirmMessage,
  children,
  pendingText,
  className,
  disabled,
  onClick,
  ...props
}: ConfirmSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      className={cn("gap-2", className)}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...props}
    >
      {pending && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {pending ? (pendingText ?? "Working…") : children}
    </Button>
  );
}
