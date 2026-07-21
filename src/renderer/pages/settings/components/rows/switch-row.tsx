import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type { ReactNode } from "react";

export interface SwitchRowProps {
  checked: boolean;
  description?: ReactNode;
  disabled?: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

export function SwitchRow({
  checked,
  description,
  disabled,
  id,
  label,
  onCheckedChange,
}: SwitchRowProps) {
  return (
    <Field className="!items-center" orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <Switch
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={onCheckedChange}
      />
    </Field>
  );
}
