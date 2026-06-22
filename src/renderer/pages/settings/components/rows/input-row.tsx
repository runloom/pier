import type { ReactNode } from "react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/primitives/field.tsx";
import { Input } from "@/components/primitives/input.tsx";

export interface InputRowProps {
  description?: ReactNode;
  id: string;
  label: string;
  onBlur?: (value: string) => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  value: string;
}

export function InputRow({
  id,
  label,
  description,
  placeholder,
  value,
  onChange,
  onBlur,
}: InputRowProps) {
  return (
    <Field className="!items-center" orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <Input
        className="w-[240px]"
        id={id}
        onBlur={(e) => onBlur?.(e.currentTarget.value)}
        onChange={(e) => onChange?.(e.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </Field>
  );
}
