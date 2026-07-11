import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Textarea } from "@pier/ui/textarea.tsx";
import type { KeyboardEvent, ReactNode } from "react";

export interface TextareaRowProps {
  description?: ReactNode;
  id: string;
  label: string;
  onBlur?: (value: string) => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  textareaClassName?: string;
  value: string;
}

export function TextareaRow({
  id,
  label,
  description,
  placeholder,
  rows = 5,
  textareaClassName = "w-[460px]",
  value,
  onBlur,
  onChange,
}: TextareaRowProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.currentTarget.blur();
    }
  };

  return (
    <Field className="!items-start" orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
      </FieldContent>
      <Textarea
        className={textareaClassName}
        id={id}
        onBlur={(event) => onBlur?.(event.currentTarget.value)}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        value={value}
      />
    </Field>
  );
}
