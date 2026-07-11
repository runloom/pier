import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import type { KeyboardEvent, ReactNode } from "react";

export interface InputRowProps {
  description?: ReactNode;
  id: string;
  inputClassName?: string;
  inputMode?: "numeric";
  label: string;
  max?: number;
  min?: number;
  onBlur?: (value: string) => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  step?: number;
  type?: "text" | "number";
  value: string;
}

export function InputRow({
  id,
  inputClassName = "w-[240px]",
  inputMode,
  label,
  description,
  max,
  min,
  placeholder,
  step,
  type = "text",
  value,
  onChange,
  onBlur,
}: InputRowProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Enter 走与 blur 相同的提交路径。
      e.currentTarget.blur();
    }
  };
  return (
    <Field className="!items-center" orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <Input
        className={inputClassName}
        id={id}
        inputMode={inputMode}
        max={max}
        min={min}
        onBlur={(e) => onBlur?.(e.currentTarget.value)}
        onChange={(e) => onChange?.(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        step={step}
        type={type}
        value={value}
      />
    </Field>
  );
}
