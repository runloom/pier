import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@pier/ui/input-group.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { ChangeEvent, FocusEvent, KeyboardEvent, ReactNode } from "react";

export interface InputRowProps {
  description?: ReactNode;
  disabled?: boolean;
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
  /** Trailing unit/label inside the control (shadcn InputGroupAddon). */
  suffix?: string;
  type?: "text" | "number";
  value: string;
}

export function InputRow({
  id,
  disabled = false,
  inputClassName = "w-[240px]",
  inputMode,
  label,
  description,
  max,
  min,
  placeholder,
  step,
  suffix,
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

  const descriptionId = description ? `${id}-description` : undefined;
  const unitId = suffix ? `${id}-unit` : undefined;
  const describedBy =
    [descriptionId, unitId].filter(Boolean).join(" ") || undefined;

  const inputProps = {
    "aria-describedby": describedBy,
    disabled,
    id,
    inputMode,
    max,
    min,
    onBlur: (e: FocusEvent<HTMLInputElement>) =>
      onBlur?.(e.currentTarget.value),
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      onChange?.(e.currentTarget.value),
    onKeyDown: handleKeyDown,
    placeholder,
    step,
    type,
    value,
  } as const;

  const control = suffix ? (
    <InputGroup className={cn("shrink-0", inputClassName)}>
      <InputGroupInput {...inputProps} />
      <InputGroupAddon align="inline-end">
        <InputGroupText id={unitId}>{suffix}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ) : (
    <Input className={inputClassName} {...inputProps} />
  );

  return (
    <Field className="!items-center" orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        ) : null}
      </FieldContent>
      {control}
    </Field>
  );
}
