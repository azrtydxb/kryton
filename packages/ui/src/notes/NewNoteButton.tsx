import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "../primitives/button";
import { cn } from "../lib/utils";

export interface NewNoteButtonProps {
  onClick: () => void;
  label?: string;
  className?: string;
}

export function NewNoteButton({ onClick, label = "New note", className }: NewNoteButtonProps) {
  return (
    <Button
      variant="default"
      size="sm"
      onClick={onClick}
      className={cn("gap-1.5", className)}
      aria-label={label}
    >
      <Plus size={15} aria-hidden="true" />
      {label}
    </Button>
  );
}
