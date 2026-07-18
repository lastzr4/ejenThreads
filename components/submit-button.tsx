"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SubmitButtonProps extends ButtonProps {
  pendingText?: string;
}

/**
 * Drop-in replacement for <Button type="submit"> inside a <form action={...}>
 * that shows a spinner + disables itself while the server action is running.
 * Must be rendered as a child of the <form> (useFormStatus reads the
 * nearest parent form's pending state) — this is why it's a separate
 * client component rather than logic inlined into the server component page.
 */
export function SubmitButton({ children, pendingText, className, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className={cn("gap-2", className)} {...props}>
      {pending && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {pending ? (pendingText ?? "Loading…") : children}
    </Button>
  );
}
